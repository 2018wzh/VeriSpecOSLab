#!/usr/bin/env bun

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.join(packageRoot, "vos");
const cliEntrypoint = path.join(workspaceRoot, "apps", "vos-cli", "app", "main.ts");

if (!existsSync(path.join(workspaceRoot, "package.json")) || !existsSync(cliEntrypoint)) {
  console.error("vos: incomplete installation; reinstall with `bun install -g github:2018wzh/VeriSpecOSLab`.");
  process.exit(1);
}

if (!existsSync(path.join(workspaceRoot, "node_modules", ".bun"))) {
  console.error("vos: installing bundled workspace dependencies...");
  const install = Bun.spawnSync([process.execPath, "install"], {
    cwd: workspaceRoot,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (install.exitCode !== 0) {
    console.error("vos: dependency installation failed; rerun `bun install -g github:2018wzh/VeriSpecOSLab`.");
    process.exit(install.exitCode ?? 1);
  }
}

const cli = Bun.spawnSync([process.execPath, cliEntrypoint, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(cli.exitCode ?? 1);
