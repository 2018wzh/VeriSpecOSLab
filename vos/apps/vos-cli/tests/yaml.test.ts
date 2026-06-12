import { describe, expect, test } from "bun:test";
import {
  collectStringListByKey,
  extractTimelineStages,
  parseTopLevelYaml,
} from "../app/utils/yaml.ts";

describe("YAML parsing helpers", () => {
  test("parses nested YAML objects and lists through mature parser", () => {
    const parsed = parseTopLevelYaml([
      "public_requirements:",
      "  - id: verify-boot-banner",
      "    required_artifacts:",
      "      - qemu_boot.log",
      "  - id: verify-sys-write",
      "    required_artifacts:",
      "      - kernel.elf",
      "build:",
      "  allowed_output_path:",
      "    - Makefile",
      "    - xtask/Cargo.toml",
      "operation:",
      "  editable_region:",
      "    file: kernel/boot.c",
      "",
    ].join("\n"));

    expect(collectStringListByKey(parsed, "allowed_output_path")).toEqual([
      "Makefile",
      "xtask/Cargo.toml",
    ]);
    expect(collectStringListByKey(parsed, "file")).toEqual(["kernel/boot.c"]);
  });

  test("extracts timeline stages including inline validation gates", () => {
    const stages = extractTimelineStages([
      "timeline:",
      "  - stage: boot",
      "    slice: boot-minimum",
      "    title: Boot Minimum",
      "    validation_gate: [build, run]",
      "  - stage: syscall",
      "    validation_gate:",
      "      - verify public",
      "",
    ].join("\n"));

    expect(stages).toEqual([
      {
        stage: "boot",
        slice: "boot-minimum",
        title: "Boot Minimum",
        validation_gate: ["build", "run"],
      },
      {
        stage: "syscall",
        slice: undefined,
        title: undefined,
        validation_gate: ["verify public"],
      },
    ]);
  });

  test("preserves advanced YAML syntax via mature parser (nested maps, quoted strings, block scalars)", () => {
    const parsed = parseTopLevelYaml([
      "toolchain:",
      "  build:",
      "    allowed_output_path:",
      "      - Makefile",
      "    generated_artifacts:",
      "      - build/kernel.bin",
      "    policy: |",
      "      allow:",
      "        - spec",
      "        - src",
      "  verify:",
      "    required_artifacts:",
      "      - \"qemu_boot.log\"",
      "      - 'kernel.elf'",
      "",
    ].join("\n"));

    const toolchain = parsed.toolchain as Record<string, unknown>;
    const build = toolchain.build as Record<string, unknown>;
    const verify = toolchain.verify as Record<string, unknown>;

    expect(build?.allowed_output_path).toEqual(["Makefile"]);
    expect(build?.generated_artifacts).toEqual(["build/kernel.bin"]);
    expect(typeof build?.policy).toBe("string");
    expect(build?.policy as string).toContain("allow:\n  - spec\n  - src\n");
    expect(verify?.required_artifacts).toEqual([
      "qemu_boot.log",
      "kernel.elf",
    ]);
  });
});
