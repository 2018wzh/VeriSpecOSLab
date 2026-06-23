import type { CommandStatus } from "../types.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import path from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runBuildCommand } from "./build.ts";
import { runTestCommand } from "./test.ts";
import { runCommand } from "./executor.ts";
import { loadToolchainManifest, type ToolchainManifestV2 } from "./manifest.ts";
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
  publicSummaryPath?: string;
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
  requiredTests?: string[];
  tests?: Array<{ id: string; status: CommandStatus; output?: string }>;
  artifacts?: Array<{ path: string; status: CommandStatus }>;
  reason?: string;
}

export interface VerifyPublicPlan {
  status: CommandStatus;
  requiredChecks: Array<{ id: string } | string>;
}

interface VerifyMapping {
  full?: string[];
  generated?: Record<string, string[]>;
  invariant?: Record<string, string[]>;
  fuzz?: Record<string, string[]>;
}

interface ToolchainVerifySpec {
  test: ToolchainManifestV2["test"];
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
    return runPublicVerify({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      scope,
      target: params.target,
      dryRun: params.dryRun,
      signal: params.signal,
    });
  }

  return {
    status: "validation_failed",
    scope,
    steps: [{ name: `unsupported verify scope: ${scope}`, status: "validation_failed" }],
    requiredChecks: [{ id: `unsupported-scope:${scope}`, status: "validation_failed" }],
  };
}

async function loadToolchainVerifySpec(projectRoot: string): Promise<ToolchainVerifySpec> {
  return (await loadToolchainManifest({ projectRoot })).manifest;
}

function collectAvailableSuites(toolchain: ToolchainVerifySpec): Set<string> {
  return new Set(toolchain.test.suites.map((suite) => suite.name));
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
  void projectRoot;
  for (const check of bundle.verification.public_requirements) {
    for (const test of check.required_tests) out.add(test);
  }
  for (const test of deriveTestMatrix(bundle, target).public_tests) {
    if (!test.id.startsWith("verify-") || availableSuites?.has(test.id)) out.add(test.id);
  }
  return [...out].sort();
}

async function runPublicVerify(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  scope: string;
  target?: string;
  dryRun: boolean;
  signal?: AbortSignal;
}): Promise<VerifyResult> {
  const steps: VerifyStep[] = [];
  const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
  const specStatus: CommandStatus = hasBlockingDiagnostics(bundle.diagnostics) ? "validation_failed" : "ok";
  steps.push({ name: "spec bundle", status: specStatus });
  if (specStatus !== "ok") {
    const requiredChecks = bundle.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => ({ id: diagnostic.code, status: "validation_failed" as CommandStatus, reason: diagnostic.message }));
    const summaryPath = await writePublicSummary(params.evidence, {
      status: "validation_failed",
      requirements: requiredChecks,
    });
    return { status: "validation_failed", scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
  }

  const requirements = selectPublicRequirements(bundle.verification.public_requirements, params.target);
  const validation = validatePublicRequirements(requirements);
  if (validation.length > 0) {
    const requiredChecks = validation.map((id) => ({ id, status: "validation_failed" as CommandStatus, reason: "invalid public verification matrix" }));
    const summaryPath = await writePublicSummary(params.evidence, {
      status: "validation_failed",
      requirements: requiredChecks,
    });
    return { status: "validation_failed", scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
  }

  const toolchain = await loadToolchainVerifySpec(params.projectRoot);
  const availableSuites = collectAvailableSuites(toolchain);
  const missingTests = [...new Set(requirements.flatMap((req) => req.required_tests))]
    .filter((test) => !availableSuites.has(test));
  if (missingTests.length > 0) {
    const requiredChecks = requirements.map((req) => publicRequirementCheck(req, {
      status: req.required_tests.some((test) => missingTests.includes(test)) ? "validation_failed" : "planned",
      testStatus: (test) => missingTests.includes(test) ? "validation_failed" : "planned",
      reason: req.required_tests.some((test) => missingTests.includes(test)) ? "missing test suite mapping" : undefined,
    }));
    const summaryPath = await writePublicSummary(params.evidence, {
      status: "validation_failed",
      requirements: requiredChecks,
      missing_tests: missingTests,
    });
    return { status: "validation_failed", scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
  }

  const buildResult = await runBuildCommand({
    projectRoot: params.projectRoot,
    evidence: params.evidence,
    dryRun: params.dryRun,
    signal: params.signal,
  });
  steps.push({ name: "build", status: buildResult.status });
  if (buildResult.status !== "ok") {
    const requiredChecks = requirements.map((req) => publicRequirementCheck(req, { status: "failed", testStatus: () => "planned" }));
    const summaryPath = await writePublicSummary(params.evidence, {
      status: buildResult.status,
      requirements: requiredChecks,
    });
    return { status: buildResult.status, scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
  }

  steps.push({ name: "public tests", status: "ok" });
  const testStatuses = new Map<string, { status: CommandStatus; output?: string }>();
  for (const testId of [...new Set(requirements.flatMap((req) => req.required_tests))]) {
    const result = await runTestCommand({
      projectRoot: params.projectRoot,
      evidence: params.evidence,
      suites: [testId],
      dryRun: params.dryRun,
      signal: params.signal,
    });
    const detail = result.details[testId];
    testStatuses.set(testId, {
      status: result.status,
      output: detail?.output,
    });
    if (result.status !== "ok") steps[steps.length - 1].status = result.status;
  }
  if (steps.at(-1)?.status !== "ok") {
    const requiredChecks = requirements.map((req) => publicRequirementCheck(req, {
      status: req.required_tests.some((test) => testStatuses.get(test)?.status !== "ok") ? "failed" : "ok",
      testStatus: (test) => testStatuses.get(test)?.status ?? "failed",
      testOutput: (test) => testStatuses.get(test)?.output,
    }));
    const summaryPath = await writePublicSummary(params.evidence, {
      status: "failed",
      requirements: requiredChecks,
    });
    return { status: "failed", scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
  }

  const artifactStatuses = new Map<string, CommandStatus>();
  for (const artifact of [...new Set(requirements.flatMap((req) => req.required_artifacts))]) {
    artifactStatuses.set(artifact, existsSync(path.resolve(params.projectRoot, artifact)) ? "ok" : "failed");
  }
  const artifactStepStatus: CommandStatus = [...artifactStatuses.values()].some((status) => status !== "ok") ? "failed" : "ok";
  steps.push({ name: "required artifacts", status: artifactStepStatus });
  const requiredChecks = requirements.map((req) => publicRequirementCheck(req, {
    status: req.required_artifacts.some((artifact) => artifactStatuses.get(artifact) !== "ok") ? "failed" : "ok",
    testStatus: (test) => testStatuses.get(test)?.status ?? "ok",
    testOutput: (test) => testStatuses.get(test)?.output,
    artifactStatus: (artifact) => artifactStatuses.get(artifact) ?? "failed",
  }));

  const status: CommandStatus = artifactStepStatus === "ok" ? "ok" : "failed";
  const summaryPath = await writePublicSummary(params.evidence, { status, requirements: requiredChecks });
  steps.push({ name: "public summary", status: "ok", evidenceRefs: [summaryPath] });
  return { status, scope: params.scope, steps, requiredChecks, publicSummaryPath: summaryPath };
}

type PublicRequirement = Awaited<ReturnType<typeof buildNormalizedSpecBundle>>["verification"]["public_requirements"][number];

function selectPublicRequirements(requirements: PublicRequirement[], target?: string): PublicRequirement[] {
  if (!target) return requirements;
  return requirements.filter((req) => req.id === target || req.related_specs.includes(target));
}

function validatePublicRequirements(requirements: PublicRequirement[]): string[] {
  const errors: string[] = [];
  if (requirements.length === 0) errors.push("public-matrix");
  const seen = new Set<string>();
  for (const req of requirements) {
    if (seen.has(req.id)) errors.push(req.id);
    seen.add(req.id);
    if (req.required_tests.length === 0) errors.push(req.id);
  }
  return [...new Set(errors)];
}

function publicRequirementCheck(req: PublicRequirement, options: {
  status: CommandStatus;
  testStatus: (test: string) => CommandStatus;
  testOutput?: (test: string) => string | undefined;
  artifactStatus?: (artifact: string) => CommandStatus;
  reason?: string;
}): VerifyCheck {
  return {
    id: req.id,
    status: options.status,
    requiredTests: req.required_tests,
    requiredArtifacts: req.required_artifacts,
    tests: req.required_tests.map((test) => ({
      id: test,
      status: options.testStatus(test),
      output: options.testOutput?.(test),
    })),
    artifacts: req.required_artifacts.map((artifact) => ({
      path: artifact,
      status: options.artifactStatus?.(artifact) ?? "planned",
    })),
    reason: options.reason,
  };
}

async function writePublicSummary(
  evidence: EvidenceWriter,
  payload: Record<string, unknown>,
): Promise<string> {
  const summaryPath = path.join(evidence.artifacts_root, "verify", "public-summary.json");
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  evidence.addArtifactFromPath("verify-summary", summaryPath, "public verification summary");
  evidence.addEvidenceRef(`${evidence.run_id}:verify-public`, "verify-summary", path.relative(evidence.run_root, summaryPath));
  return path.relative(evidence.run_root, summaryPath);
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
