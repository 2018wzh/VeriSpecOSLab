import { isAbsolute, resolve } from "node:path";
import type { Tool } from "./types.ts";
import {
  parseToolArguments,
  readOptionalIntegerArgument,
  requireStringArgument,
} from "./common.ts";

const DEFAULT_MAX_RESULTS = 200;
const MAX_RESULTS_CAP = 1_000;

export interface GlobOptions {
  /** Workspace root. Glob patterns are evaluated relative to this root. */
  rootDir?: string;
}

export function createGlobTool(opts: GlobOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());

  return {
    name: "Glob",
    schema: {
      type: "function",
      function: {
        name: "Glob",
        description:
          "List files in the workspace matching a glob pattern. Returns deterministic JSON with relative paths.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                "Glob pattern relative to the workspace root, for example src/**/*.ts",
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
      const parsed = parseToolArguments("Glob", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const pattern = requireStringArgument("Glob", parsed.args, "pattern", {
        trimForEmptyCheck: true,
      });
      if (!pattern.ok) return pattern.error;

      const maxResults = readOptionalIntegerArgument(
        "Glob",
        parsed.args,
        "max_results",
        { defaultValue: DEFAULT_MAX_RESULTS, min: 1, max: MAX_RESULTS_CAP },
      );
      if (!maxResults.ok) return maxResults.error;

      const safePattern = validateRelativePattern(pattern.value);
      if (!safePattern.ok) return `Error globbing files: ${safePattern.error}`;

      try {
        const glob = new Bun.Glob(pattern.value);
        const matches = Array.from(glob.scanSync({ cwd: rootDir, onlyFiles: true }))
          .map(toPosixPath)
          .sort();
        const limited = matches.slice(0, maxResults.value);
        return JSON.stringify({
          matches: limited,
          count: matches.length,
          truncated: limited.length < matches.length,
        }, null, 2);
      } catch (e) {
        return `Error globbing files: ${(e as Error).message}`;
      }
    },
  };
}

export const globTool: Tool = createGlobTool();

function validateRelativePattern(
  pattern: string,
): { ok: true } | { ok: false; error: string } {
  if (isAbsolute(pattern)) {
    return { ok: false, error: `Path escapes workspace root: ${pattern}` };
  }
  if (pattern.split(/[\\/]+/).includes("..")) {
    return { ok: false, error: `Path escapes workspace root: ${pattern}` };
  }
  return { ok: true };
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}
