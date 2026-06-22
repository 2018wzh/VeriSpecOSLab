import { describe, expect, test } from "bun:test";
import { parseArgs } from "../app/cli.ts";

describe("vos-cli agent command parsing", () => {
  test("parses portal auth commands", () => {
    expect(parseArgs([
      "bun",
      "vos",
      "login",
      "--portal-url",
      "https://portal.example",
      "--token",
      "tok_123",
    ]).command).toEqual({
      kind: "login",
      portalUrl: "https://portal.example",
      token: "tok_123",
      tokenStdin: false,
    });

    expect(parseArgs([
      "bun",
      "vos",
      "login",
      "--portal-url=https://portal.example",
      "--token-stdin",
    ]).command).toEqual({
      kind: "login",
      portalUrl: "https://portal.example",
      token: undefined,
      tokenStdin: true,
    });

    expect(parseArgs(["bun", "vos", "logout", "--portal-url", "https://portal.example"]).command)
      .toEqual({ kind: "logout", portalUrl: "https://portal.example" });
    expect(parseArgs(["bun", "vos", "whoami"]).command).toEqual({ kind: "whoami", portalUrl: undefined });
  });

  test("parses single-project vos serve binding", () => {
    const parsed = parseArgs([
      "bun",
      "vos",
      "serve",
      "--project-root",
      ".",
      "--portal-url",
      "https://portal.example",
      "--project-id",
      "project-1",
      "--host",
      "127.0.0.1",
      "--port",
      "8788",
    ]);

    expect(parsed.command).toEqual({
      kind: "serve",
      portalUrl: "https://portal.example",
      projectId: "project-1",
      host: "127.0.0.1",
      port: 8788,
    });
  });

  test("parses build generate and ledger record commands", () => {
    expect(parseArgs([
      "bun",
      "vos",
      "build",
      "generate",
      "--agent-session",
      "agent-session-1",
    ]).command).toEqual({
      kind: "build_generate",
      agentSession: "agent-session-1",
    });

    expect(parseArgs([
      "bun",
      "vos",
      "ledger",
      "record",
      "--actor",
      "human",
      "--intent",
      "document manual fix",
      "--spec-ref",
      "kernel/syscall.sys_write",
      "--changed-target",
      "kernel/syscall.c",
    ]).command).toEqual({
      kind: "ledger_record",
      actor: "human",
      intent: "document manual fix",
      specRefs: ["kernel/syscall.sys_write"],
      changedTargets: ["kernel/syscall.c"],
    });
  });

  test("rejects incomplete vos serve binding", () => {
    expect(() => parseArgs(["bun", "vos", "serve", "--portal-url", "https://portal.example"]))
      .toThrow(/--project-id/);
    expect(() => parseArgs(["bun", "vos", "serve", "--project-id", "project-1"]))
      .toThrow(/--portal-url/);
  });

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
    expect(parsed.global.progress).toBe("auto");
    expect(parsed.command).toEqual({
      kind: "agent_plan",
      task: "check allocator design",
      scope: "syscall",
    });
  });

  test("parses global progress modes", () => {
    expect(parseArgs(["bun", "vos", "--progress", "never", "doctor"]).global.progress).toBe("never");
    expect(parseArgs(["bun", "vos", "--progress=always", "doctor"]).global.progress).toBe("always");
    expect(() => parseArgs(["bun", "vos", "--progress", "loud", "doctor"])).toThrow(
      /--progress must be one of/,
    );
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

  test("parses agent review-spec target and rejects spec patch stdin", () => {
    expect(parseArgs(["bun", "vos", "agent", "review-spec", "--target", "memory"]).command).toEqual({
      kind: "agent_review_spec",
      target: "memory",
    });
    expect(() => parseArgs(["bun", "vos", "spec", "patch", "lint", "-"])).toThrow("SpecPatch YAML path or commit-ish");
    expect(() => parseArgs(["bun", "vos", "spec", "patch", "apply", "-"])).toThrow("SpecPatch YAML path or commit-ish");
  });

  test("parses knowledgebase ask and CRUD commands", () => {
    expect(parseArgs(["bun", "vos", "agent", "ask", "--stage", "memory", "How should I design kalloc?"]).command)
      .toEqual({
        kind: "agent_ask",
        question: "How should I design kalloc?",
        scope: "memory",
      });

    expect(parseArgs([
      "bun",
      "vos",
      "kb",
      "add",
      "docs/manual.md",
      "--source-kind",
      "course",
      "--stage",
      "memory",
      "--title",
      "Memory Manual",
      "--recursive",
      "--manifest",
      "kb-manifest.json",
    ]).command)
      .toEqual({
        kind: "kb_add",
        source: "docs/manual.md",
        sourceKind: "course",
        stage: "memory",
        title: "Memory Manual",
        recursive: true,
        manifestPath: "kb-manifest.json",
      });
    expect(parseArgs(["bun", "vos", "kb", "search", "allocator invariant"]).command)
      .toEqual({ kind: "kb_search", query: "allocator invariant" });
    expect(parseArgs(["bun", "vos", "kb", "list"]).command).toEqual({ kind: "kb_list" });
    expect(parseArgs(["bun", "vos", "kb", "remove", "kb-123"]).command).toEqual({ kind: "kb_remove", id: "kb-123" });
    expect(parseArgs(["bun", "vos", "kb", "clear"]).command).toEqual({ kind: "kb_clear" });
    expect(parseArgs(["bun", "vos", "kb", "export-manifest", "--out", "manifest.json"]).command)
      .toEqual({ kind: "kb_export_manifest", outPath: "manifest.json" });
    expect(parseArgs(["bun", "vos", "kb", "import-manifest", "manifest.json"]).command)
      .toEqual({ kind: "kb_import_manifest", manifestPath: "manifest.json" });
  });
});
