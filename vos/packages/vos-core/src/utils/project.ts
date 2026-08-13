import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseTopLevelYaml,
  extractTimelineStages,
  type TimelineStage,
} from "./yaml.ts";

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
  visibility_scope?: "public" | "agent-only" | "staff-only";
}

export interface StageShowResult {
  stages: TimelineStage[];
  currentStage?: string;
}

const STUDENT_ALLOWED_COMMANDS = [
  "init",
  "doctor",
  "spec lint",
  "kb add",
  "kb list",
  "kb search",
  "kb remove",
  "kb clear",
  "kb export-manifest",
  "kb import-manifest",
  "agent config",
  "agent implement",
  "agent debug",
  "agent verify",
  "agent ask",
  "agent review",
  "build",
  "run qemu",
  "run hardware",
  "verify",
  "verify public",
  "report",
  "submit",
] as const;

export async function loadProjectConfig(
  projectRoot: string,
): Promise<ProjectConfig> {
  const configPath = path.resolve(projectRoot, ".vos", "project.yaml");
  if (!existsSync(configPath)) {
    throw new Error("project configuration missing, run `vos init` first");
  }
  const text = await readFile(configPath, "utf8");
  return parseTopLevelYaml(text) as ProjectConfig;
}

export async function loadPolicyConfig(
  projectRoot: string,
): Promise<PolicyConfig> {
  const policyPath = path.resolve(projectRoot, ".vos", "policy.yaml");
  if (process.env.VOS_COURSE_ADAPTER === "xv6-spec") {
    return {
      allowed_commands: [...STUDENT_ALLOWED_COMMANDS, "verify full"],
      allowed_paths: [
        "spec",
        "src",
        "tests",
        ".vos",
        "Makefile",
        "kernel",
        "user",
      ],
      visibility_scope: "public",
    };
  }
  const isStudentV2 =
    existsSync(path.resolve(projectRoot, "vos.yaml")) &&
    !existsSync(path.resolve(projectRoot, ".vos", "project.yaml"));
  if (isStudentV2) {
    return {
      allowed_commands: [...STUDENT_ALLOWED_COMMANDS],
      allowed_paths: ["spec", "src", "tests", ".vos", "Makefile", "xtask"],
      visibility_scope: "public",
    };
  }
  if (!existsSync(policyPath)) {
    return {
      allowed_commands: [...STUDENT_ALLOWED_COMMANDS],
      allowed_paths: [
        "spec",
        "src",
        "tests",
        ".vos",
        "Makefile",
        "CMakeLists.txt",
        "xtask",
        "AGENTS.md",
      ],
      visibility_scope: "public",
    };
  }
  const text = await readFile(policyPath, "utf8");
  return parseTopLevelYaml(text) as PolicyConfig;
}

export async function loadTimeline(
  projectRoot: string,
): Promise<TimelineStage[]> {
  const timelinePath = path.resolve(
    projectRoot,
    "spec",
    "architecture",
    "timeline.yaml",
  );
  if (!existsSync(timelinePath)) {
    return [];
  }
  const text = await readFile(timelinePath, "utf8");
  return extractTimelineStages(text);
}

export async function currentStageForProject(
  projectRoot: string,
): Promise<string> {
  const project = await loadProjectConfig(projectRoot);
  const timeline = await loadTimeline(projectRoot);
  if (!project.current_stage) {
    throw new Error(
      "project current_stage is missing, run `vos init` to create it",
    );
  }
  if (timeline.length === 0) {
    throw new Error(
      "project timeline is missing, run `vos init` to create timeline metadata",
    );
  }
  if (!timeline.some((item) => item.stage === project.current_stage)) {
    throw new Error(
      `current_stage ${project.current_stage} is not in timeline`,
    );
  }
  return project.current_stage;
}

export async function ensureDefaultProjectConfig(
  projectRoot: string,
): Promise<void> {
  const vosDir = path.resolve(projectRoot, ".vos");
  const projectPath = path.join(vosDir, "project.yaml");
  const policyPath = path.join(vosDir, "policy.yaml");
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  mkdirSync(vosDir, { recursive: true });
  if (!existsSync(projectPath)) {
    writeFileSync(
      projectPath,
      `project_id: local-project\nspec_root: spec\ncurrent_stage: architecture-seed\n`,
    );
  }
  if (!existsSync(policyPath)) {
    const defaultPolicy = [
      "allowed_commands:",
      ...STUDENT_ALLOWED_COMMANDS.map((command) => `  - ${command}`),
      "allowed_paths:",
      "  - spec",
      "  - src",
      "  - tests",
      "  - .vos",
      "  - Makefile",
      "  - CMakeLists.txt",
      "  - xtask",
      "  - AGENTS.md",
      "visibility_scope: public\n",
    ];
    writeFileSync(policyPath, `${defaultPolicy.join("\n")}\n`);
  }
  if (!existsSync(agentsPath)) {
    writeFileSync(agentsPath, DEFAULT_AGENTS_TEMPLATE);
  }

  const cacheDir = path.join(vosDir, "cache", "normalized");
  const reportDir = path.join(vosDir, "runs");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(reportDir, { recursive: true });
  ensureVosGitignore(projectRoot);
}

function ensureVosGitignore(projectRoot: string): void {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const existing = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf8")
    : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());

  const hasVos = lines.some((line) => line === ".vos/" || line === ".vos/*");
  const hasDotEnv = lines.some((line) => line === ".env");

  if (hasVos && hasDotEnv) return;

  let content = existing;
  if (content && !content.endsWith("\n")) content += "\n";

  if (!hasVos) content += ".vos/\n";
  if (!hasDotEnv) content += ".env\n";

  writeFileSync(gitignorePath, content);
}

const DEFAULT_AGENTS_TEMPLATE = `# AGENTS.md

Guidance for agents and humans working in this VOS project.

## Project

This is a VeriSpecOSLab project. Treat \`spec/\`, source code, tests, and \`.vos/\`
runtime artifacts as separate evidence-backed surfaces.

## Agent Instructions

- Inspect relevant specs and existing files before proposing patches.
- Keep changes scoped to the requested task and allowed paths.
- Do not edit generated \`.vos/runs/\` or \`.vos/worktrees/\` artifacts.
- Update this file when new public project conventions or agent-facing workflow
  rules are introduced.
`;
