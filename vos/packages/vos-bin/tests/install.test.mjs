import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assetForPlatform, binaryPathForPlatform } from "../scripts/runtime.mjs";
import { installBinary } from "../scripts/install.mjs";

test("maps only the supported release platforms", () => {
  assert.equal(assetForPlatform("linux", "x64"), "vos-linux-x64");
  assert.equal(assetForPlatform("win32", "x64"), "vos-windows-x64.exe");
  assert.equal(assetForPlatform("darwin", "arm64"), "vos-macos-arm64");
  assert.throws(() => assetForPlatform("linux", "arm64"), /unsupported platform/);
  assert.throws(() => assetForPlatform("darwin", "x64"), /unsupported platform/);
  assert.throws(() => assetForPlatform("win32", "arm64"), /unsupported platform/);
});

test("rejects a checksum mismatch before installing the binary", async () => {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "vos-bin-test-"));
  const body = Buffer.from("binary-content");
  const asset = "vos-linux-x64";
  const checksum = "b4c7f4f4c4f5df2a4f6d5a8e2e5cbce94f238f4e7e2c2f9c1a0bfe6f1b9b4f2e";
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("SHA256SUMS")) {
      return new Response(`${checksum}  ${asset}\n`, { status: 200 });
    }
    return new Response(body, { status: 200 });
  };

  await assert.rejects(
    installBinary({ packageRoot, platform: "linux", arch: "x64", version: "0.1.0", fetchImpl }),
    /checksum mismatch/,
  );
  assert.equal(calls.length, 2);
});

test("downloads and installs a checksum-matching binary", async () => {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "vos-bin-test-"));
  const asset = "vos-linux-x64";
  const body = Buffer.from("binary-content");
  const checksum = "37456ce54a2ef39b6c9c1d96ddc978f2edc730744bd2c9872dc1cc9ac886b00e";
  const fetchImpl = async (url) => {
    if (url.endsWith("SHA256SUMS")) {
      return new Response(`${checksum}  ${asset}\n`, { status: 200 });
    }
    return new Response(body, { status: 200 });
  };
  const installedPath = await installBinary({ packageRoot, platform: "linux", arch: "x64", version: "0.1.0", fetchImpl });
  assert.equal(await readFile(installedPath, "utf8"), body.toString());
});

test("fails on HTTP errors and missing checksums", async () => {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "vos-bin-test-"));
  await assert.rejects(
    installBinary({
      packageRoot,
      platform: "linux",
      arch: "x64",
      version: "0.1.0",
      fetchImpl: async () => new Response("missing", { status: 404 }),
    }),
    /HTTP 404/,
  );
  await assert.rejects(
    installBinary({
      packageRoot,
      platform: "linux",
      arch: "x64",
      version: "0.1.0",
      fetchImpl: async (url) => url.endsWith("SHA256SUMS")
        ? new Response("", { status: 200 })
        : new Response("binary", { status: 200 }),
    }),
    /checksum.*missing or invalid/,
  );
});

test("reuses an existing binary only when its checksum matches", async () => {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "vos-bin-test-"));
  const asset = "vos-windows-x64.exe";
  const body = Buffer.from("binary-content");
  const binaryPath = binaryPathForPlatform(packageRoot, "win32", "x64");
  await writeFile(binaryPath, body).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, body);
  });
  await chmod(binaryPath, 0o755);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("SHA256SUMS")) {
      return new Response("37456ce54a2ef39b6c9c1d96ddc978f2edc730744bd2c9872dc1cc9ac886b00e  vos-windows-x64.exe\n", { status: 200 });
    }
    return new Response("", { status: 500 });
  };
  await installBinary({ packageRoot, platform: "win32", arch: "x64", version: "0.1.0", fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(await readFile(binaryPath, "utf8"), body.toString());
});
