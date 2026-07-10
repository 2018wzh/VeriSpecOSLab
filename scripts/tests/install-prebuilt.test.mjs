import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  assetDownloadUrl,
  parseSha256Sums,
  installPrebuilt,
  resolvePlatformTarget,
  resolveReleaseTag,
  verifyAssetChecksum,
} from "../install-prebuilt.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8"),
);
const workspacePackageJson = JSON.parse(
  await readFile(new URL("../../vos/package.json", import.meta.url), "utf8"),
);

test("root package installs through the npm prebuilt launcher", () => {
  assert.deepEqual(packageJson.bin, { vos: "./bin/vos.js" });
  assert.equal(packageJson.scripts.postinstall, "node ./scripts/install-prebuilt.mjs");
  assert.equal(Object.hasOwn(packageJson.scripts, "prepare"), false);
  assert.match(packageJson.files.join("\n"), /^bin\/$/m);
  assert.match(packageJson.files.join("\n"), /^scripts\/install-prebuilt\.mjs$/m);
  assert.match(packageJson.files.join("\n"), /^vos\/packages\/vos-bin$/m);
});

test("workspace packages include the vos-bin boundary package", () => {
  assert.ok(workspacePackageJson.workspaces.includes("packages/vos-bin"));
});

test("resolves supported platform assets without workspace paths", () => {
  assert.deepEqual(resolvePlatformTarget("linux", "x64"), {
    assetName: "vos-linux-x64",
    binaryName: "vos",
  });
  assert.deepEqual(resolvePlatformTarget("linux", "arm64"), {
    assetName: "vos-linux-arm64",
    binaryName: "vos",
  });
  assert.deepEqual(resolvePlatformTarget("darwin", "x64"), {
    assetName: "vos-macos-x64",
    binaryName: "vos",
  });
  assert.deepEqual(resolvePlatformTarget("darwin", "arm64"), {
    assetName: "vos-macos-arm64",
    binaryName: "vos",
  });
  assert.deepEqual(resolvePlatformTarget("win32", "x64"), {
    assetName: "vos-windows-x64.exe",
    binaryName: "vos.exe",
  });
  assert.throws(() => resolvePlatformTarget("freebsd", "x64"), /unsupported platform/);
});

test("resolves explicit release tags before package versions", () => {
  assert.equal(resolveReleaseTag({ env: { VOS_INSTALL_RELEASE_TAG: "nightly-abc123" }, packageVersion: "0.1.0" }), "nightly-abc123");
  assert.equal(resolveReleaseTag({ env: {}, packageVersion: "0.1.0" }), "v0.1.0");
  assert.throws(() => resolveReleaseTag({ env: {}, packageVersion: "0.0.0-development" }), /VOS_INSTALL_RELEASE_TAG/);
});

test("builds deterministic GitHub release asset URLs", () => {
  assert.equal(
    assetDownloadUrl("v1.0.0", "vos-linux-x64"),
    "https://github.com/2018wzh/VeriSpecOSLab/releases/download/v1.0.0/vos-linux-x64",
  );
});

test("parses and verifies release checksums", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vos-install-test-"));
  try {
    const assetPath = path.join(root, "vos-linux-x64");
    await writeFile(assetPath, "hello\n", "utf8");
    const digest = createHash("sha256").update("hello\n").digest("hex");
    const checksums = parseSha256Sums(`${digest}  vos-linux-x64\n`);

    assert.equal(checksums.get("vos-linux-x64"), digest);
    await verifyAssetChecksum(assetPath, "vos-linux-x64", checksums);

    const wrong = new Map([["vos-linux-x64", "0".repeat(64)]]);
    await assert.rejects(
      () => verifyAssetChecksum(assetPath, "vos-linux-x64", wrong),
      /checksum mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the local cache when the packaged binary is already present", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vos-install-cache-"));
  try {
    const vendorDir = path.join(root, "vendor");
    await mkdir(vendorDir, { recursive: true });

    const binaryPath = path.join(vendorDir, "vos");
    await writeFile(binaryPath, "#!/bin/sh\necho cached\n", "utf8");

    let fetchCalls = 0;
    const result = await installPrebuilt({
      packageRoot: root,
      packageVersion: "0.1.0",
      platform: "linux",
      arch: "x64",
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("network should not be used for a cache hit");
      },
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.binaryPath, binaryPath);
    assert.deepEqual(result.target, {
      assetName: "vos-linux-x64",
      binaryName: "vos",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fails clearly when the bundled runtime package is missing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vos-runtime-missing-"));
  try {
    const binDir = path.join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await copyFile(new URL("../../bin/vos.js", import.meta.url), path.join(binDir, "vos.js"));
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "vos", type: "module" }, null, 2),
      "utf8",
    );

    const child = spawnSync(process.execPath, [path.join(binDir, "vos.js")], {
      cwd: root,
      encoding: "utf8",
    });

    assert.notEqual(child.status, 0);
    assert.match(`${child.stderr}\n${child.stdout}`, /bundled runtime package is missing|runtime package is missing/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
