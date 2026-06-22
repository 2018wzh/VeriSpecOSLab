import type { CommandStatus } from "../types.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { runBuildCommand } from "./build.ts";
import { runQemuCommand } from "./run.ts";
import { parseTopLevelYaml } from "../utils/yaml.ts";
import {
  buildNormalizedSpecBundle,
  deriveTestMatrix,
  hasBlockingDiagnostics,
  resolveSpecPatch,
  selectPatchVerificationChecks,
} from "vos-spec";

export interface VerifyResult {
  status: CommandStatus;
  scope: string;
  steps: Array<{ name: string; status: CommandStatus }>;
  requiredChecks?: Array<{ id: string; status: CommandStatus; requiredArtifacts?: string[] }>;
}

export interface VerifyPublicPlan {
  status: CommandStatus;
  requiredChecks: Array<{ id: string } | string>;
}

interface PublicMatrixSpec {
  public_requirements?: Array<{ id?: unknown; required_artifacts?: unknown }>;
}

export async function runVerifyCommand(params: {
  projectRoot: string;
  evidence: EvidenceWriter;
  scope: string;
  target?: string;
  dryRun: boolean;
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
    const { impact } = await resolveSpecPatch({
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
      if (check === "build" || check.startsWith("make ") || check.includes("build")) {
        const result = await runBuildCommand({
          projectRoot: params.projectRoot,
          evidence: params.evidence,
          dryRun: params.dryRun,
          signal: params.signal,
        });
        steps.push({ name: check, status: result.status });
        if (result.status !== "ok") return { status: result.status, scope, steps };
      } else {
        steps.push({ name: check, status: "ok" });
      }
    }
    return {
      status: "ok",
      scope,
      steps,
      requiredChecks: selected.map((id) => ({ id, status: "ok" })),
    };
  }

  if (scope === "invariant" || scope === "fuzz") {
    const bundle = await buildNormalizedSpecBundle({ projectRoot: params.projectRoot });
    const matrix = deriveTestMatrix(bundle, params.target);
    const hasObligations = scope === "invariant"
      ? bundle.operations.some((operation) => operation.invariants_preserved.length > 0)
      : matrix.generated_tests.length > 0 || matrix.hidden_tags.length > 0;
    return {
      status: hasObligations ? "not_implemented" : "validation_failed",
      scope,
      steps: [{
        name: scope === "invariant" ? "invariant adapter" : "fuzz adapter",
        status: hasObligations ? "not_implemented" : "validation_failed",
      }],
      requiredChecks: scope === "invariant"
        ? bundle.operations
          .filter((operation) => operation.invariants_preserved.length > 0)
          .map((operation) => ({ id: operation.id, status: "not_implemented" as CommandStatus }))
        : [...matrix.generated_tests, ...matrix.hidden_tags].map((test) => ({ id: test.id, status: "not_implemented" as CommandStatus })),
    };
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

    const steps: Array<{ name: string; status: CommandStatus }> = [];

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
      requiredChecks: checks as Array<{ id: string; status: CommandStatus; requiredArtifacts?: string[] }>,
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

async function collectPublicChecks(projectRoot: string): Promise<Array<{ id: string; required_artifacts?: string[] }>> {
  const matrixPath = path.join(projectRoot, "spec", "verification", "public-matrix.yaml");
  if (!existsSync(matrixPath)) {
    return [];
  }
  const raw = await readFile(matrixPath, "utf8");
  const parsed = parseTopLevelYaml(raw) as PublicMatrixSpec;
  const requirements = parsed.public_requirements ?? [];
  const out: Array<{ id: string; required_artifacts?: string[] }> = [];

  for (const rawReq of requirements) {
    if (!rawReq || typeof rawReq !== "object") continue;
    const req = rawReq as { id?: unknown; required_artifacts?: unknown };
    const id = typeof req.id === "string" && req.id.trim().length > 0
      ? req.id.trim()
      : "anonymous";
    out.push({
      id,
      required_artifacts: Array.isArray(req.required_artifacts)
        ? req.required_artifacts.filter((value) => typeof value === "string") as string[]
        : undefined,
    });
  }

  return out;
}
