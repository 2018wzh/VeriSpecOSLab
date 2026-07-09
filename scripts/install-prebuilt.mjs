#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const REPO_URL = "https://github.com/2018wzh/VeriSpecOSLab";

const TARGETS = new Map([
  ["linux-x64", { assetName: "vos-linux-x64", binaryName: "vos" }],
  ["linux-arm64", { assetName: "vos-linux-arm64", binaryName: "vos" }],
  ["darwin-x64", { assetName: "vos-macos-x64", binaryName: "vos" }],
  ["darwin-arm64", { assetName: "vos-macos-arm64", binaryName: "vos" }],
  ["win32-x64", { assetName: "vos-windows-x64.exe", binaryName: "vos.exe" }],
]);

export function resolvePlatformTarget(platform = process.platform, arch = process.arch) {
  const target = TARGETS.get(`${platform}-${arch}`);
  if (!target) {
    throw new Error(`unsupported platform for vos prebuilt binary: ${platform}-${arch}`);
  }
  return { ...target };
}

export function resolveReleaseTag({ env = process.env, packageVersion } = {}) {
  const explicit = env.VOS_INSTALL_RELEASE_TAG?.trim();
  if (explicit) {
    return explicit;
  }
  if (!packageVersion) {
    throw new Error("package version is required to resolve the vos release tag");
  }
  if (packageVersion.includes("development") || packageVersion === "0.0.0") {
    throw new Error("set VOS_INSTALL_RELEASE_TAG when installing a development build");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new Error(`package version cannot be mapped to a vos release tag: ${packageVersion}`);
  }
  return `v${packageVersion}`;
}

export function assetDownloadUrl(releaseTag, assetName) {
  return `${REPO_URL}/releases/download/${releaseTag}/${assetName}`;
}

export function parseSha256Sums(text) {
  const checksums = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) {
      throw new Error(`invalid SHA256SUMS line: ${line}`);
    }
    checksums.set(path.basename(match[2].trim()), match[1].toLowerCase());
  }
  return checksums;
}

export async function verifyAssetChecksum(filePath, assetName, checksums) {
  const expected = checksums.get(assetName);
  if (!expected) {
    throw new Error(`SHA256SUMS does not contain ${assetName}`);
  }
  const actual = await sha256File(filePath);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${assetName}`);
  }
}

export async function installPrebuilt(options = {}) {
  const packageRoot = options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageVersion = options.packageVersion ?? await readPackageVersion(packageRoot);
  const target = resolvePlatformTarget(options.platform, options.arch);
  const releaseTag = resolveReleaseTag({ env: options.env, packageVersion });
  const vendorDir = path.join(packageRoot, "vendor");
  const finalBinary = path.join(vendorDir, target.binaryName);
  const tempBinary = path.join(tmpdir(), `vos-${target.assetName}-${process.pid}.download`);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Node.js 18 or newer is required to install vos prebuilt binaries");
  }

  await mkdir(vendorDir, { recursive: true });

  try {
    await downloadFile(assetDownloadUrl(releaseTag, target.assetName), tempBinary, fetchImpl);
    const checksumsText = await downloadText(assetDownloadUrl(releaseTag, "SHA256SUMS"), fetchImpl);
    await verifyAssetChecksum(tempBinary, target.assetName, parseSha256Sums(checksumsText));
    if (process.platform !== "win32") {
      await chmod(tempBinary, 0o755);
    }
    await rename(tempBinary, finalBinary);
    options.log?.(`vos: installed ${target.assetName} from ${releaseTag}`);
    return { releaseTag, target, binaryPath: finalBinary };
  } catch (error) {
    await rm(tempBinary, { force: true }).catch(() => {});
    throw error;
  }
}

async function readPackageVersion(packageRoot) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json is missing a string version");
  }
  return packageJson.version;
}

async function downloadText(url, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`failed to download release metadata: HTTP ${response.status}`);
  }
  return response.text();
}

async function downloadFile(url, outputPath, fetchImpl) {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`failed to download vos prebuilt binary: HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath, { mode: 0o755 }));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installPrebuilt({ log: (message) => console.error(message) }).catch((error) => {
    console.error(`vos: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
