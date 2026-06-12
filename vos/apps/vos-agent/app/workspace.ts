import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function discoverWorkspaceRoot(startDir = process.cwd()): string {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(startDir);
    current = parent;
  }
}
