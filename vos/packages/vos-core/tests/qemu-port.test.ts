import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { executeCliInvocation } from "../src/main.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("QEMU port workflow", () => {
  test("fails before invoking the Agent when no student materials were supplied", async () => {
    const root = prepareRequestProject();
    rmSync(join(root, "references", "qemu", "qemu.board", "manual.pdf"));
    let invoked = false;
    const result = await executeCliInvocation([
      "bun", "vos", "--project-root", root, "--json", "agent", "qemu", "preflight", "qemu.board",
    ], {
      print: false,
      agentRunner: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    });
    expect(result.status).toBe("validation_failed");
    expect(result.details?.candidate_created).toBe(false);
    expect(result.details?.reasons).toEqual([
      "materials directory is missing or contains no regular files: references/qemu/qemu.board",
    ]);
    expect(invoked).toBe(false);
  }, 30_000);

  test("reports insufficient materials without generating a candidate and saves resume state", async () => {
    const root = prepareRequestProject();
    const result = await runWithAgent(root, {
      status: "insufficient",
      missing: [{ role: "board-schematic", reason: "board wiring is not supplied" }],
      reasons: ["board wiring cannot be established"],
      boot_path: {}, reuse_matrix: [], findings: [], phases: [], dependencies: [], owns: [], notes: [], summary: "insufficient",
    });
    expect(result.status).toBe("validation_failed");
    expect(result.details?.candidate_created).toBe(false);
    expect(existsSync(join(root, "spec", "qemu", "qemu.board.r1.yaml"))).toBe(false);
    expect(existsSync(join(root, ".vos", "agent-runs", result.run_id, "recovery.json"))).toBe(true);
  }, 30_000);

  test("creates a new candidate revision only after a sufficient structured result", async () => {
    const root = prepareRequestProject();
    const result = await runWithAgent(root, {
      status: "sufficient",
      missing: [], reasons: [],
      boot_path: { entry: "BL31", bypasses: ["SPL"] },
      reuse_matrix: [{ device: "UART0", decision: "integrate" }],
      findings: [],
      phases: [{ id: "boot", acceptance: "shell" }],
      dependencies: [],
      owns: ["qemu/hw/arm", "scripts", "docs"],
      notes: ["minimal firmware chain approved"],
      summary: "sufficient",
    });
    expect(result.status).toBe("passed");
    const candidate = join(root, String(result.details?.candidate));
    expect(existsSync(candidate)).toBe(true);
    const source = readFileSync(candidate, "utf8");
    expect(source).toContain("status: candidate");
    expect(source).toContain("goal: shell");
    expect(source).toContain("sha256:");
    git(root, ["add", String(result.details?.candidate)]);
    git(root, ["commit", "-m", "keep first candidate"]);
    const rerun = await runWithAgent(root, {
      status: "sufficient", missing: [], reasons: [], boot_path: { entry: "BL31" },
      reuse_matrix: [], findings: [], phases: [{ id: "boot" }], dependencies: [],
      owns: ["qemu/hw/arm"], notes: [], summary: "sufficient",
    });
    expect(rerun.details?.revision).toBe(2);
  }, 30_000);

  test("executes an approved Spec in a detached worktree and atomically lands the QEMU component commit", async () => {
    const { root, qemuCommit } = prepareApprovedProject();
    const before = git(root, ["rev-parse", "HEAD"]).trim();
    const previousProtocol = process.env.GIT_ALLOW_PROTOCOL;
    process.env.GIT_ALLOW_PROTOCOL = "file";
    let result;
    try {
      result = await executeCliInvocation([
        "bun", "vos", "--project-root", root, "--json", "agent", "qemu", "execute", "qemu.board.r1",
      ], {
        print: false,
        agentRunner: async (options) => {
          const target = join(options.projectRoot, "qemu", "hw", "arm", "demo-board.c");
          mkdirSync(join(options.projectRoot, "qemu", "hw", "arm"), { recursive: true });
          writeFileSync(target, "/* generated demo board machine */\n");
          return {
            content: "submitted",
            threadId: "qemu-execute-thread",
            events: acceptedSubmitEvents("qemu_execution_result.v1", {
              status: "passed",
              changed_paths: ["qemu/hw/arm/demo-board.c"],
              validations: ["Agent loop reached a shell"],
              phase_commits: [],
              dependency_pins: [],
              summary: "Demo board reached the Agent-defined shell acceptance point.",
              diagnostics: [],
              resume_steps: [],
            }).map((event) => ({ ...event, thread_id: "qemu-execute-thread" })),
          };
        },
      });
    } finally {
      if (previousProtocol === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
      else process.env.GIT_ALLOW_PROTOCOL = previousProtocol;
    }
    expect(result.status).toBe("passed");
    const after = git(root, ["rev-parse", "HEAD"]).trim();
    expect(after).not.toBe(before);
    const landedQemuCommit = git(root, ["rev-parse", "HEAD:qemu"]).trim();
    expect(landedQemuCommit).not.toBe(qemuCommit);
    expect(existsSync(join(root, "qemu", "hw", "arm", "demo-board.c"))).toBe(true);
    expect(git(root, ["status", "--porcelain"]).trim()).toBe("");
  }, 30_000);

  test("rejects an approved Spec that is ignored instead of committed", async () => {
    const { root } = prepareApprovedProject();
    writeFileSync(join(root, ".gitignore"), ".vos/*\n.env\nreferences/qemu/**/*\nspec/qemu/ignored.yaml\n");
    git(root, ["add", ".gitignore"]);
    git(root, ["commit", "-m", "ignore uncommitted qemu spec"]);
    const source = readFileSync(join(root, "spec", "qemu", "board.r1.yaml"), "utf8")
      .replace("id: qemu.board.r1", "id: qemu.ignored.r1")
      .replace("request_id: qemu.board", "request_id: qemu.ignored");
    writeFileSync(join(root, "spec", "qemu", "ignored.yaml"), source);
    const result = await executeCliInvocation([
      "bun", "vos", "--project-root", root, "--json", "agent", "qemu", "execute", "qemu.ignored.r1",
    ], { print: false });
    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("must be committed exactly at the current HEAD");
  }, 30_000);

  test("rejects approved owns that include protected project state", async () => {
    const { root } = prepareApprovedProject();
    const specPath = join(root, "spec", "qemu", "board.r1.yaml");
    writeFileSync(specPath, readFileSync(specPath, "utf8").replace("owns: [qemu/hw/arm]", "owns: [vos.yaml]"));
    git(root, ["add", "spec/qemu/board.r1.yaml"]);
    git(root, ["commit", "-m", "approve invalid protected ownership"]);
    const result = await executeCliInvocation([
      "bun", "vos", "--project-root", root, "--json", "agent", "qemu", "execute", "qemu.board.r1",
    ], { print: false });
    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("owns protected project or evidence paths");
    expect(result.details?.violations).toEqual(["vos.yaml"]);
  }, 30_000);
});

function prepareRequestProject(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-qemu-port-"));
  const qemuOrigin = mkdtempSync(join(tmpdir(), "vos-qemu-origin-"));
  roots.push(root, qemuOrigin);
  git(qemuOrigin, ["init"]);
  git(qemuOrigin, ["config", "user.name", "QEMU Test"]);
  git(qemuOrigin, ["config", "user.email", "qemu@example.invalid"]);
  writeFileSync(join(qemuOrigin, "VERSION"), "11.1.0\n");
  writeFileSync(join(qemuOrigin, "README.rst"), "fake pinned QEMU source\n");
  git(qemuOrigin, ["add", "-A"]);
  git(qemuOrigin, ["commit", "-m", "QEMU base"]);
  git(root, ["init"]);
  git(root, ["config", "user.name", "QEMU Test"]);
  git(root, ["config", "user.email", "qemu@example.invalid"]);
  git(root, ["config", "protocol.file.allow", "always"]);
  git(root, ["-c", "protocol.file.allow=always", "submodule", "add", qemuOrigin, "qemu"]);
  mkdirSync(join(root, "spec", "qemu"), { recursive: true });
  mkdirSync(join(root, "references", "qemu", "qemu.board"), { recursive: true });
  mkdirSync(join(root, ".vos"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".vos/*\n.env\nreferences/qemu/**/*\n");
  writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
  writeFileSync(join(root, ".vos", "config.toml"), [
    "[agent]", 'provider = "openai"', 'model = "test-model"', "[agent.auth]", 'env = "OPENAI_API_KEY"', "",
  ].join("\n"));
  writeFileSync(join(root, "vos.yaml"), [
    "version: vos.project.v1",
    "build: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, artifacts: [] }",
    "runners: {}",
    "checks: {}",
    "",
  ].join("\n"));
  writeFileSync(join(root, "references", "qemu", "qemu.board", "manual.pdf"), "%PDF-1.7\nstudent supplied manual\n");
  writeFileSync(join(root, "spec", "qemu", "request.yaml"), [
    "version: vos.qemu-port.v1",
    "id: qemu.board",
    "revision: 0",
    "status: request",
    "target: { board: Demo Board }",
    "qemu: { version: 11.1.0, source_path: qemu }",
    "",
  ].join("\n"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "add QEMU request and materials"]);
  return root;
}

function prepareApprovedProject(): { root: string; qemuCommit: string } {
  const root = mkdtempSync(join(tmpdir(), "vos-qemu-execute-"));
  const qemuOrigin = mkdtempSync(join(tmpdir(), "vos-qemu-origin-"));
  roots.push(root, qemuOrigin);
  git(qemuOrigin, ["init"]);
  git(qemuOrigin, ["config", "user.name", "QEMU Test"]);
  git(qemuOrigin, ["config", "user.email", "qemu@example.invalid"]);
  writeFileSync(join(qemuOrigin, "VERSION"), "11.1.0\n");
  writeFileSync(join(qemuOrigin, "README.rst"), "fake QEMU source\n");
  git(qemuOrigin, ["add", "-A"]);
  git(qemuOrigin, ["commit", "-m", "QEMU base"]);
  const qemuCommit = git(qemuOrigin, ["rev-parse", "HEAD"]).trim();

  git(root, ["init"]);
  git(root, ["config", "user.name", "QEMU Test"]);
  git(root, ["config", "user.email", "qemu@example.invalid"]);
  git(root, ["config", "protocol.file.allow", "always"]);
  git(root, ["-c", "protocol.file.allow=always", "submodule", "add", qemuOrigin, "qemu"]);
  mkdirSync(join(root, "spec", "qemu"), { recursive: true });
  mkdirSync(join(root, "references", "qemu", "qemu.board"), { recursive: true });
  mkdirSync(join(root, ".vos"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), ".vos/*\n.env\nreferences/qemu/**/*\n");
  writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
  writeFileSync(join(root, ".vos", "config.toml"), [
    "[agent]", 'provider = "openai"', 'model = "test-model"', "[agent.auth]", 'env = "OPENAI_API_KEY"', "",
  ].join("\n"));
  writeFileSync(join(root, "vos.yaml"), [
    "version: vos.project.v1",
    "build: { program: bun, args: [--version], cwd: ., env: [], timeout: 30000, artifacts: [] }",
    "runners: {}",
    "checks: {}",
    "",
  ].join("\n"));
  const material = "%PDF-1.7\nstudent supplied manual\n";
  const materialPath = join(root, "references", "qemu", "qemu.board", "manual.pdf");
  writeFileSync(materialPath, material);
  const materialHash = createHash("sha256").update(material).digest("hex");
  writeFileSync(join(root, "spec", "qemu", "board.r1.yaml"), [
    "version: vos.qemu-port.v1",
    "id: qemu.board.r1",
    "request_id: qemu.board",
    "revision: 1",
    "status: approved",
    "target: { board: Demo Board }",
    `qemu: { version: 11.1.0, source_path: qemu, commit: ${qemuCommit} }`,
    "materials_dir: references/qemu/qemu.board",
    `materials: [{ id: manual, role: hardware-manual, path: references/qemu/qemu.board/manual.pdf, sha256: '${materialHash}', size: ${Buffer.byteLength(material)}, caveats: [] }]`,
    "preflight:",
    "  run_id: run-preflight",
    "  boot_path: { entry: BL31, bypasses: [SPL] }",
    "  reuse_matrix: [{ device: UART0, decision: integrate }]",
    "  findings: []",
    "  notes: []",
    "implementation:",
    "  owns: [qemu/hw/arm]",
    "  phases: [{ id: boot, acceptance: shell }]",
    "  dependencies: []",
    "acceptance: { goal: shell, agent_defined: true }",
    "",
  ].join("\n"));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "approve QEMU port Spec"]);
  return { root, qemuCommit };
}

async function runWithAgent(root: string, payload: unknown) {
  return executeCliInvocation([
    "bun", "vos", "--project-root", root, "--json", "agent", "qemu", "preflight", "qemu.board",
  ], {
    print: false,
    agentRunner: async (options) => ({
      content: "submitted",
      threadId: "qemu-preflight-thread",
      events: acceptedSubmitEvents("qemu_preflight_result.v1", payload).map((event) => ({ ...event, thread_id: "qemu-preflight-thread" })),
    }),
  });
}

function acceptedSubmitEvents(schemaId: string, result: unknown): Array<Record<string, unknown>> {
  return [
    { type: "tool.call", name: "mcp__vos-progress__submit_result", id: "submit", arguments: JSON.stringify({ schema_id: schemaId, result }) },
    { type: "tool.result", name: "mcp__vos-progress__submit_result", id: "submit", content: JSON.stringify({ type: "vos-result-submission", schema_id: schemaId, accepted: true }) },
  ];
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  return result.stdout.toString();
}
