import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseTopLevelYaml, extractTimelineStages, type TimelineStage } from "./yaml.ts";

export interface ProjectConfig {
  project_id?: string;
  portal_url?: string;
  spec_root?: string;
  current_stage?: string;
  allowed_paths?: string[];
}

export interface PolicyConfig {
  allowed_commands?: string[];
  allowed_paths?: string[];
  denied_commands?: string[];
  visibility_scope?: "public" | "agent-only";
}

export interface StageShowResult {
  stages: TimelineStage[];
  currentStage?: string;
}

export async function loadProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const configPath = path.resolve(projectRoot, ".vos", "project.yaml");
  if (!existsSync(configPath)) {
    throw new Error("project configuration missing, run `vos init` first");
  }
  const text = await readFile(configPath, "utf8");
  return parseTopLevelYaml(text) as ProjectConfig;
}

export async function loadPolicyConfig(projectRoot: string): Promise<PolicyConfig> {
  const policyPath = path.resolve(projectRoot, ".vos", "policy.yaml");
  if (!existsSync(policyPath)) {
    return {
      allowed_commands: [
        "init",
        "doctor",
        "stage show",
        "spec lint",
        "spec normalize",
        "spec check-consistency",
        "spec patch lint",
        "spec patch apply",
        "arch lint",
        "arch compose",
        "arch derive-tests",
        "build",
        "build generate",
        "run qemu",
        "test",
        "verify public",
        "verify patch",
        "verify full",
        "verify invariant",
        "verify fuzz",
        "verify base",
        "verify architecture",
        "verify composition",
        "verify goal",
        "trace syscall",
        "debug explain-log",
        "report generate",
        "submit pack",
        "ledger record",
        "agent context",
        "agent plan",
        "agent generate",
        "agent apply-patch",
        "agent log",
      ],
      allowed_paths: ["spec", "src", "tests", ".vos", "Makefile", "CMakeLists.txt", "xtask"],
      visibility_scope: "public",
    };
  }
  const text = await readFile(policyPath, "utf8");
  return parseTopLevelYaml(text) as PolicyConfig;
}

export async function loadTimeline(projectRoot: string): Promise<TimelineStage[]> {
  const timelinePath = path.resolve(projectRoot, "spec", "architecture", "timeline.yaml");
  if (!existsSync(timelinePath)) {
    return [];
  }
  const text = await readFile(timelinePath, "utf8");
  return extractTimelineStages(text);
}

export async function currentStageForProject(projectRoot: string): Promise<string> {
  const project = await loadProjectConfig(projectRoot);
  const timeline = await loadTimeline(projectRoot);
  if (!project.current_stage) {
    throw new Error("project current_stage is missing, run `vos init` to create it");
  }
  if (timeline.length === 0) {
    throw new Error("project timeline is missing, run `vos init` to create timeline metadata");
  }
  if (!timeline.some((item) => item.stage === project.current_stage)) {
    throw new Error(`current_stage ${project.current_stage} is not in timeline`);
  }
  return project.current_stage;
}

export async function ensureDefaultProjectConfig(projectRoot: string): Promise<void> {
  const vosDir = path.resolve(projectRoot, ".vos");
  const projectPath = path.join(vosDir, "project.yaml");
  const policyPath = path.join(vosDir, "policy.yaml");
  mkdirSync(vosDir, { recursive: true });
  if (!existsSync(projectPath)) {
    writeFileSync(
      projectPath,
      `project_id: local-project\nspec_root: spec\ncurrent_stage: boot\n`,
    );
  }
  if (!existsSync(policyPath)) {
    const defaultPolicy = [
      "allowed_commands:",
      "  - init",
      "  - doctor",
      "  - stage show",
      "  - spec lint",
      "  - spec normalize",
      "  - spec check-consistency",
      "  - spec patch lint",
      "  - spec patch apply",
      "  - arch lint",
      "  - arch compose",
      "  - arch derive-tests",
      "  - build",
      "  - build generate",
      "  - run qemu",
      "  - test",
      "  - verify public",
      "  - verify patch",
      "  - verify full",
      "  - verify invariant",
      "  - verify fuzz",
      "  - verify base",
      "  - verify architecture",
      "  - verify composition",
      "  - verify goal",
      "  - trace syscall",
      "  - debug explain-log",
      "  - report generate",
      "  - submit pack",
      "  - ledger record",
      "  - agent context",
      "  - agent plan",
      "  - agent generate",
      "  - agent apply-patch",
      "  - agent log",
      "allowed_paths:",
      "  - spec",
      "  - src",
      "  - tests",
      "  - .vos",
      "  - Makefile",
      "  - CMakeLists.txt",
      "  - xtask",
      "visibility_scope: public\n",
    ];
    writeFileSync(policyPath, `${defaultPolicy.join("\n")}\n`);
  }

  const cacheDir = path.join(vosDir, "cache", "normalized");
  const reportDir = path.join(vosDir, "runs");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
}
