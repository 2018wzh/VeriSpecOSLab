import type { CommandStatus } from "../types.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runBuildCommand } from "./build.ts";
import { runQemuCommand } from "./run.ts";
import { runTestCommand } from "./test.ts";
import { runCommand } from "./executor.ts";
import { parseTopLevelYaml } from "../utils/yaml.ts";
import {
  buildAgentBehaviorTestPatchPrompt,
  buildAgentBehaviorTestPlanPrompt,
} from "../agent/prompt.ts";
import {
  buildNormalizedSpecBundle,
  composeArchitecture,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  resolveSpecPatch,
  selectPatchVerificationChecks,
} from "vos-spec";

export interface VerifyResult {
  status: CommandStatus;
  scope: string;
  steps: VerifyStep[];
  requiredChecks?: VerifyCheck[];
}

export interface VerifyStep {
  name: string;
  status: CommandStatus;
  evidenceRefs?: string[];
}

export interface VerifyCheck {
  id: string;
  status: CommandStatus;
  requiredArtifacts?: string[];
}

export interface VerifyPublicPlan {
  status: CommandStatus;
  requiredChecks: Array<{ id: string } | string>;
}

interface PublicMatrixSpec {
  public_requirements?: Array<{ id?: unknown; required_tests?: unknown; required_artifacts?: unknown }>;
}

interface VerifyMapping {
  full?: string[];
  generated?: Record<string, string[]>;
  invariant?: Record<string, string[]>;
  fuzz?: Record<string, string[]>;
}

interface ToolchainVerifySpec {
  test?: {
    suites?: Array<{ name?: unknown }>;
  };
  tests?: string[];
  verify?: VerifyMapping;
}

export type BehaviorTestRunner = (request: {
  kind: "plan" | "patch";
  prompt: string;
  scope: string;
  phase: "generated" | "fuzz";
  obligations: string[];
}) => Promise<string>;

interface BehaviorTestPlan {
  cases: Array<{
    id: string;
    obligation_id: string;
    purpose?: string;
    carrier?: string;
    stimulus?: { stdin?: string };
    oracle: {
      success_regex?: string;
      failure_regex?: string;
      timeout_ms?: number;
    };
  }>;
}

interface BehaviorTestPatch {
  patch: string;
  suites: Array<{ name: string; command: string | string[] }>;
  cases: Array<{
    id: string;
    obligation_id: string;
    suite: string;
    stdin?: string;
    success_regex?: string;
    failure_regex?: string;
    timeout_ms?: number;
  }>;
}

export async function runVerifyCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  scope: string;
  target?: string;
  dryRun: boolean;
  staffPolicy?: string;
  visibilityScope?: "public" | "agent-only" | "staff-only";
  behaviorTestRunner?: BehaviorTestRunner;
  signal?: AbortSignal;
}): Promise<VerifyResult> {
  const scope = params.scope;
  if (scope === "trace") {
    return {
      status: "not_implemented",
      scope,
      steps: [{ name: "trace-validation", status: "not_implemented" }],
    };
  }

  if (scope === "patch") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    if (hasBlockingDiagnostics(bundle.diagnostics)) {
      return {
        status: "validation_failed",
        scope,
        steps: [{ name: "spec lint", status: "validation_failed" }],
        requiredChecks: bundle.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => ({ id: diagnostic.code, status: "validation_failed" as CommandStatus })),
      };
    }
    const patchRef = params.target ?? await latestSpecPatchRef(params.projectRoot);
    if (!patchRef) {
      return {
        status: "validation_failed",
        scope,
        steps: [{ name: "resolve SpecPatch", status: "validation_failed" }],
        requiredChecks: [{ id: "spec-patch-required", status: "validation_failed" }],
      };
    }
    const { patch, impact } = await resolveSpecPatch({
      projectRoot: params.projectRoot,
      ref: patchRef,
      bundle,
    });
    if (hasBlockingDiagnostics(impact.diagnostics)) {
      return {
        status: "validation_failed",
        scope,
        steps: [{ name: "patch impact", status: "validation_failed" }],
        requiredChecks: impact.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => ({ id: diagnostic.code, status: "validation_failed" as CommandStatus })),
      };
    }
    const selected = selectPatchVerificationChecks(impact);
    const unknownCheck = selected.find((check) =>
      check !== "spec lint" &&
      check !== "arch lint" &&
      check !== "build" &&
      !check.startsWith("make ") &&
      !check.startsWith("test ")
    );
    if (unknownCheck) {
      return {
        status: "validation_failed",
        scope,
        steps: [{ name: unknownCheck, status: "validation_failed" }],
        requiredChecks: selected.map((id) => ({
          id,
          status: id === unknownCheck ? "validation_failed" : "planned",
        })),
      };
    }
    if (params.dryRun) {
      return {
        status: "ok",
        scope,
        steps: selected.map((name) => ({ name, status: "ok" })),
        requiredChecks: selected.map((id) => ({ id, status: "ok" })),
      };
    }
    const steps: Array<{ name: string; status: CommandStatus }> = [];
    for (const check of selected) {
      if (check === "spec lint") {
        steps.push({ name: check, status: "ok" });
      } else if (check === "arch lint") {
        const composition = composeArchitecture(bundle, patch.stage);
        const status: CommandStatus = hasBlockingDiagnostics(composition.conflicts) ? "validation_failed" : "ok";
        steps.push({ name: check, status });
        if (status !== "ok") return { status, scope, steps };
      } else if (check === "build" || check.startsWith("make ")) {
        const result = await runBuildCommand({
          projectRoot: params.projectRoot,
          evidence: params.evidence,
          dryRun: params.dryRun,
          signal: params.signal,
        });
        steps.push({ name: check, status: result.status });
        if (result.status !== "ok") return { status: result.status, scope, steps };
      } else if (check.startsWith("test ")) {
        const result = await runTestCommand({
          projectRoot: params.projectRoot,
          evidence: params.evidence,
          suites: [check.slice("test ".length)],
          dryRun: false,
          signal: params.signal,
        });
        steps.push({ name: check, status: result.status });
        if (result.status !== "ok") return { status: result.status, scope, steps };
      } else {
        steps.push({ name: check, status: "validation_failed" });
        return { status: "validation_failed", scope, steps };
      }
    }
    return {
      status: "ok",
      scope,
      steps,
      requiredChecks: selected.map((id) => ({ id, status: "ok" })),
    };
  }

  if (scope === "invariant") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    const toolchain = await loadToolchainVerifySpec(params.projectRoot);
    return runMappedVerifySuites({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      stepName: "invariant",
      obligations: invariantObligations(bundle, params.target),
      mapping: toolchain.verify?.invariant ?? {},
      availableSuites: collectAvailableSuites(toolchain),
      dryRun: params.dryRun,
      signal: params.signal,
    });
  }

  if (scope === "generated") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    const toolchain = await loadToolchainVerifySpec(params.projectRoot);
    const matrix = deriveTestMatrix(bundle, params.target);
    return runMappedVerifySuites({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      stepName: "generated",
      obligations: matrix.generated_tests.map((test) => test.id),
      mapping: toolchain.verify?.generated ?? {},
      availableSuites: collectAvailableSuites(toolchain),
      dryRun: params.dryRun,
      signal: params.signal,
      behaviorTestRunner: params.behaviorTestRunner,
      behaviorPhase: "generated",
    });
  }

  if (scope === "fuzz") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    const toolchain = await loadToolchainVerifySpec(params.projectRoot);
    const matrix = deriveTestMatrix(bundle, params.target);
    const obligations = [...matrix.generated_tests, ...matrix.hidden_tags].map((test) => test.id);
    return runMappedVerifySuites({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      stepName: "fuzz",
      obligations,
      mapping: {
        ...(toolchain.verify?.generated ?? {}),
        ...(toolchain.verify?.fuzz ?? {}),
      },
      availableSuites: collectAvailableSuites(toolchain),
      dryRun: params.dryRun,
      signal: params.signal,
      behaviorTestRunner: params.behaviorTestRunner,
      behaviorPhase: "fuzz",
    });
  }

  if (scope === "full") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    const toolchain = await loadToolchainVerifySpec(params.projectRoot);
    const availableSuites = collectAvailableSuites(toolchain);
    const steps: VerifyStep[] = [];
    const requiredChecks: VerifyCheck[] = [];

    const publicObligations = await publicSuiteObligations(params.projectRoot, bundle, params.target, availableSuites);
    const publicResult = await runSuitesForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      obligations: publicObligations,
      mapping: {},
      availableSuites,
      dryRun: params.dryRun,
      signal: params.signal,
      allowEmpty: true,
    });
    steps.push({ name: "public", status: publicResult.status });
    requiredChecks.push(...publicResult.requiredChecks);
    if (publicResult.status !== "ok") return { status: publicResult.status, scope, steps, requiredChecks };

    const matrix = deriveTestMatrix(bundle, params.target);
    const generatedResult = await runSuitesForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      obligations: matrix.generated_tests.map((test) => test.id),
      mapping: toolchain.verify?.generated ?? {},
      availableSuites,
      dryRun: params.dryRun,
      signal: params.signal,
      allowEmpty: true,
    });
    const generatedBehavior = await runBehaviorTestsForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      phase: "generated",
      obligations: matrix.generated_tests.map((test) => test.id),
      suites: generatedResult.suites,
      dryRun: params.dryRun,
      behaviorTestRunner: params.behaviorTestRunner,
      signal: params.signal,
    });
    steps.push({
      name: "generated",
      status: firstNonOk(generatedResult.status, generatedBehavior.status),
      evidenceRefs: generatedBehavior.evidenceRefs,
    });
    requiredChecks.push(...generatedResult.requiredChecks);
    if (generatedResult.status !== "ok") return { status: generatedResult.status, scope, steps, requiredChecks };
    if (generatedBehavior.status !== "ok") return { status: generatedBehavior.status, scope, steps, requiredChecks };

    const invariantResult = await runSuitesForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      obligations: invariantObligations(bundle, params.target),
      mapping: toolchain.verify?.invariant ?? {},
      availableSuites,
      dryRun: params.dryRun,
      signal: params.signal,
      allowEmpty: true,
    });
    steps.push({ name: "invariant", status: invariantResult.status });
    requiredChecks.push(...invariantResult.requiredChecks);
    if (invariantResult.status !== "ok") return { status: invariantResult.status, scope, steps, requiredChecks };

    const fuzzResult = await runSuitesForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      obligations: matrix.hidden_tags.map((test) => test.id),
      mapping: toolchain.verify?.fuzz ?? {},
      availableSuites,
      dryRun: params.dryRun,
      signal: params.signal,
      allowEmpty: true,
    });
    const fuzzBehavior = await runBehaviorTestsForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      phase: "fuzz",
      obligations: matrix.hidden_tags.map((test) => test.id),
      suites: fuzzResult.suites,
      dryRun: params.dryRun,
      behaviorTestRunner: params.behaviorTestRunner,
      signal: params.signal,
    });
    steps.push({
      name: "fuzz",
      status: firstNonOk(fuzzResult.status, fuzzBehavior.status),
      evidenceRefs: fuzzBehavior.evidenceRefs,
    });
    requiredChecks.push(...fuzzResult.requiredChecks);
    if (fuzzResult.status !== "ok") return { status: fuzzResult.status, scope, steps, requiredChecks };
    if (fuzzBehavior.status !== "ok") return { status: fuzzBehavior.status, scope, steps, requiredChecks };

    const staffResult = await runStaffSuites({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      staffPolicy: params.staffPolicy,
      visibilityScope: params.visibilityScope ?? "public",
      availableSuites,
      dryRun: params.dryRun,
      signal: params.signal,
    });
    steps.push({ name: "staff", status: staffResult.status });
    requiredChecks.push(...staffResult.requiredChecks);
    if (staffResult.status !== "ok") return { status: staffResult.status, scope, steps, requiredChecks };

    return { status: "ok", scope, steps, requiredChecks };
  }

  if (scope === "public") {
    const requiredChecks = await collectPublicChecks(params.projectRoot);
    if (requiredChecks.length === 0) {
      return {
        status: "failed",
        scope,
        steps: [],
        requiredChecks: [{ id: "public-matrix", status: "failed", requiredArtifacts: [] }],
      };
    }

    const steps: VerifyStep[] = [];

    const normalizeResult = await runPublicNormalization(params.projectRoot);
    steps.push({ name: "normalize", status: normalizeResult.status });
    if (normalizeResult.status === "failed") {
      return {
        status: "failed",
        scope,
        steps,
        requiredChecks: requiredChecks.map((check) => ({ id: check.id, status: "failed", requiredArtifacts: check.required_artifacts })),
      };
    }

    const consistencyResult = await runSpecConsistency(params.projectRoot);
    steps.push({ name: "consistency", status: consistencyResult.status });
    if (consistencyResult.status === "failed") {
      return {
        status: "failed",
        scope,
        steps,
        requiredChecks: requiredChecks.map((check) => ({ id: check.id, status: "failed", requiredArtifacts: check.required_artifacts })),
      };
    }

    const buildResult = await runBuildCommand({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      dryRun: params.dryRun,
      signal: params.signal,
    });
    steps.push({ name: "build", status: buildResult.status });
    if (buildResult.status !== "ok") {
      return {
        status: buildResult.status,
        scope,
        steps,
        requiredChecks: requiredChecks.map((check) => ({ id: check.id, status: "failed", requiredArtifacts: check.required_artifacts })),
      };
    }

    const runResult = await runQemuCommand({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      dryRun: params.dryRun,
      signal: params.signal,
    });
    steps.push({ name: "run", status: runResult.status });

    const checkStatus: CommandStatus = runResult.status === "ok" ? "ok" : "failed";

    const checks = requiredChecks.map((check) => ({
      id: check.id,
      status: checkStatus,
      requiredArtifacts: check.required_artifacts,
    }));

    return {
      status: runResult.status,
      scope,
      steps,
      requiredChecks: checks as VerifyCheck[],
    };
  }

  const plan = resolveVerifyPlan(scope);
  const steps: Array<{ name: string; status: CommandStatus }> = [];
  for (const step of plan) {
    if (step === "build") {
      const result = await runBuildCommand({
        projectRoot: params.projectRoot,
        evidence: params.evidence,
        dryRun: params.dryRun,
        signal: params.signal,
      });
      steps.push({ name: "build", status: result.status });
      if (result.status !== "ok") {
        return { status: result.status, scope, steps };
      }
      continue;
    }

    if (step === "run") {
      const result = await runQemuCommand({
        projectRoot: params.projectRoot,
        evidence: params.evidence,
        dryRun: params.dryRun,
        signal: params.signal,
      });
      steps.push({ name: "run", status: result.status });
      if (result.status !== "ok") {
        return { status: result.status, scope, steps };
      }
      continue;
    }

    steps.push({ name: step, status: "ok" });
  }

  return {
    status: "ok",
    scope,
    steps,
  };
}

function resolveVerifyPlan(scope: string): string[] {
  switch (scope) {
    case "public":
      return ["normalize", "consistency", "build", "run"];
    case "full":
      return ["build", "run"];
    case "base":
      return ["run"];
    case "architecture":
      return ["build"];
    case "composition":
      return ["build", "run"];
    case "goal":
      return ["build", "run"];
    default:
      return ["build", "run"];
  }
}

async function loadToolchainVerifySpec(projectRoot: string): Promise<ToolchainVerifySpec> {
  const toolchainPath = path.join(projectRoot, ".vos", "toolchain.json");
  if (!existsSync(toolchainPath)) return {};
  return JSON.parse(await readFile(toolchainPath, "utf8")) as ToolchainVerifySpec;
}

function collectAvailableSuites(toolchain: ToolchainVerifySpec): Set<string> {
  const out = new Set<string>();
  for (const suite of toolchain.test?.suites ?? []) {
    if (typeof suite.name === "string" && suite.name.trim()) out.add(suite.name.trim());
  }
  for (const suite of toolchain.tests ?? []) {
    if (typeof suite === "string" && suite.trim()) out.add(suite.trim());
  }
  return out;
}

function invariantObligations(bundle: Awaited<ReturnType<typeof buildNormalizedSpecBundle>>, target?: string): string[] {
  const composition = composeArchitecture(bundle, target);
  const enabled = new Set(composition.enabled_operations);
  const out = new Set<string>();
  for (const operation of bundle.operations) {
    if (!enabled.has(operation.id)) continue;
    for (const invariant of operation.invariants_preserved) out.add(invariant);
  }
  return [...out].sort();
}

async function publicSuiteObligations(
  projectRoot: string,
  bundle: Awaited<ReturnType<typeof buildNormalizedSpecBundle>>,
  target?: string,
  availableSuites?: Set<string>,
): Promise<string[]> {
  const out = new Set<string>();
  for (const check of await collectPublicChecks(projectRoot)) {
    for (const test of check.required_tests ?? []) out.add(test);
  }
  for (const test of deriveTestMatrix(bundle, target).public_tests) {
    if (!test.id.startsWith("verify-") || availableSuites?.has(test.id)) out.add(test.id);
  }
  return [...out].sort();
}

async function runMappedVerifySuites(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  scope: string;
  stepName: string;
  obligations: string[];
  mapping: Record<string, string[]>;
  availableSuites: Set<string>;
  dryRun: boolean;
  signal?: AbortSignal;
  behaviorTestRunner?: BehaviorTestRunner;
  behaviorPhase?: "generated" | "fuzz";
}): Promise<VerifyResult> {
  const result = await runSuitesForObligations(params);
  const behavior = params.behaviorPhase
    ? await runBehaviorTestsForObligations({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope: params.scope,
      phase: params.behaviorPhase,
      obligations: params.obligations,
      suites: result.suites,
      dryRun: params.dryRun,
      behaviorTestRunner: params.behaviorTestRunner,
      signal: params.signal,
    })
    : { status: "ok" as CommandStatus, evidenceRefs: [] };
  const status = firstNonOk(result.status, behavior.status);
  return {
    status,
    scope: params.scope,
    steps: [{ name: params.stepName, status, evidenceRefs: behavior.evidenceRefs }],
    requiredChecks: result.requiredChecks,
  };
}

async function runSuitesForObligations(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  obligations: string[];
  mapping: Record<string, string[]>;
  availableSuites: Set<string>;
  dryRun: boolean;
  signal?: AbortSignal;
  allowEmpty?: boolean;
}): Promise<{ status: CommandStatus; suites: string[]; requiredChecks: Array<{ id: string; status: CommandStatus }> }> {
  if (params.obligations.length === 0) {
    return { status: params.allowEmpty ? "ok" : "validation_failed", suites: [], requiredChecks: [] };
  }
  const missing = params.obligations.filter((id) => suitesForObligation(id, params.mapping, params.availableSuites).length === 0);
  if (missing.length > 0) {
    return {
      status: "validation_failed",
      suites: [],
      requiredChecks: params.obligations.map((id) => ({
        id,
        status: missing.includes(id) ? "validation_failed" : "planned",
      })),
    };
  }
  const suites = [...new Set(params.obligations.flatMap((id) => suitesForObligation(id, params.mapping, params.availableSuites)))];
  if (suites.length === 0) return { status: "ok", suites, requiredChecks: [] };
  const result = await runTestCommand({
    projectRoot: params.projectRoot,
    evidence: params.evidence,
    suites,
    dryRun: params.dryRun,
    signal: params.signal,
  });
  return {
    status: result.status,
    suites,
    requiredChecks: params.obligations.map((id) => ({ id, status: result.status })),
  };
}

function suitesForObligation(id: string, mapping: Record<string, string[]>, availableSuites: Set<string>): string[] {
  const mapped = mapping[id]?.filter((suite) => availableSuites.has(suite)) ?? [];
  if (mapped.length > 0) return mapped;
  return availableSuites.has(id) ? [id] : [];
}

async function runStaffSuites(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  staffPolicy?: string;
  visibilityScope: "public" | "agent-only" | "staff-only";
  availableSuites: Set<string>;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<{ status: CommandStatus; suites: string[]; requiredChecks: Array<{ id: string; status: CommandStatus }> }> {
  if (!params.staffPolicy) return { status: "ok", suites: [], requiredChecks: [] };
  if (params.visibilityScope !== "staff-only") {
    return { status: "policy_blocked", suites: [], requiredChecks: [{ id: "staff-policy", status: "policy_blocked" }] };
  }
  const policyPath = path.resolve(params.staffPolicy);
  const root = path.resolve(params.projectRoot);
  if (policyPath === root || policyPath.startsWith(`${root}${path.sep}`)) {
    return { status: "policy_blocked", suites: [], requiredChecks: [{ id: "staff-policy-external", status: "policy_blocked" }] };
  }
  const staff = JSON.parse(await readFile(policyPath, "utf8")) as { verify?: VerifyMapping };
  const suites = [...new Set(staff.verify?.full ?? [])];
  const missing = suites.filter((suite) => !params.availableSuites.has(suite));
  if (missing.length > 0) {
    return {
      status: "validation_failed",
      suites,
      requiredChecks: missing.map((id) => ({ id, status: "validation_failed" as CommandStatus })),
    };
  }
  if (suites.length === 0) return { status: "ok", suites, requiredChecks: [] };
  const result = await runTestCommand({
    projectRoot: params.projectRoot,
    evidence: params.evidence,
    suites,
    dryRun: params.dryRun,
    signal: params.signal,
  });
  return {
    status: result.status,
    suites,
    requiredChecks: suites.map((id) => ({ id, status: result.status })),
  };
}

async function runBehaviorTestsForObligations(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  scope: string;
  phase: "generated" | "fuzz";
  obligations: string[];
  suites: string[];
  dryRun: boolean;
  behaviorTestRunner?: BehaviorTestRunner;
  signal?: AbortSignal;
}): Promise<{ status: CommandStatus; evidenceRefs: string[] }> {
  if (params.obligations.length === 0) return { status: "ok", evidenceRefs: [] };
  if (!params.behaviorTestRunner) {
    return { status: "validation_failed", evidenceRefs: [] };
  }

  const evidenceRefs: string[] = [];
  try {
    const projectTree = await collectProjectTree(params.projectRoot);
    const planPrompt = buildAgentBehaviorTestPlanPrompt({
      scope: params.scope,
      phase: params.phase,
      obligations: params.obligations,
      suites: params.suites,
      projectTree,
    });
    const plan = parseBehaviorTestPlan(await params.behaviorTestRunner({
      kind: "plan",
      prompt: planPrompt,
      scope: params.scope,
      phase: params.phase,
      obligations: params.obligations,
    }));
    const root = path.join(params.evidence.artifacts_root, "verify-behavior");
    await mkdir(root, { recursive: true });
    const planPath = path.join(root, `${params.phase}-plan.json`);
    await writeFile(planPath, `${JSON.stringify({ scope: params.scope, phase: params.phase, obligations: params.obligations, suites: params.suites, plan }, null, 2)}\n`);
    params.evidence.addArtifactFromPath("verify-behavior-plan", planPath, `${params.phase} behavior TestPlan`);
    evidenceRefs.push(path.relative(params.evidence.run_root, planPath));
    if (params.dryRun) return { status: "ok", evidenceRefs };

    const patchPrompt = buildAgentBehaviorTestPatchPrompt({
      scope: params.scope,
      phase: params.phase,
      testPlan: plan,
      projectTree,
    });
    const patch = parseBehaviorTestPatch(await params.behaviorTestRunner({
      kind: "patch",
      prompt: patchPrompt,
      scope: params.scope,
      phase: params.phase,
      obligations: params.obligations,
    }));
    const patchPath = path.join(root, `${params.phase}-patch.json`);
    await writeFile(patchPath, `${JSON.stringify({ scope: params.scope, phase: params.phase, patch }, null, 2)}\n`);
    params.evidence.addArtifactFromPath("verify-behavior-patch", patchPath, `${params.phase} behavior patch`);
    evidenceRefs.push(path.relative(params.evidence.run_root, patchPath));

    const worktree = await mkdtemp(path.join(tmpdir(), "vos-verify-behavior-"));
    try {
      await cp(params.projectRoot, worktree, {
        recursive: true,
        filter: (source) => {
          const rel = path.relative(params.projectRoot, source);
          return !rel.startsWith(path.join(".vos", "runs")) && !rel.startsWith(path.join(".vos", "worktrees")) && rel !== ".git";
        },
      });
      const patchPolicy = validateBehaviorPatch(patch.patch);
      if (!patchPolicy.ok) return { status: "validation_failed", evidenceRefs };
      if (patch.patch.trim()) {
        const check = await runCommand({
          command: ["git", "apply", "--check", "-"],
          cwd: worktree,
          stdin: patch.patch,
          timeoutMs: 30_000,
          signal: params.signal,
        });
        if (check.exitCode !== 0) return { status: "validation_failed", evidenceRefs };
        const apply = await runCommand({
          command: ["git", "apply", "-"],
          cwd: worktree,
          stdin: patch.patch,
          timeoutMs: 30_000,
          signal: params.signal,
        });
        if (apply.exitCode !== 0) return { status: "validation_failed", evidenceRefs };
      }
      for (const testCase of patch.cases) {
        const suite = patch.suites.find((candidate) => candidate.name === testCase.suite);
        if (!suite) return { status: "validation_failed", evidenceRefs };
        const result = await runBehaviorCase({
          worktree,
          evidence: params.evidence,
          phase: params.phase,
          suite,
          testCase,
          signal: params.signal,
        });
        evidenceRefs.push(result.resultRef);
        if (result.status !== "ok") return { status: "validation_failed", evidenceRefs };
      }
      return { status: "ok", evidenceRefs };
    } finally {
      await rm(worktree, { recursive: true, force: true });
    }
  } catch {
    return { status: "validation_failed", evidenceRefs };
  }
}

function parseBehaviorTestPlan(text: string): BehaviorTestPlan {
  const parsed = parseAgentJsonObject(text, "behavior TestPlan");
  const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
  if (cases.length === 0) throw new Error("behavior TestPlan requires cases");
  return {
    cases: cases.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`behavior TestPlan case ${index + 1} must be an object`);
      const id = requiredString(raw.id, `behavior TestPlan case ${index + 1} id`);
      const obligationId = requiredString(raw.obligation_id, `behavior TestPlan case ${id} obligation_id`);
      const oracle = isRecord(raw.oracle) ? raw.oracle : {};
      return {
        id,
        obligation_id: obligationId,
        purpose: optionalString(raw.purpose),
        carrier: optionalString(raw.carrier),
        stimulus: isRecord(raw.stimulus) ? { stdin: optionalString(raw.stimulus.stdin) } : undefined,
        oracle: {
          success_regex: optionalString(oracle.success_regex),
          failure_regex: optionalString(oracle.failure_regex),
          timeout_ms: optionalNumber(oracle.timeout_ms),
        },
      };
    }),
  };
}

function parseBehaviorTestPatch(text: string): BehaviorTestPatch {
  const parsed = parseAgentJsonObject(text, "behavior patch");
  const suites = Array.isArray(parsed.suites) ? parsed.suites : [];
  const cases = Array.isArray(parsed.cases) ? parsed.cases : [];
  if (typeof parsed.patch !== "string") throw new Error("behavior patch requires patch");
  if (suites.length === 0) throw new Error("behavior patch requires suites");
  if (cases.length === 0) throw new Error("behavior patch requires cases");
  return {
    patch: parsed.patch,
    suites: suites.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`behavior suite ${index + 1} must be an object`);
      const command = Array.isArray(raw.command)
        ? raw.command.filter((item): item is string => typeof item === "string")
        : optionalString(raw.command);
      if (!command || (Array.isArray(command) && command.length === 0)) throw new Error(`behavior suite ${index + 1} requires command`);
      return {
        name: requiredString(raw.name, `behavior suite ${index + 1} name`),
        command,
      };
    }),
    cases: cases.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`behavior case ${index + 1} must be an object`);
      const id = requiredString(raw.id, `behavior case ${index + 1} id`);
      return {
        id,
        obligation_id: requiredString(raw.obligation_id, `behavior case ${id} obligation_id`),
        suite: requiredString(raw.suite, `behavior case ${id} suite`),
        stdin: optionalString(raw.stdin),
        success_regex: optionalString(raw.success_regex),
        failure_regex: optionalString(raw.failure_regex),
        timeout_ms: optionalNumber(raw.timeout_ms),
      };
    }),
  };
}

async function runBehaviorCase(params: {
  worktree: string;
  evidence: EvidenceWriter;
  phase: "generated" | "fuzz";
  suite: { name: string; command: string | string[] };
  testCase: BehaviorTestPatch["cases"][number];
  signal?: AbortSignal;
}): Promise<{ status: CommandStatus; resultRef: string }> {
  const command = normalizeBehaviorCommand(params.suite.command);
  const result = await runCommand({
    command,
    cwd: params.worktree,
    stdin: params.testCase.stdin,
    timeoutMs: params.testCase.timeout_ms,
    signal: params.signal,
  });
  const successMatched = params.testCase.success_regex
    ? new RegExp(params.testCase.success_regex).test(result.stdout)
    : result.exitCode === 0;
  const failureMatched = params.testCase.failure_regex
    ? new RegExp(params.testCase.failure_regex).test(`${result.stdout}${result.stderr}`)
    : false;
  const status: CommandStatus = result.exitCode === 0 && !result.timedOut && successMatched && !failureMatched ? "ok" : "validation_failed";
  const caseRoot = path.join(params.evidence.artifacts_root, "verify-behavior", `${params.phase}-cases`, safeFileName(params.testCase.id));
  await mkdir(caseRoot, { recursive: true });
  const stdoutPath = path.join(caseRoot, "stdout.log");
  const stderrPath = path.join(caseRoot, "stderr.log");
  const resultPath = path.join(caseRoot, "result.json");
  await writeFile(stdoutPath, result.stdout);
  await writeFile(stderrPath, result.stderr);
  await writeFile(resultPath, `${JSON.stringify({
    obligation_id: params.testCase.obligation_id,
    suite: params.testCase.suite,
    case_id: params.testCase.id,
    stdin: params.testCase.stdin,
    success_regex: params.testCase.success_regex,
    failure_regex: params.testCase.failure_regex,
    exit_code: result.exitCode,
    timed_out: result.timedOut,
    status,
  }, null, 2)}\n`);
  params.evidence.addArtifactFromPath("verify-behavior-stdout", stdoutPath, params.testCase.id);
  params.evidence.addArtifactFromPath("verify-behavior-stderr", stderrPath, params.testCase.id);
  params.evidence.addArtifactFromPath("verify-behavior-result", resultPath, params.testCase.id);
  return { status, resultRef: path.relative(params.evidence.run_root, resultPath) };
}

function validateBehaviorPatch(patchText: string): { ok: true } | { ok: false } {
  for (const changedPath of extractPatchPaths(patchText)) {
    const normalized = changedPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalized.startsWith("../") || normalized.startsWith("spec/") || normalized.startsWith(".git/") || normalized.startsWith(".vos/runs/") || normalized.startsWith(".vos/worktrees/")) {
      return { ok: false };
    }
  }
  return { ok: true };
}

function extractPatchPaths(patchText: string): string[] {
  const out: string[] = [];
  for (const line of patchText.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (match?.[1]) out.push(match[1]);
    if (match?.[2]) out.push(match[2]);
  }
  return out;
}

async function collectProjectTree(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(projectRoot, absolute);
      if (relative === ".git" || relative.startsWith(`${path.join(".vos", "runs")}${path.sep}`)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
      } else {
        out.push(relative);
      }
      if (out.length >= 200) return;
    }
  }
  await visit(projectRoot);
  return out.sort();
}

function parseAgentJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error(`${label} must be an object`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} is required`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBehaviorCommand(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw;
  return raw.match(/"([^"]*)"|'([^']*)'|\S+/g)?.map((item) => item.replace(/^"|"$|^'|'$/g, "")) ?? [raw];
}

function safeFileName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_.-]/g, "-");
}

function firstNonOk(...statuses: CommandStatus[]): CommandStatus {
  return statuses.find((status) => status !== "ok") ?? "ok";
}

async function latestSpecPatchRef(projectRoot: string): Promise<string | undefined> {
  const dir = path.join(projectRoot, "spec", "evolution");
  const entries = await readdir(dir).catch(() => []);
  const patches = entries
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort();
  const latest = patches.at(-1);
  return latest ? path.join("spec", "evolution", latest) : undefined;
}

async function runSpecConsistency(projectRoot: string): Promise<{ status: CommandStatus }> {
  const runCommandText = path.join(projectRoot, "spec", "toolchain", "toolchain.yaml");
  if (!existsSync(runCommandText)) {
    return { status: "failed" };
  }
  return { status: "ok" };
}

async function runPublicNormalization(projectRoot: string): Promise<{ status: CommandStatus }> {
  const normalizedBundle = path.join(projectRoot, ".vos", "cache", "normalized", "bundle.json");
  if (!existsSync(normalizedBundle)) {
    return { status: "failed" };
  }
  try {
    await readFile(normalizedBundle, "utf8");
  } catch {
    return { status: "failed" };
  }
  return { status: "ok" };
}

async function collectPublicChecks(projectRoot: string): Promise<Array<{ id: string; required_tests?: string[]; required_artifacts?: string[] }>> {
  const matrixPath = path.join(projectRoot, "spec", "verification", "public-matrix.yaml");
  if (!existsSync(matrixPath)) {
    return [];
  }
  const raw = await readFile(matrixPath, "utf8");
  const parsed = parseTopLevelYaml(raw) as PublicMatrixSpec;
  const requirements = parsed.public_requirements ?? [];
  const out: Array<{ id: string; required_tests?: string[]; required_artifacts?: string[] }> = [];

  for (const rawReq of requirements) {
    if (!rawReq || typeof rawReq !== "object") continue;
    const req = rawReq as { id?: unknown; required_tests?: unknown; required_artifacts?: unknown };
    const id = typeof req.id === "string" && req.id.trim().length > 0
      ? req.id.trim()
      : "anonymous";
    out.push({
      id,
      required_tests: Array.isArray(req.required_tests)
        ? req.required_tests.filter((value) => typeof value === "string") as string[]
        : undefined,
      required_artifacts: Array.isArray(req.required_artifacts)
        ? req.required_artifacts.filter((value) => typeof value === "string") as string[]
        : undefined,
    });
  }

  return out;
}
