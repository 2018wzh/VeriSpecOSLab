import { describe, expect, test } from "bun:test";
import { parseArgs } from "../app/cli.ts";

describe("vos-cli agent command parsing", () => {
  test("parses agent plan with project root and stage", () => {
    const parsed = parseArgs([
      "bun",
      "vos",
      "--project-root",
      "examples/xv6-spec",
      "agent",
      "plan",
      "--stage",
      "syscall",
      "check allocator design",
    ]);

    expect(parsed.global.projectRoot).toBe("examples/xv6-spec");
    expect(parsed.command).toEqual({
      kind: "agent_plan",
      task: "check allocator design",
      scope: "syscall",
    });
  });

  test("parses full xv6 agent generate flow flags", () => {
    const parsed = parseArgs([
      "bun",
      "vos",
      "--project-root=examples/xv6-spec",
      "agent",
      "generate",
      "kernel/memory",
      "--apply",
      "--build",
      "--run",
    ]);

    expect(parsed.command).toEqual({
      kind: "agent_generate",
      target: "kernel/memory",
      task: undefined,
      apply: true,
      build: true,
      run: true,
    });
  });

  test("rejects unknown agent generate flags", () => {
    expect(() =>
      parseArgs(["bun", "vos", "agent", "generate", "--mystery"])
    ).toThrow(/unknown flag for agent generate/);
  });

  test("rejects agent generate dependency violations", () => {
    expect(() =>
      parseArgs(["bun", "vos", "agent", "generate", "--run"])
    ).toThrow(/--run` requires `--build/);

    expect(() =>
      parseArgs(["bun", "vos", "agent", "generate", "--build"])
    ).toThrow(/--build` requires `--apply/);
  });

  test("parses agent validate-generated with patch and retained worktree", () => {
    const parsed = parseArgs([
      "bun",
      "vos",
      "agent",
      "validate-generated",
      "--target",
      "full-syscall",
      "--patch-file",
      "candidate.patch",
      "--keep-worktree",
    ]);

    expect(parsed.command).toEqual({
      kind: "agent_validate_generated",
      target: "full-syscall",
      patchFile: "candidate.patch",
      keepWorktree: true,
    });
  });

  test("rejects agent validate-generated without a target", () => {
    expect(() =>
      parseArgs(["bun", "vos", "agent", "validate-generated"])
    ).toThrow(/requires --target/);
  });

  test("parses verify trace as the concise trace validation entrypoint", () => {
    const parsed = parseArgs([
      "bun",
      "vos",
      "verify",
      "trace",
      "--target",
      "full-syscall",
      "--patch-file",
      "candidate.patch",
      "--keep-worktree",
    ]);

    expect(parsed.command).toEqual({
      kind: "verify",
      scope: "trace",
      target: "full-syscall",
      dryRun: false,
      patchFile: "candidate.patch",
      keepWorktree: true,
    });
  });
});
