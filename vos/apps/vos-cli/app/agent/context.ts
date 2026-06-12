import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.ts";
import { loadPolicyConfig, loadProjectConfig, loadTimeline } from "../utils/project.ts";
import { collectStringListByKey, parseTopLevelYaml, type TimelineStage } from "../utils/yaml.ts";
import { scanRecentEvidenceRefs } from "./helpers.ts";

export interface ContextBundle {
  requested_scope: string;
  resolved_specs: string[];
  recent_evidence: Array<{ run_id: string; manifest: string }>;
  current_stage: string;
  allowed_paths: string[];
  allowed_path_sources: {
    policy_paths: number;
    spec_bound_paths: number;
    effective_paths: number;
  };
  recommended_commands: string[];
  visibility_scope: "public" | "agent-only";
  spec_snippets: Array<{ kind: string; summary: string; path?: string }>;
  policy_flags: string[];
}

export async function buildContextBundle(params: {
  projectRoot: string;
  requestedScope?: string;
}): Promise<ContextBundle> {
  const projectFile = path.join(params.projectRoot, ".vos", "project.yaml");
  if (!existsSync(projectFile)) {
    throw new CliError("project configuration missing", "failed", {
      path: projectFile,
      kind: "missing_project_config",
    });
  }
  const project = await loadProjectConfig(params.projectRoot);
  const policy = await loadPolicyConfig(params.projectRoot);
  const stages = await loadTimeline(params.projectRoot);
  if (!project.current_stage) {
    throw new CliError("project current_stage missing", "failed", {
      path: projectFile,
      kind: "missing_current_stage",
    });
  }
  const stageNames = stages.map((item) => item.stage).filter(Boolean) as string[];
  if (stageNames.length > 0 && !stageNames.includes(project.current_stage)) {
    throw new CliError(`current_stage ${project.current_stage} not in timeline`, "failed", {
      kind: "stage_timeline_mismatch",
      current_stage: project.current_stage,
    });
  }

  const resolvedSpecs = await collectSpecSnippets(params.projectRoot);
  const recentEvidence = await scanRecentEvidenceRefs(params.projectRoot);

  const currentStage = project.current_stage;
  const recommended = buildRecommendedCommands(currentStage, stages);
  const policyPaths = policy.allowed_paths ?? ["src", "spec", "tests", ".vos"];
  const allowedPaths = await loadAgentAllowedPaths(params.projectRoot);
  const specBoundAllowedPathCount = allowedPaths
    .filter((entry) => !isPathCoveredByPolicy(entry, policyPaths))
    .length;

  return {
    requested_scope: params.requestedScope ?? "agent",
    resolved_specs: resolvedSpecs,
    recent_evidence: recentEvidence,
    current_stage: currentStage,
    allowed_paths: allowedPaths,
    allowed_path_sources: {
      policy_paths: policyPaths.length,
      spec_bound_paths: specBoundAllowedPathCount,
      effective_paths: allowedPaths.length,
    },
    recommended_commands: recommended,
    visibility_scope: policy.visibility_scope ?? "public",
    spec_snippets: currentStage !== undefined
      ? [{ kind: "stage", summary: `current_stage:${currentStage}` }]
      : [],
    policy_flags: [
      `allowed_paths:${(policy.allowed_paths ?? []).length}`,
      `spec_bound_allowed_paths:${specBoundAllowedPathCount}`,
      `effective_allowed_paths:${allowedPaths.length}`,
      `visibility:${policy.visibility_scope ?? "public"}`,
    ],
  };
}

export async function loadAgentAllowedPaths(projectRoot: string): Promise<string[]> {
  const policy = await loadPolicyConfig(projectRoot);
  const policyPaths = policy.allowed_paths ?? ["src", "spec", "tests", ".vos"];
  const specBoundPaths = await collectSpecBoundEditablePaths(projectRoot);
  const specBoundAdditions = specBoundPaths.filter((entry) =>
    !isPathCoveredByPolicy(entry, policyPaths)
  );
  return uniquePaths([...policyPaths, ...specBoundAdditions]);
}

export interface SpecSnippet {
  kind: string;
  summary: string;
  path?: string;
}

async function collectSpecSnippets(projectRoot: string): Promise<string[]> {
  const project = await loadProjectConfig(projectRoot);
  const specRoot = path.resolve(projectRoot, project.spec_root ?? "spec");

  const files = (await readDirectory(specRoot, [".yaml", ".yml"])) as string[];
  return files.slice(0, 20);
}

async function collectSpecBoundEditablePaths(projectRoot: string): Promise<string[]> {
  const fromCache = await collectEditablePathsFromNormalizedCache(projectRoot);
  if (fromCache.length > 0) {
    return fromCache;
  }
  return await collectEditablePathsFromSpecYaml(projectRoot);
}

async function collectEditablePathsFromNormalizedCache(projectRoot: string): Promise<string[]> {
  const bundlePath = path.join(projectRoot, ".vos", "cache", "normalized", "bundle.json");
  if (!existsSync(bundlePath)) return [];

  try {
    const parsed = JSON.parse(await readFile(bundlePath, "utf8"));
    const paths: string[] = [];
    walkJson(parsed, (key, value) => {
      if ((key === "file" || key === "target_file") && typeof value === "string") {
        if (looksLikeEditableProjectPath(value)) {
          paths.push(value);
        }
      }
    });
    return uniquePaths(paths);
  } catch {
    return [];
  }
}

async function collectEditablePathsFromSpecYaml(projectRoot: string): Promise<string[]> {
  const project = await loadProjectConfig(projectRoot);
  const specRoot = path.resolve(projectRoot, project.spec_root ?? "spec");
  const files = await readDirectory(specRoot, [".yaml", ".yml"]);
  const out: string[] = [];
  for (const file of files) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const parsed = parseTopLevelYaml(text);
    for (const value of [
      ...collectStringListByKey(parsed, "file"),
      ...collectStringListByKey(parsed, "target_file"),
    ]) {
      if (looksLikeEditableProjectPath(value)) {
        out.push(value);
      }
    }
  }
  return uniquePaths(out);
}

function walkJson(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      walkJson(item, visit);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visit(key, child);
    walkJson(child, visit);
  }
}

function looksLikeEditableProjectPath(value: string): boolean {
  const normalized = normalizeProjectPath(value);
  if (!normalized || normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.startsWith("build/")) return false;
  return /\.(c|h|S|s|ld|rs|toml|txt|mk)$/i.test(normalized)
    || normalized === "Makefile"
    || normalized === "CMakeLists.txt";
}

function normalizeProjectPath(value: string): string {
  return path.normalize(value.trim()).replace(/\\/g, "/").replace(/^\.\//, "");
}

function isPathCoveredByPolicy(value: string, policyPaths: readonly string[]): boolean {
  const normalized = normalizeProjectPath(value);
  return policyPaths.some((entry) => {
    const policyPath = normalizeProjectPath(entry);
    return normalized === policyPath || normalized.startsWith(`${policyPath}/`);
  });
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeProjectPath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}


function buildRecommendedCommands(currentStage: string, stages: TimelineStage[]): string[] {
  const stageNames = stages.map((stage) => stage.stage).filter(Boolean) as string[];
  const suffix = stageNames.includes(currentStage) ? currentStage : "next";
  return [
    "spec lint",
    "spec normalize",
    "arch derive-tests",
    `agent generate ${suffix}`,
    "build",
    "test",
    `verify goal` ,
  ];
}

async function readDirectory(root: string, suffixes: string[]): Promise<string[]> {
  const out: string[] = [];
  const normalizedSuffixes = suffixes.map((suffix) => suffix.toLowerCase());
  let readdir: (path: string, options: { withFileTypes: true }) => Promise<Array<{
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
  }>>;
  try {
    ({ readdir } = await import("node:fs/promises"));
  } catch {
    return [];
  }
  const walk = async (current: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (!normalizedSuffixes.some((suffix) => lower.endsWith(suffix))) {
        continue;
      }
      out.push(childPath);
    }
  };
  await walk(root);
  return out;
}
