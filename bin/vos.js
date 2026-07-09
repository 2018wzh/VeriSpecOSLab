#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binaryName = process.platform === "win32" ? "vos.exe" : "vos";
const binaryPath = path.join(packageRoot, "vendor", binaryName);

if (!existsSync(binaryPath)) {
  console.error("vos: prebuilt binary is missing; reinstall with `npm install -g github:2018wzh/VeriSpecOSLab#v1.0.0`.");
  process.exit(1);
}

const child = spawnSync(binaryPath, process.argv.slice(2), {
  stdio: "inherit",
  windowsHide: true,
});

if (child.error) {
  console.error(`vos: failed to start bundled binary (${child.error.code ?? "spawn failed"})`);
  process.exit(1);
}

if (child.signal) {
  process.kill(process.pid, child.signal);
}

process.exit(child.status ?? 1);
