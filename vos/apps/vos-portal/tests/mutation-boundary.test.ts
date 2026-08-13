import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("every HTTP mutation declares an idempotency guard or a reviewed protocol exemption", async () => {
  const source = await readFile(path.join(import.meta.dir, "..", "server", "http.ts"), "utf8");
  const exemptions = [
    "/internal/gitea/webhook", // signed delivery_id is the idempotency identity
    "/internal/worker/", // short-lived worker identity plus lease ownership is the idempotency boundary
    "/auth/device/token", // hashed device_code is atomically consumed and replay-safe
    "/courses/import/dry-run", // validation query; it does not persist state
    "const downloadObject=", // authorized signed-URL query; it does not persist state
  ];
  const lines = source.split("\n");
  const handlers = lines.flatMap((line, index) => /request\.method\s*===\s*"(POST|PUT|PATCH|DELETE)"/.test(line) ? [{ line, index }] : []);
  expect(handlers.length).toBeGreaterThan(20);
  for (const handler of handlers) {
    const context = lines.slice(handler.index, handler.index + 8).join("\n");
    const guarded = context.includes("mutationGuard(") || context.includes("unauthenticatedMutationGuard(");
    const exempt = exemptions.some(value => context.includes(value));
    expect(guarded || exempt, handler.line.trim()).toBe(true);
  }
});
