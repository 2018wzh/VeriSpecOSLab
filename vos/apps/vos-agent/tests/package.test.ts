import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import packageJson from "../package.json";

describe("package metadata", () => {
  test("brands the package as vos-agent", () => {
    expect(packageJson.name).toBe("vos-agent");
  });

  test("exposes only the vos-agent binary", () => {
    expect(packageJson.bin).toEqual({ "vos-agent": "./app/main.ts" });
  });

  test("build script emits a single vos-agent release binary", () => {
    expect(packageJson.scripts.build).toBe(
      "bun build --compile ./app/main.ts --outfile dist/vos-agent",
    );
  });

  test("vos-agent binary entry has a Bun shebang and executable bit", () => {
    const entry = "app/main.ts";
    expect(readFileSync(entry, "utf8").startsWith("#!/usr/bin/env bun")).toBe(true);
    expect(statSync(entry).mode & 0o111).not.toBe(0);
  });

  test("root bun workspace lockfile includes vos-agent", () => {
    const lockfile = readFileSync("../../bun.lock", "utf8");
    expect(lockfile).toContain('"apps/vos-agent"');
    expect(lockfile).toContain('"name": "vos-agent"');
  });
});
