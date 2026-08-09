import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Tool } from "./types.ts";
import { parseToolArguments, resolveWithinRoot } from "./common.ts";

export interface WriteFilesOptions {
  rootDir?: string;
}

export function createWriteFilesTool(opts: WriteFilesOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  return {
    name: "WriteFiles",
    schema: {
      type: "function",
      function: {
        name: "WriteFiles",
        description: "Write several complete workspace files in one call. All paths are validated before any file is written; use this for a related implementation/test file batch.",
        parameters: {
          type: "object",
          properties: {
            files: {
              type: "array",
              minItems: 1,
              maxItems: 64,
              items: {
                type: "object",
                properties: {
                  file_path: { type: "string" },
                  content: { type: "string" },
                },
                required: ["file_path", "content"],
                additionalProperties: false,
              },
            },
          },
          required: ["files"],
          additionalProperties: false,
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("WriteFiles", argumentsJson);
      if (!parsed.ok) return parsed.error;
      const raw = parsed.args.files;
      if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
        return "Error validating WriteFiles arguments: files must contain 1 to 64 entries";
      }
      const resolved: Array<{ path: string; content: string }> = [];
      const seen = new Set<string>();
      for (let index = 0; index < raw.length; index++) {
        const entry = raw[index];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          return `Error validating WriteFiles arguments: files[${index}] must be an object`;
        }
        const filePath = (entry as Record<string, unknown>).file_path;
        const content = (entry as Record<string, unknown>).content;
        if (typeof filePath !== "string" || filePath.length === 0 || typeof content !== "string") {
          return `Error validating WriteFiles arguments: files[${index}] requires string file_path and content`;
        }
        const target = resolveWithinRoot(rootDir, filePath);
        if (!target.ok) return `Error writing files: ${target.error}`;
        if (seen.has(target.path)) return `Error validating WriteFiles arguments: duplicate path ${filePath}`;
        seen.add(target.path);
        resolved.push({ path: target.path, content });
      }
      try {
        for (const file of resolved) {
          mkdirSync(dirname(file.path), { recursive: true });
          writeFileSync(file.path, file.content, "utf8");
        }
        return `OK (${resolved.length} files)`;
      } catch (error) {
        return `Error writing files: ${(error as Error).message}`;
      }
    },
  };
}
