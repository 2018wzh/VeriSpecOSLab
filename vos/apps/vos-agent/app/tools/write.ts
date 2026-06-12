import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Tool } from "./types.ts";
import {
  parseToolArguments,
  requireStringArgument,
  resolveWithinRoot,
} from "./common.ts";

export interface WriteOptions {
  /** Workspace root. Relative paths resolve here; escapes are rejected. */
  rootDir?: string;
}

export function createWriteTool(opts: WriteOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());

  return {
    name: "Write",
    schema: {
      type: "function",
      function: {
        name: "Write",
        description:
          "Write content to a file inside the workspace. Creates the file if it does not exist, overwrites it if it does. Parent directories are created as needed.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "The path of the file to write to, relative to the workspace root unless absolute",
            },
            content: {
              type: "string",
              description: "The content to write to the file",
            },
          },
          required: ["file_path", "content"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Write", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const filePath = requireStringArgument(
        "Write",
        parsed.args,
        "file_path",
      );
      if (!filePath.ok) return filePath.error;

      const content = requireStringArgument("Write", parsed.args, "content", {
        allowEmpty: true,
      });
      if (!content.ok) return content.error;

      const resolved = resolveWithinRoot(rootDir, filePath.value);
      if (!resolved.ok) return `Error writing file: ${resolved.error}`;

      try {
        const dir = dirname(resolved.path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolved.path, content.value, "utf8");
        return "OK";
      } catch (e) {
        return `Error writing file: ${(e as Error).message}`;
      }
    },
  };
}

export const writeTool: Tool = createWriteTool();
