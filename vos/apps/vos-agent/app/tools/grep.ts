import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Tool } from "./types.ts";
import {
  parseToolArguments,
  readOptionalBooleanArgument,
  readOptionalIntegerArgument,
  requireStringArgument,
  resolveWithinRoot,
} from "./common.ts";

const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS_CAP = 1_000;
const IGNORED_DIRS = new Set([".git", ".stars", ".vos", ".vos-agent", "node_modules", "dist", "coverage"]);

interface GrepMatch {
  file_path: string;
  line: number;
  column: number;
  text: string;
}

export interface GrepOptions {
  /** Workspace root. Search paths are resolved relative to this root. */
  rootDir?: string;
}

export function createGrepTool(opts: GrepOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());

  return {
    name: "Grep",
    schema: {
      type: "function",
      function: {
        name: "Grep",
        description:
          "Search file contents in the workspace. Returns deterministic JSON with file_path, line, column, and text for each matching line.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Literal text or regex pattern to search for",
            },
            path: {
              type: "string",
              description:
                "File or directory to search, relative to the workspace root. Defaults to the workspace root.",
            },
            regex: {
              type: "boolean",
              description: "Treat pattern as a JavaScript regular expression. Defaults to false.",
            },
            case_sensitive: {
              type: "boolean",
              description: "Use case-sensitive matching. Defaults to true.",
            },
            max_results: {
              type: "integer",
              description: `Maximum matches to return (1-${MAX_RESULTS_CAP}). Defaults to ${DEFAULT_MAX_RESULTS}.`,
            },
          },
          required: ["pattern"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Grep", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const pattern = requireStringArgument("Grep", parsed.args, "pattern", {
        trimForEmptyCheck: true,
      });
      if (!pattern.ok) return pattern.error;

      const pathArg = readOptionalPath(parsed.args);
      if (!pathArg.ok) return pathArg.error;

      const regex = readOptionalBooleanArgument("Grep", parsed.args, "regex");
      if (!regex.ok) return regex.error;

      const caseSensitive = readOptionalBooleanArgument(
        "Grep",
        parsed.args,
        "case_sensitive",
        true,
      );
      if (!caseSensitive.ok) return caseSensitive.error;

      const maxResults = readOptionalIntegerArgument(
        "Grep",
        parsed.args,
        "max_results",
        { defaultValue: DEFAULT_MAX_RESULTS, min: 1, max: MAX_RESULTS_CAP },
      );
      if (!maxResults.ok) return maxResults.error;

      const resolved = resolveWithinRoot(rootDir, pathArg.value);
      if (!resolved.ok) return `Error searching files: ${resolved.error}`;

      const matcher = createMatcher(pattern.value, regex.value, caseSensitive.value);
      if (!matcher.ok) return matcher.error;

      try {
        const files = collectFiles(resolved.path).sort((a, b) =>
          relativePath(rootDir, a).localeCompare(relativePath(rootDir, b)),
        );
        const matches: GrepMatch[] = [];
        let count = 0;
        for (const file of files) {
          for (const match of grepFile(rootDir, file, matcher.value)) {
            count++;
            if (matches.length < maxResults.value) matches.push(match);
          }
        }
        return JSON.stringify({
          matches,
          count,
          truncated: matches.length < count,
        }, null, 2);
      } catch (e) {
        return `Error searching files: ${(e as Error).message}`;
      }
    },
  };
}

export const grepTool: Tool = createGrepTool();

function readOptionalPath(
  args: Record<string, unknown>,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = args.path;
  if (value === undefined) return { ok: true, value: "." };
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      ok: false,
      error: 'Error validating Grep arguments: "path" must be a non-empty string',
    };
  }
  return { ok: true, value };
}

function createMatcher(
  pattern: string,
  regex: boolean,
  caseSensitive: boolean,
): { ok: true; value: (line: string) => number } | { ok: false; error: string } {
  if (regex) {
    try {
      const re = new RegExp(pattern, caseSensitive ? "" : "i");
      return {
        ok: true,
        value: (line) => {
          const match = re.exec(line);
          return match ? match.index : -1;
        },
      };
    } catch (e) {
      return { ok: false, error: `Error searching files: invalid regex: ${(e as Error).message}` };
    }
  }

  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase();
  return {
    ok: true,
    value: (line) => {
      const haystack = caseSensitive ? line : line.toLocaleLowerCase();
      return haystack.indexOf(needle);
    },
  };
}

function collectFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(child));
    } else if (entry.isFile()) {
      files.push(child);
    }
  }
  return files;
}

function grepFile(
  rootDir: string,
  file: string,
  matcher: (line: string) => number,
): GrepMatch[] {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  if (content.includes("\0")) return [];

  const matches: GrepMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const column = matcher(lines[i]);
    if (column >= 0) {
      matches.push({
        file_path: relativePath(rootDir, file),
        line: i + 1,
        column: column + 1,
        text: lines[i],
      });
    }
  }
  return matches;
}

function relativePath(rootDir: string, file: string): string {
  const rel = relative(rootDir, file);
  if (rel === "") return isAbsolute(file) ? file : ".";
  return rel.replace(/\\/g, "/");
}
