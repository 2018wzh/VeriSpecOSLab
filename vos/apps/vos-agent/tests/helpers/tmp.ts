import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Create a unique temporary directory. Caller is responsible for cleanup
 * via {@link removeTmpDir}, typically from an `afterEach` hook.
 */
export function makeTmpDir(prefix = "stars-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTmpDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/**
 * Write a file at `relative` inside `root`, creating parent dirs as needed.
 */
export function writeFixture(root: string, relative: string, content: string): string {
  const absPath = join(root, relative);
  const dir = dirname(absPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(absPath, content, "utf8");
  return absPath;
}
