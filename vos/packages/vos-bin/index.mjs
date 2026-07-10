#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveBundledBinaryPath({
  packageRoot = path.dirname(fileURLToPath(import.meta.url)),
  platform = process.platform,
} = {}) {
  const binaryName = platform === "win32" ? "vos.exe" : "vos";
  const binaryPath = path.join(packageRoot, "vendor", binaryName);
  if (!existsSync(binaryPath)) {
    throw new Error("bundled runtime binary is missing");
  }
  return binaryPath;
}

export function runVosBinary(args = [], options = {}) {
  const binaryPath = resolveBundledBinaryPath(options);
  const child = spawnSync(binaryPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });

  if (child.error) {
    throw new Error(`failed to start bundled binary (${child.error.code ?? "spawn failed"})`);
  }

  if (child.signal) {
    process.kill(process.pid, child.signal);
  }

  process.exit(child.status ?? 1);
}
