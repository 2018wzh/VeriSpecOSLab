/**
 * Run `fn` with `process.cwd()` temporarily set to `dir`. Restores the
 * original cwd even if `fn` throws. Bun tests run sequentially within a
 * file, so this is race-free per-file.
 */
export async function withCwd<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
