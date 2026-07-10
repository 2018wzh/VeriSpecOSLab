import path from "node:path";
import { fileURLToPath } from "node:url";

export function assetForPlatform(platform = process.platform, arch = process.arch) {
  if (platform === "linux" && arch === "x64") return "vos-linux-x64";
  if (platform === "win32" && arch === "x64") return "vos-windows-x64.exe";
  if (platform === "darwin" && arch === "arm64") return "vos-macos-arm64";
  throw new Error(`unsupported platform for vos-bin: ${platform}-${arch}`);
}

export function binaryPathForPlatform(packageRoot, platform = process.platform, arch = process.arch) {
  return path.join(packageRoot, "vendor", assetForPlatform(platform, arch));
}

export function resolveBinaryPath(packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  return binaryPathForPlatform(packageRoot);
}
