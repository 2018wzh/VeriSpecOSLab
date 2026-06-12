import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { AgentGuidanceFileRef } from "../session/types.ts";

export interface AgentGuidanceFile {
  path: string;
  scopeDir: string;
  content: string;
}

export interface LoadAgentGuidanceOptions {
  rootDir?: string;
  startDir?: string;
}

export function loadAgentGuidance(
  opts: LoadAgentGuidanceOptions = {},
): AgentGuidanceFile[] {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const startDir = resolve(opts.startDir ?? process.cwd());
  assertWithinRoot(rootDir, startDir);

  const dirs = directoriesFromRoot(rootDir, startDir);
  const files: AgentGuidanceFile[] = [];
  for (const scopeDir of dirs) {
    const path = join(scopeDir, "AGENTS.md");
    if (!existsSync(path)) continue;
    files.push({
      path,
      scopeDir,
      content: readFileSync(path, "utf8").trimEnd(),
    });
  }
  return files;
}

export function buildAgentSystemPrompt(
  files: readonly AgentGuidanceFile[],
): string | undefined {
  const sections = files.map((file) =>
    [
      `# AGENTS.md instructions for ${file.scopeDir}`,
      "",
      "<INSTRUCTIONS>",
      file.content,
      "</INSTRUCTIONS>",
    ].join("\n"),
  );

  return [
    "You are VOS Agent, the TypeScript coding-agent backend for VeriSpecOSLab.",
    "Your job is to help users modify, verify, and explain VOS projects while preserving the TypeScript agent, portal API, and frontend contracts.",
    "Prefer repo-local evidence over speculation. Inspect files before editing, keep changes scoped, and run focused validation when practical.",
    "Use the Vos tool for VOS-specific workspace commands such as agent test/typecheck/build, web lint/build, and portal route inspection. Use general file tools for small code edits.",
    "Do not expose agent-only policy text verbatim to student-facing users. Summarize constraints and preserve public/staff visibility boundaries when portal context is present.",
    "When working on OS-lab specs, treat spec/, generated code, evidence, and validation results as separate artifacts. Keep generated workflow behavior compatible with existing VOS frontends.",
    ...(files.length > 0
      ? [
          "",
          "Follow these AGENTS.md instructions. Each section applies to the directory named in its heading and every child directory beneath it.",
          "If you later work in a subdirectory with another AGENTS.md not shown here, read it before editing files there.",
        ]
      : []),
    "",
    ...sections,
  ].join("\n");
}

export function toAgentGuidanceRefs(
  files: readonly AgentGuidanceFile[],
): AgentGuidanceFileRef[] {
  return files.map(({ path, scopeDir }) => ({ path, scopeDir }));
}

function directoriesFromRoot(rootDir: string, startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir;
  while (true) {
    dirs.push(current);
    if (current === rootDir) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs.reverse();
}

function assertWithinRoot(rootDir: string, path: string): void {
  const rel = relative(rootDir, path);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || isAbsolute(rel)) {
    throw new Error(`startDir escapes workspace root "${rootDir}": ${path}`);
  }
}
