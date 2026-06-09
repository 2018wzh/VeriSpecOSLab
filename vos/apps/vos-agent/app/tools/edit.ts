import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Tool } from "./types.ts";
import {
  parseToolArguments,
  readOptionalBooleanArgument,
  requireStringArgument,
  resolveWithinRoot,
} from "./common.ts";

export interface EditOptions {
  /** Workspace root. Relative paths resolve here; escapes are rejected. */
  rootDir?: string;
}

export function createEditTool(opts: EditOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());

  return {
    name: "Edit",
    schema: {
      type: "function",
      function: {
        name: "Edit",
        description:
          "Surgically edit an existing file inside the workspace by replacing exact literal text. Fails if the target text is missing or ambiguous unless replace_all is true.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description:
                "The path of the file to edit, relative to the workspace root unless absolute",
            },
            old_str: {
              type: "string",
              description:
                "Exact literal text currently in the file. Must be non-empty and unique unless replace_all is true.",
            },
            new_str: {
              type: "string",
              description: "Replacement text. May be an empty string to delete old_str.",
            },
            replace_all: {
              type: "boolean",
              description:
                "Replace every exact occurrence of old_str instead of requiring exactly one match.",
            },
          },
          required: ["file_path", "old_str", "new_str"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Edit", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const filePath = requireStringArgument("Edit", parsed.args, "file_path");
      if (!filePath.ok) return filePath.error;

      const oldStr = requireStringArgument("Edit", parsed.args, "old_str");
      if (!oldStr.ok) return oldStr.error;

      const newStr = requireStringArgument("Edit", parsed.args, "new_str", {
        allowEmpty: true,
      });
      if (!newStr.ok) return newStr.error;

      const replaceAll = readOptionalBooleanArgument("Edit", parsed.args, "replace_all");
      if (!replaceAll.ok) return replaceAll.error;

      const resolved = resolveWithinRoot(rootDir, filePath.value);
      if (!resolved.ok) return `Error editing file: ${resolved.error}`;

      try {
        const content = readFileSync(resolved.path, "utf8");
        const matchCount = countOccurrences(content, oldStr.value);
        if (matchCount === 0) {
          return "Error editing file: old_str not found";
        }
        if (!replaceAll.value && matchCount > 1) {
          return `Error editing file: old_str matched ${matchCount} times; set replace_all to true to replace all matches`;
        }
        const updated = replaceAll.value
          ? content.split(oldStr.value).join(newStr.value)
          : content.replace(oldStr.value, newStr.value);
        writeFileSync(resolved.path, updated, "utf8");
        return "OK";
      } catch (e) {
        return `Error editing file: ${(e as Error).message}`;
      }
    },
  };
}

export const editTool: Tool = createEditTool();

function countOccurrences(content: string, needle: string): number {
  return content.split(needle).length - 1;
}
