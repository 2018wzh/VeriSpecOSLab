import type { CommandStatus } from "../types.ts";
import type { EvidenceWriter } from "../evidence/index.ts";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { runBuildCommand } from "./build.ts";
import { runQemuCommand } from "./run.ts";
import { parseTopLevelYaml } from "../utils/yaml.ts";

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
    case "patch":
      return ["build"];
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
    case "invariant":
      return ["build"];
    case "fuzz":
      return ["run"];
    default:
      return ["build", "run"];
  }
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
