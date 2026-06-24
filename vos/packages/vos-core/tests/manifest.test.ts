import { describe, expect, test } from "bun:test";
import { parseToolchainManifest } from "../src/runtime/manifest.ts";

const validManifest = {
  manifest_version: 2,
  files: ["Makefile"],
  environment: {
    required_tools: [{ name: "true", command: "true", version_args: ["--version"], version_constraint: ">=0", kind: "utility" }],
  },
  build: {
    variants: [{ id: "baseline", commands: ["make all"], artifacts: ["build/kernel.bin"] }],
  },
  run: {
    profiles: [{ id: "default", command: "qemu-system-riscv64", args: ["-kernel", "build/kernel.bin"], artifacts: ["build/kernel.bin"] }],
    cases: [{ id: "boot-smoke", profile: "default", success_regex: "XV6_BOOT_OK" }],
  },
  test: {
    suites: [
      { name: "boot-smoke", kind: "qemu-case", build_variant: "baseline", run_case: "boot-smoke" },
      { name: "static", kind: "command", command: ["sh", "tests/static.sh"] },
    ],
  },
};

describe("toolchain manifest v2 schema", () => {
  test("accepts explicit build variants, run cases, and object suites", () => {
    expect(parseToolchainManifest(validManifest).test.suites.map((suite) => suite.name)).toEqual(["boot-smoke", "static"]);
  });

  test("rejects legacy manifest shapes and unknown suite references", () => {
    expect(() => parseToolchainManifest({
      files: ["Makefile"],
      build: { commands: ["make all"], artifacts: ["build/kernel.bin"] },
      run: { command: "qemu", successSignal: "ok", artifact: "build/kernel.bin" },
      test: { suites: ["boot-smoke"] },
    })).toThrow(/invalid toolchain manifest v2/);

    expect(() => parseToolchainManifest({
      ...validManifest,
      test: { suites: [{ name: "bad", kind: "qemu-case", build_variant: "baseline", run_case: "missing" }] },
    })).toThrow(/unknown run case/);
  });
});
