import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("workspace package shape", () => {
  test("keeps only the consolidated VOS packages", () => {
    const root = join(import.meta.dir, "..", "..");
    expect(existsSync(join(root, "vos-core"))).toBe(true);
    expect(existsSync(join(root, "vos-runtime"))).toBe(true);
    expect(existsSync(join(root, "vos-kb"))).toBe(true);
    expect(existsSync(join(root, "vos-spec"))).toBe(true);
    expect(existsSync(join(root, "vos-server"))).toBe(true);
    expect(existsSync(join(root, "vos-adapter"))).toBe(false);
    expect(existsSync(join(root, "vos-policy"))).toBe(false);
    expect(existsSync(join(root, "vos-evidence"))).toBe(false);
    expect(existsSync(join(root, "vos-agent-session"))).toBe(false);
  });
});
