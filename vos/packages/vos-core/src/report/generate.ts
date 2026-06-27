import Handlebars from "handlebars";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { EvidenceWriter } from "../evidence/index.ts";
import type { RunManifest } from "../evidence/manifest.ts";
import { CliError, AgentOutputError } from "../errors.ts";
import { appendLogEntry, readLogEntries } from "../agent/helpers.ts";
import { AGENTS_READONLY_GUIDANCE_PROMPT } from "../agent/prompt.ts";
import { parseJsonFromText, runAgentWithPrompt, type HeadlessAgentTaskRunner } from "../agent/runner.ts";
import { currentStageForProject } from "../utils/project.ts";
import { parseTopLevelYaml } from "../utils/yaml.ts";
import {
  buildNormalizedSpecBundle,
  hasBlockingDiagnostics,
  type NormalizedSpecBundle,
} from "vos-spec";

type VisibilityScope = "public" | "agent-only" | "staff-only" | "full";

const REQUIRED_SECTIONS = [
  "architecture_reference",
  "module_specs_covered",
  "verification_evidence",
  "spec_evolution",
  "ai_involvement",
  "references",
  "agent_narrative_summary",
] as const;

const narrativeSchema = z.object({
  summary: z.string().min(1),
  risks: z.array(z.string()).default([]),
  recommended_next_steps: z.array(z.string()).default([]),
  limitations: z.array(z.string()).default([]),
});

const reportSummarySchema = z.object({
  version: z.literal("1.0"),
  kind: z.enum(["stage", "final"]),
  stage: z.string().optional(),
  generated_at: z.string(),
  visibility_scope: z.string(),
  commit_sha: z.string().optional(),
  report_path: z.string(),
  summary_path: z.string(),
  requirements_total: z.number().int().nonnegative(),
  requirements_passed: z.number().int().nonnegative(),
  ai_used: z.boolean(),
  sections: z.object({
    architecture_reference: z.array(z.object({
      id: z.string(),
      path: z.string(),
      kind: z.string(),
    })),
    module_specs_covered: z.array(z.object({
      id: z.string(),
      path: z.string(),
      kind: z.string(),
      stage: z.string().optional(),
    })),
    verification_evidence: z.array(z.object({
      id: z.string(),
      status: z.string(),
      run_id: z.string(),
      tests: z.array(z.object({ id: z.string(), status: z.string(), output: z.string().optional() })),
      artifacts: z.array(z.object({ path: z.string(), status: z.string() })),
    })),
    spec_evolution: z.array(z.object({
      id: z.string(),
      path: z.string().optional(),
      title: z.string().optional(),
      kind: z.string().optional(),
    })),
    ai_involvement: z.array(z.record(z.string(), z.unknown())),
    references: z.array(z.string()),
    agent_narrative_summary: narrativeSchema,
  }),
});

export type ReportSummary = z.infer<typeof reportSummarySchema>;

export interface ReportGenerateResult {
  reportPath: string;
  summaryPath: string;
  agentNarrativePath: string;
  agentAuditPath: string;
  changedTargets: string[];
  specRefs: string[];
  summary: ReportSummary;
}

export async function generateCourseReport(params: {
  projectRoot: string;
  stage?: string;
  final: boolean;
  visibilityScope?: string;
  evidence: EvidenceWriter;
  agentRunner?: HeadlessAgentTaskRunner;
}): Promise<ReportGenerateResult> {
  const projectRoot = params.projectRoot;
  const bundle = await buildNormalizedSpecBundle({ projectRoot });
  if (hasBlockingDiagnostics(bundle.diagnostics)) {
    throw new CliError("report generate requires a valid normalized spec bundle", "validation_failed", {
      diagnostics: bundle.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    });
  }

  const stage = params.final ? undefined : (params.stage ?? await currentStageForProject(projectRoot));
  if (!params.final && !stage) {
    throw new CliError("report generate requires --stage or .vos/project.yaml current_stage", "validation_failed");
  }
  await validateReportContract(projectRoot);

  const visibilityScope = normalizeVisibility(params.visibilityScope);
  const selected = selectSpecScope(bundle, stage, params.final);
  const evidenceItems = await collectVerificationEvidence(projectRoot, bundle, stage, params.final);
  const aiInvolvement = await collectAiInvolvement(projectRoot);
  const specEvolution = bundle.patch_records
    .filter((patch) => params.final || patch.stage === stage)
    .map((patch) => ({ id: patch.id, path: patch.path, title: patch.title, kind: patch.kind }));
  const references = collectReferences(bundle, selected);

  const reportPath = params.final
    ? path.join(projectRoot, "spec", "reports", "final-synthesis-report.md")
    : path.join(projectRoot, "spec", "reports", `stage-${stage}-report.md`);
  const summaryPath = params.final
    ? path.join(projectRoot, ".vos", "report", "final-summary.json")
    : path.join(projectRoot, ".vos", "report", `stage-${stage}-summary.json`);

  const draft = {
    version: "1.0" as const,
    kind: params.final ? "final" as const : "stage" as const,
    stage,
    generated_at: new Date().toISOString(),
    visibility_scope: visibilityScope,
    commit_sha: currentGitHead(projectRoot),
    report_path: path.relative(projectRoot, reportPath),
    summary_path: path.relative(projectRoot, summaryPath),
    requirements_total: evidenceItems.length,
    requirements_passed: evidenceItems.filter((item) => item.status === "ok" || item.status === "passed").length,
    ai_used: aiInvolvement.length > 0,
    sections: {
      architecture_reference: selected.architecture,
      module_specs_covered: selected.specs,
      verification_evidence: evidenceItems,
      spec_evolution: specEvolution,
      ai_involvement: aiInvolvement,
      references,
    },
  };

  validateRequiredInputs(draft);
  const narrative = await generateAgentNarrative({
    projectRoot,
    draft,
    evidence: params.evidence,
    agentRunner: params.agentRunner,
  });
  const reportAuditEntry = {
    session_id: params.evidence.run_id,
    task_kind: "report_narrative",
    agent_profile: {
      prompt_id: "reporter.v2",
      mode: "course-report",
      skills: [],
      mcp_servers: [],
      output_schema: "ReportNarrative",
    },
    related_specs: selected.specs.map((spec) => spec.id),
    allowed_paths: [path.relative(projectRoot, summaryPath), path.relative(projectRoot, reportPath)],
    output_kind: "json",
    evidence_ref: path.relative(projectRoot, path.join(params.evidence.artifacts_root, "report", "agent-narrative.json")),
    result: "accepted",
    created_at: new Date().toISOString(),
  };
  const summary = reportSummarySchema.parse({
    ...draft,
    ai_used: true,
    sections: {
      ...draft.sections,
      ai_involvement: [...aiInvolvement, reportAuditEntry],
      agent_narrative_summary: narrative,
    },
  });
  const markdown = renderMarkdown(summary);
  validateRenderedSections(markdown);

  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(reportPath, markdown);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  const agentNarrativePath = path.join(params.evidence.artifacts_root, "report", "agent-narrative.json");
  await mkdir(path.dirname(agentNarrativePath), { recursive: true });
  await writeFile(agentNarrativePath, `${JSON.stringify(narrative, null, 2)}\n`);

  const agentAuditPath = path.join(projectRoot, ".vos", "agent-log.jsonl");
  await appendLogEntry(agentAuditPath, reportAuditEntry);

  params.evidence.addArtifactFromPath("report", reportPath, "course report");
  params.evidence.addArtifactFromPath("report-summary", summaryPath, "course report JSON summary");
  params.evidence.addArtifactFromPath("agent-report", agentNarrativePath, "agent narrative summary");

  return {
    reportPath,
    summaryPath,
    agentNarrativePath,
    agentAuditPath,
    changedTargets: [
      path.relative(projectRoot, reportPath),
      path.relative(projectRoot, summaryPath),
      path.relative(projectRoot, agentAuditPath),
    ],
    specRefs: selected.specs.map((spec) => spec.id),
    summary,
  };
}

function normalizeVisibility(value: string | undefined): VisibilityScope {
  if (value === "public" || value === "agent-only" || value === "staff-only") return value;
  return "full";
}

function selectSpecScope(bundle: NormalizedSpecBundle, stage: string | undefined, final: boolean): {
  architecture: Array<{ id: string; path: string; kind: string }>;
  specs: Array<{ id: string; path: string; kind: string; stage?: string }>;
} {
  const modules = bundle.modules.filter((module) => final || module.stage === stage);
  const operations = bundle.operations.filter((operation) => final || operation.stage === stage);
  const stageSlices = new Set([
    ...modules.flatMap((module) => module.related_slices),
    ...operations.map((operation) => operation.related_slice).filter((value): value is string => Boolean(value)),
  ]);
  const stageAdrs = new Set([
    ...modules.flatMap((module) => module.related_adrs),
    ...operations.map((operation) => operation.related_adr).filter((value): value is string => Boolean(value)),
  ]);
  const architecture = [
    ...bundle.architecture.slices
      .filter((slice) => final || slice.stage === stage || stageSlices.has(slice.id))
      .map((slice) => ({ id: slice.id, path: slice.path, kind: "slice" })),
    ...bundle.architecture.decisions
      .filter((adr) => final || stageAdrs.has(adr.id))
      .map((adr) => ({ id: adr.id, path: adr.path, kind: "adr" })),
  ];
  const specs = [
    ...modules.map((module) => ({ id: module.id, path: module.path, kind: "module", stage: module.stage })),
    ...operations.map((operation) => ({ id: operation.id, path: operation.path, kind: "operation", stage: operation.stage })),
  ];
  return { architecture, specs };
}

async function collectVerificationEvidence(
  projectRoot: string,
  bundle: NormalizedSpecBundle,
  stage: string | undefined,
  final: boolean,
): Promise<ReportSummary["sections"]["verification_evidence"]> {
  const requirements = bundle.verification.public_requirements.filter((req) =>
    final || req.related_specs.some((ref) => specRefMatchesStage(bundle, ref, stage))
  );
  if (requirements.length === 0) {
    throw new CliError("report generate found no public requirements for the selected scope", "validation_failed", {
      stage,
    });
  }
  const latestSummary = await findLatestPublicSummary(projectRoot);
  if (!latestSummary) {
    throw new CliError("report generate requires a prior `vos verify public` summary", "validation_failed");
  }
  const byId = new Map(latestSummary.requirements.map((item) => [item.id, item]));
  return requirements.map((req) => {
    const item = byId.get(req.id);
    if (!item) {
      throw new CliError(`report generate missing verification evidence for ${req.id}`, "validation_failed", {
        requirement: req.id,
        run_id: latestSummary.runId,
      });
    }
    return {
      id: req.id,
      status: item.status,
      run_id: latestSummary.runId,
      tests: (item.tests ?? []).map((test) => ({
        id: test.id,
        status: test.status,
        output: test.output,
      })),
      artifacts: (item.artifacts ?? []).map((artifact) => ({
        path: artifact.path,
        status: artifact.status,
      })),
    };
  });
}

function specRefMatchesStage(bundle: NormalizedSpecBundle, ref: string, stage: string | undefined): boolean {
  if (!stage) return false;
  return bundle.modules.some((module) => module.stage === stage && (module.id === ref || module.module === ref)) ||
    bundle.operations.some((operation) =>
      operation.stage === stage &&
      (operation.id === ref || `${operation.module}.${operation.operation}` === ref || operation.module === ref)
    );
}

async function findLatestPublicSummary(projectRoot: string): Promise<{
  runId: string;
  requirements: Array<{
    id: string;
    status: string;
    tests?: Array<{ id: string; status: string; output?: string }>;
    artifacts?: Array<{ path: string; status: string }>;
  }>;
} | undefined> {
  const runRoot = path.join(projectRoot, ".vos", "runs");
  if (!existsSync(runRoot)) return undefined;
  const entries = await readdir(runRoot, { withFileTypes: true });
  const manifests: Array<{ path: string; mtimeMs: number; runId: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(runRoot, entry.name, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const stat = await import("node:fs/promises").then((fs) => fs.stat(manifestPath));
    manifests.push({ path: manifestPath, mtimeMs: stat.mtimeMs, runId: entry.name });
  }
  for (const entry of manifests.sort((left, right) => right.mtimeMs - left.mtimeMs)) {
    const manifest = safeJson(await readFile(entry.path, "utf8")) as RunManifest | undefined;
    const artifact = manifest?.artifacts?.find((item) => item.kind === "verify-summary" || item.path.endsWith("public-summary.json"));
    if (!artifact) continue;
    const summaryPath = path.resolve(projectRoot, artifact.path);
    if (!existsSync(summaryPath)) continue;
    const summary = safeJson(await readFile(summaryPath, "utf8")) as { requirements?: unknown } | undefined;
    if (Array.isArray(summary?.requirements)) {
      return {
        runId: entry.runId,
        requirements: summary.requirements as Array<{
          id: string;
          status: string;
          tests?: Array<{ id: string; status: string; output?: string }>;
          artifacts?: Array<{ path: string; status: string }>;
        }>,
      };
    }
  }
  return undefined;
}

async function collectAiInvolvement(projectRoot: string): Promise<Array<Record<string, unknown>>> {
  return (await readLogEntries(path.join(projectRoot, ".vos", "agent-log.jsonl")))
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && !Array.isArray(entry))
    .map((entry) => ({
      session_id: entry.session_id,
      task_kind: entry.task_kind,
      related_specs: entry.related_specs,
      output_kind: entry.output_kind,
      patch_ref: entry.patch_ref,
      evidence_ref: entry.evidence_ref,
      result: entry.result,
      created_at: entry.created_at,
    }));
}

function collectReferences(bundle: NormalizedSpecBundle, selected: ReturnType<typeof selectSpecScope>): string[] {
  const out = new Set<string>();
  for (const item of selected.architecture) out.add(item.path);
  for (const goal of bundle.goals) {
    for (const evidence of goal.evidence_required) out.add(evidence);
  }
  return [...out].sort();
}

function validateRequiredInputs(draft: {
  sections: {
    architecture_reference: unknown[];
    module_specs_covered: unknown[];
    verification_evidence: unknown[];
    references: unknown[];
  };
}): void {
  if (draft.sections.architecture_reference.length === 0) {
    throw new CliError("report generate requires architecture references", "validation_failed");
  }
  if (draft.sections.module_specs_covered.length === 0) {
    throw new CliError("report generate requires module specs covered", "validation_failed");
  }
  if (draft.sections.verification_evidence.length === 0) {
    throw new CliError("report generate requires verification evidence", "validation_failed");
  }
}

async function validateReportContract(projectRoot: string): Promise<void> {
  const contractPath = path.join(projectRoot, "spec", "verification", "report-contract.yaml");
  if (!existsSync(contractPath)) {
    throw new CliError("report generate requires spec/verification/report-contract.yaml", "validation_failed");
  }
  const parsed = parseTopLevelYaml(await readFile(contractPath, "utf8"));
  const contract = parsed.report_contract;
  const sections = Array.isArray((contract as { required_sections?: unknown } | undefined)?.required_sections)
    ? (contract as { required_sections: unknown[] }).required_sections
    : [];
  const names = new Set(sections.map((section) =>
    section && typeof section === "object" ? (section as { section?: unknown }).section : undefined
  ).filter((section): section is string => typeof section === "string"));
  const missing = REQUIRED_SECTIONS.filter((section) => !names.has(section));
  if (missing.length > 0) {
    throw new CliError("report contract is missing required sections", "validation_failed", { missing });
  }
}

async function generateAgentNarrative(params: {
  projectRoot: string;
  draft: unknown;
  evidence: EvidenceWriter;
  agentRunner?: HeadlessAgentTaskRunner;
}): Promise<z.infer<typeof narrativeSchema>> {
  const result = await runAgentWithPrompt({
    projectRoot: params.projectRoot,
    taskPrompt: [
      "Summarize the deterministic course report draft without changing pass/fail facts or inventing evidence.",
      AGENTS_READONLY_GUIDANCE_PROMPT,
      "Do not use the report narrative to create, edit, or reinterpret AGENTS.md.",
    ].join("\n"),
    taskKind: "report_narrative",
    requestedScope: "report.generate",
    context: params.draft,
    courseMode: true,
    disabledTools: ["bash", "edit", "write"],
    taskRunner: params.agentRunner,
  });
  const parsed = result.parsedResult ?? parseJsonFromText(result.resultText);
  if (!parsed) {
    throw new AgentOutputError("report agent narrative output is not parseable JSON");
  }
  const narrative = narrativeSchema.safeParse(parsed);
  if (!narrative.success) {
    throw new AgentOutputError(`report agent narrative output does not match schema: ${narrative.error.message}`);
  }
  return narrative.data;
}

function renderMarkdown(summary: ReportSummary): string {
  const template = Handlebars.compile(REPORT_TEMPLATE, { noEscape: true });
  return template(summary);
}

function validateRenderedSections(markdown: string): void {
  const missing = REQUIRED_SECTIONS.filter((section) => !markdown.includes(`<!-- vos-section:${section} -->`));
  if (missing.length > 0) {
    throw new CliError("rendered report is missing required sections", "validation_failed", { missing });
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function currentGitHead(projectRoot: string): string | undefined {
  const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: projectRoot, stdout: "pipe", stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().trim() || undefined : undefined;
}

const REPORT_TEMPLATE = `# {{#if stage}}Stage Report: {{stage}}{{else}}Final Synthesis Report{{/if}}

Generated at: {{generated_at}}

<!-- vos-section:architecture_reference -->
## Architecture Reference

{{#each sections.architecture_reference}}
- {{kind}}: {{id}} ({{path}})
{{/each}}

<!-- vos-section:module_specs_covered -->
## Module Specs Covered

{{#each sections.module_specs_covered}}
- {{kind}}: {{id}} ({{path}})
{{/each}}

<!-- vos-section:verification_evidence -->
## Verification Evidence

| Requirement | Status | Run | Tests | Artifacts |
|---|---|---|---|---|
{{#each sections.verification_evidence}}
| {{id}} | {{status}} | {{run_id}} | {{#each tests}}{{id}}={{status}}{{#unless @last}}, {{/unless}}{{/each}} | {{#each artifacts}}{{path}}={{status}}{{#unless @last}}, {{/unless}}{{/each}} |
{{/each}}

<!-- vos-section:spec_evolution -->
## Spec Evolution

{{#if sections.spec_evolution.length}}
{{#each sections.spec_evolution}}
- {{id}}{{#if title}}: {{title}}{{/if}}{{#if path}} ({{path}}){{/if}}
{{/each}}
{{else}}
No SpecPatch was applied in this report scope.
{{/if}}

<!-- vos-section:ai_involvement -->
## AI Involvement

AI assistance used: {{#if ai_used}}yes{{else}}no{{/if}}

{{#each sections.ai_involvement}}
- {{task_kind}} result={{result}} evidence={{evidence_ref}}
{{/each}}

<!-- vos-section:references -->
## References

{{#each sections.references}}
- {{this}}
{{/each}}

<!-- vos-section:agent_narrative_summary -->
## Agent Narrative Summary

{{sections.agent_narrative_summary.summary}}

### Risks
{{#each sections.agent_narrative_summary.risks}}
- {{this}}
{{/each}}

### Recommended Next Steps
{{#each sections.agent_narrative_summary.recommended_next_steps}}
- {{this}}
{{/each}}

### Limitations
{{#each sections.agent_narrative_summary.limitations}}
- {{this}}
{{/each}}
`;
