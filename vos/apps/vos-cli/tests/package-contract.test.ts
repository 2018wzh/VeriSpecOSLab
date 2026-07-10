import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(cliRoot, "..", "..", "..");

describe("vos-cli local link package contract", () => {
  test("is the only CLI distribution package and exposes vos directly", () => {
    const manifest = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));

    expect(manifest.name).toBe("vos-cli");
    expect(manifest.bin).toEqual({ vos: "./app/main.ts" });
    expect(manifest.scripts?.postinstall).toBeUndefined();
    expect(manifest.scripts?.preinstall).toBeUndefined();
    expect(existsSync(join(repositoryRoot, "vos", "packages", "vos-core", "src", "version.generated.ts"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "package.json"))).toBe(false);
    expect(existsSync(join(repositoryRoot, "vos", "packages", "vos-bin", "package.json"))).toBe(false);
  });
});
