import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetForPlatform, binaryPathForPlatform } from "./runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = "2018wzh/VeriSpecOSLab";

export async function installBinary({
  packageRoot: root = packageRoot,
  platform = process.platform,
  arch = process.arch,
  version = process.env.npm_package_version,
  fetchImpl = fetch,
  releaseBaseUrl = process.env.VOS_BIN_RELEASE_BASE_URL,
} = {}) {
  if (!version?.trim()) {
    throw new Error("vos-bin package version is missing");
  }
  const asset = assetForPlatform(platform, arch);
  const baseUrl = releaseBaseUrl?.replace(/\/$/, "") ?? `https://github.com/${repository}/releases/download/v${version}`;
  const checksumUrl = `${baseUrl}/SHA256SUMS`;
  const assetUrl = `${baseUrl}/${asset}`;
  const checksumResponse = await fetchImpl(checksumUrl);
  if (!checksumResponse.ok) {
    throw new Error(`failed to download vos-bin checksums: HTTP ${checksumResponse.status}`);
  }
  const checksums = await checksumResponse.text();
  const expectedHash = findChecksum(checksums, asset);
  const targetPath = binaryPathForPlatform(root, platform, arch);
  await mkdir(path.dirname(targetPath), { recursive: true });

  if (await matchesChecksum(targetPath, expectedHash, platform)) {
    return targetPath;
  }

  const assetResponse = await fetchImpl(assetUrl);
  if (!assetResponse.ok) {
    throw new Error(`failed to download vos-bin asset ${asset}: HTTP ${assetResponse.status}`);
  }
  const body = Buffer.from(await assetResponse.arrayBuffer());
  if (body.length === 0) {
    throw new Error(`downloaded vos-bin asset ${asset} is empty`);
  }
  const actualHash = sha256(body);
  if (actualHash !== expectedHash) {
    throw new Error(`vos-bin checksum mismatch for ${asset}: expected ${expectedHash}, got ${actualHash}`);
  }

  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, body, { mode: 0o755 });
  try {
    if (platform !== "win32") {
      await chmod(temporaryPath, 0o755);
    }
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return targetPath;
}

function findChecksum(content, asset) {
  const line = content.split(/\r?\n/).find((entry) => entry.trim().endsWith(`  ${asset}`) || entry.trim().endsWith(` *${asset}`));
  const hash = line?.trim().split(/\s+/)[0];
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error(`checksum for vos-bin asset ${asset} is missing or invalid`);
  }
  return hash.toLowerCase();
}

async function matchesChecksum(filePath, expectedHash, platform) {
  try {
    const file = await stat(filePath);
    if (!file.isFile() || file.size === 0) return false;
    if (platform !== "win32" && (file.mode & 0o111) === 0) return false;
    return sha256(await readFile(filePath)) === expectedHash;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  await installBinary();
}
