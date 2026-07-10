#!/usr/bin/env node

import { resolveBinaryPath } from "vos-bin";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const binaryPath = resolveBinaryPath();

if (!existsSync(binaryPath)) {
  console.error(`vos: bundled binary is missing; reinstall vos@${process.env.npm_package_version ?? "the requested version"}.`);
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
