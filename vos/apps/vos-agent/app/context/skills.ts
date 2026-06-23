import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export interface ProjectSkill {
  name: string;
  description: string;
  path: string;
}

export interface LoadProjectSkillsOptions {
  rootDir?: string;
}

const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function loadProjectSkills(
  opts: LoadProjectSkillsOptions = {},
): ProjectSkill[] {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const skillsDir = join(rootDir, ".agents", "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(skillsDir, entry.name, "SKILL.md");
      if (!existsSync(path)) return [];
      return [parseSkillFile(path, entry.name)];
    });
}

function parseSkillFile(path: string, directoryName: string): ProjectSkill {
  const content = readFileSync(path, "utf8");
  const frontmatter = parseFrontmatter(content);
  const name = Object.hasOwn(frontmatter, "name") ? frontmatter.name : directoryName;
  validateSkillName(name, path, `skills.${directoryName}.name`);
  const description = frontmatter.description ?? "No description provided.";
  if (description.trim().length === 0) {
    throw invalid(path, `skills.${directoryName}.description must be a non-empty string`);
  }
  return {
    name,
    description,
    path,
  };
}

function parseFrontmatter(content: string): Record<string, string | undefined> {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const end = lines.indexOf("---", 1);
  if (end === -1) return {};
  const raw = lines.slice(1, end);
  const result: Record<string, string | undefined> = {};
  for (const line of raw) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function validateSkillName(
  name: string | undefined,
  path: string,
  field: string,
): asserts name is string {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw invalid(path, `${field} must be a non-empty string`);
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw invalid(path, `${field} must match ${SKILL_NAME_PATTERN}`);
  }
}

function invalid(path: string, detail: string): Error {
  return new Error(`invalid skill ${basename(path)}: ${detail}`);
}
