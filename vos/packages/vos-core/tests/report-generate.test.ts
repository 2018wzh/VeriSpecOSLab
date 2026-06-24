import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceWriter } from "../src/evidence/index.ts";
import { executeCliInvocation } from "../src/main.ts";
import { generateCourseReport } from "../src/report/generate.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("report generate", () => {
  test("generates strict stage markdown and JSON summary from public verify evidence", async () => {
    const projectRoot = makeReportFixture();
    writeVerifySummary(projectRoot);
    writeFileSync(join(projectRoot, ".vos", "agent-log.jsonl"), `${JSON.stringify({
      session_id: "agent-1",
      task_kind: "codegen",
      related_specs: ["kernel/memory.kalloc"],
      output_kind: "json",
      evidence_ref: ".vos/runs/verify-run/manifest.json",
      result: "accepted",
      created_at: "2026-06-23T00:00:00.000Z",
    })}\n`);
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["report", "generate", "--stage", "memory"],
      args: [],
    });
    const result = await generateCourseReport({
      projectRoot,
      stage: "memory",
      final: false,
      visibilityScope: "full",
      evidence,
      agentRunner: async () => ({
        content: JSON.stringify({
          summary: "Memory stage evidence is complete.",
          risks: ["No residual public failures."],
          recommended_next_steps: ["Submit the stage report."],
          limitations: ["Narrative does not decide pass/fail."],
        }),
        events: [],
      }),
    });

    expect(existsSync(result.reportPath)).toBe(true);
    expect(existsSync(result.summaryPath)).toBe(true);
    const markdown = readFileSync(result.reportPath, "utf8");
    expect(markdown).toContain("<!-- vos-section:verification_evidence -->");
    expect(markdown).toContain("verify-page-allocator");
    const summary = JSON.parse(readFileSync(result.summaryPath, "utf8"));
    expect(summary.requirements_total).toBe(1);
    expect(summary.requirements_passed).toBe(1);
    expect(summary.ai_used).toBe(true);
  });

  test("fails when required public verify summary is missing", async () => {
    const projectRoot = makeReportFixture();
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["report", "generate", "--stage", "memory"],
      args: [],
    });
    await expect(generateCourseReport({
      projectRoot,
      stage: "memory",
      final: false,
      visibilityScope: "full",
      evidence,
      agentRunner: async () => ({ content: "{}", events: [] }),
    })).rejects.toThrow(/requires a prior `vos verify public` summary/);
  });

  test("generates final synthesis report", async () => {
    const projectRoot = makeReportFixture();
    writeVerifySummary(projectRoot);
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["report", "generate", "--final"],
      args: [],
    });
    const result = await generateCourseReport({
      projectRoot,
      final: true,
      visibilityScope: "full",
      evidence,
      agentRunner: async () => ({
        content: JSON.stringify({
          summary: "Final report is complete.",
          risks: [],
          recommended_next_steps: ["Submit the final package."],
          limitations: [],
        }),
        events: [],
      }),
    });
    expect(result.summary.kind).toBe("final");
    expect(result.reportPath.endsWith("spec/reports/final-synthesis-report.md")).toBe(true);
    expect(readFileSync(result.reportPath, "utf8")).toContain("Final Synthesis Report");
  });

  test("fails when agent narrative output is invalid", async () => {
    const projectRoot = makeReportFixture();
    writeVerifySummary(projectRoot);
    const evidence = await EvidenceWriter.create({
      projectRoot,
      evidenceDir: ".vos",
      command: ["report", "generate", "--stage", "memory"],
      args: [],
    });
    await expect(generateCourseReport({
      projectRoot,
      stage: "memory",
      final: false,
      visibilityScope: "full",
      evidence,
      agentRunner: async () => ({ content: JSON.stringify({ summary: "" }), events: [] }),
    })).rejects.toThrow();
  });

  test("CLI path auto-commits generated report and appends ledger", async () => {
    const projectRoot = makeReportFixture();
    writeVerifySummary(projectRoot);
    git(projectRoot, ["init"]);
    git(projectRoot, ["config", "user.email", "test@example.com"]);
    git(projectRoot, ["config", "user.name", "VOS Test"]);
    git(projectRoot, ["add", "."]);
    git(projectRoot, ["commit", "-m", "initial"]);
    const head = git(projectRoot, ["rev-parse", "HEAD"]).trim();
    writeFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), `${JSON.stringify({
      commit_sha: head,
      actor: "human",
      spec_refs: [],
      changed_targets: [],
      evidence_refs: [],
      created_at: "2026-06-23T00:00:00.000Z",
      collaboration_intent: "initial fixture",
    })}\n`);

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "report",
      "generate",
      "--stage",
      "memory",
    ], {
      print: false,
      agentRunner: async () => ({
        content: JSON.stringify({
          summary: "Memory report is ready.",
          risks: [],
          recommended_next_steps: ["Submit the report."],
          limitations: ["Generated from public evidence."],
        }),
        events: [],
      }),
    });

    expect(result.status).toBe("passed");
    expect(result.details?.commit_sha).toBeString();
    expect(readFileSync(join(projectRoot, "spec", "reports", "stage-memory-report.md"), "utf8")).toContain("Memory report is ready.");
    const summary = JSON.parse(readFileSync(join(projectRoot, ".vos", "report", "stage-memory-summary.json"), "utf8"));
    expect(summary.ai_used).toBe(true);
    expect(summary.sections.ai_involvement).toContainEqual(expect.objectContaining({ task_kind: "report_narrative" }));
    const ledger = readFileSync(join(projectRoot, ".vos", "commit-ledger.jsonl"), "utf8");
    expect(ledger).toContain(result.details?.commit_sha as string);
    expect(git(projectRoot, ["log", "-1", "--pretty=%s"]).trim()).toBe("[vos][report] Generate memory report");
  });
});

function makeReportFixture(): string {
  const root = join("/tmp", `vos-cli-report-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  roots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "architecture", "slices"), { recursive: true });
  mkdirSync(join(root, "spec", "modules", "kernel", "memory", "ops"), { recursive: true });
  mkdirSync(join(root, "spec", "verification"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), "project_id: report-test\nspec_root: spec\ncurrent_stage: memory\n");
  writeFileSync(join(root, ".vos", "policy.yaml"), "allowed_commands:\n  - report generate\nvisibility_scope: staff-only\n");
  writeFileSync(join(root, "spec", "architecture", "timeline.yaml"), [
    "timeline:",
    "  - stage: memory",
    "    slice: memory-slice",
    "    enabled_modules: [kernel/memory]",
    "    validation_gate: [verify-page-allocator]",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "architecture", "slices", "02-memory.yaml"), [
    "id: memory-slice",
    "stage: memory",
    "enabled_modules: [kernel/memory]",
    "validation_gate: [verify-page-allocator]",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "module.yaml"), [
    "id: kernel/memory",
    "module: kernel/memory",
    "stage: memory",
    "purpose: allocator",
    "related_slices: [memory-slice]",
    "related_adrs: []",
    "owned_state: [freelist]",
    "exported_interfaces: [kalloc]",
    "imported_interfaces: []",
    "module_invariants: [aligned]",
    "error_model: [null on exhaustion]",
    "resource_lifetime_rules: [free after alloc]",
    "security_boundary: [kernel only]",
    "test_surfaces: [allocator]",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "modules", "kernel", "memory", "ops", "kalloc.yaml"), [
    "id: kernel/memory.kalloc",
    "stage: memory",
    "module: kernel/memory",
    "operation: kalloc",
    "purpose: allocate page",
    "depends_on:",
    "  requires_modules: [kernel/memory]",
    "  requires_ops: []",
    "guarantee:",
    "  returns: [page]",
    "preconditions: [initialized]",
    "postconditions: [aligned]",
    "invariants_preserved: [freelist]",
    "failure_semantics: [null on exhaustion]",
    "test_obligations:",
    "  public: [kalloc_alignment]",
    "  generated: []",
    "  hidden_tags: []",
    "codegen:",
    "  targets: []",
    "  required_followup_checks: []",
    "related_slice: memory-slice",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "verification", "public-matrix.yaml"), [
    "public_requirements:",
    "  - id: verify-page-allocator",
    "    related_specs: [kernel/memory.kalloc]",
    "    required_tests: [kalloc_alignment]",
    "    required_artifacts: [build/kernel.elf]",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "verification", "report-contract.yaml"), [
    "report_contract:",
    "  version: '1.0'",
    "  required_sections:",
    "    - section: architecture_reference",
    "    - section: module_specs_covered",
    "    - section: verification_evidence",
    "    - section: spec_evolution",
    "    - section: ai_involvement",
    "    - section: references",
    "    - section: agent_narrative_summary",
    "",
  ].join("\n"));
  return root;
}

function writeVerifySummary(projectRoot: string): void {
  mkdirSync(join(projectRoot, ".vos", "runs", "verify-run", "artifacts", "verify"), { recursive: true });
  writeFileSync(join(projectRoot, ".vos", "runs", "verify-run", "artifacts", "verify", "public-summary.json"), JSON.stringify({
    status: "ok",
    requirements: [{
      id: "verify-page-allocator",
      status: "ok",
      tests: [{ id: "kalloc_alignment", status: "ok" }],
      artifacts: [{ path: "build/kernel.elf", status: "ok" }],
    }],
  }, null, 2));
  writeFileSync(join(projectRoot, ".vos", "runs", "verify-run", "manifest.json"), JSON.stringify({
    run_id: "verify-run",
    command: ["verify", "public"],
    arguments: [],
    started_at: "2026-06-23T00:00:00.000Z",
    finished_at: "2026-06-23T00:00:01.000Z",
    status: "ok",
    artifacts: [{
      kind: "verify-summary",
      path: ".vos/runs/verify-run/artifacts/verify/public-summary.json",
      summary: "public verification summary",
    }],
    evidence_refs: [],
    project_root: projectRoot,
  }, null, 2));
}

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || proc.stdout.toString());
  }
  return proc.stdout.toString();
}
