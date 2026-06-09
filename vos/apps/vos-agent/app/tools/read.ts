import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./types.ts";
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  parseToolArguments,
  requireStringArgument,
  resolveWithinRoot,
  truncateUtf8,
} from "./common.ts";

export interface ReadOptions {
  /** Workspace root. Relative paths resolve here; escapes are rejected. */
  rootDir?: string;
  /** Maximum UTF-8 bytes returned to the model. Defaults to 200 KB. */
  maxBytes?: number;
}

export function createReadTool(opts: ReadOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const maxBytes = opts.maxBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;

  return {
    name: "Read",
    schema: {
      type: "function",
      function: {
        name: "Read",
        description:
          "Read and return the contents of a file inside the workspace",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "The path to the file to read, relative to the workspace root unless absolute",
            },
          },
          required: ["file_path"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Read", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const filePath = requireStringArgument(
        "Read",
        parsed.args,
        "file_path",
      );
      if (!filePath.ok) return filePath.error;

      const resolved = resolveWithinRoot(rootDir, filePath.value);
      if (!resolved.ok) return `Error reading file: ${resolved.error}`;

      try {
        return truncateUtf8(
          readFileSync(resolved.path, "utf8"),
          maxBytes,
          "file contents",
        );
      } catch (e) {
        return `Error reading file: ${(e as Error).message}`;
      }
    },
  };
}

export const readTool: Tool = createReadTool();
