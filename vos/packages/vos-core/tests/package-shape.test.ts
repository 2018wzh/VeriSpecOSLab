import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

  test("owns student execution primitives in vos-runtime without the retired adapter contract", () => {
    const root = join(import.meta.dir, "..", "..");
    const runtime = readFileSync(join(root, "vos-runtime", "src", "index.ts"), "utf8");
    const coreMain = readFileSync(join(root, "vos-core", "src", "main.ts"), "utf8");

    expect(runtime).toContain("export interface Runner");
    expect(runtime).toContain("export class HostRunner");
    expect(runtime).toContain("export class QemuRunner");
    expect(runtime).toContain("export class HardwareRunner");
    expect(runtime).not.toContain("ToolchainSpec");
    expect(runtime).not.toContain("InMemoryAdapterRegistry");
    expect(coreMain).toContain('from "vos-runtime"');
    expect(coreMain).not.toContain("computeToolchainSpecHash");
  });
});
