import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import type { Tool } from "./types.ts";
import {
  appendDiagnostic,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  formatError,
  parseToolArguments,
  requireStringArgument,
  truncateUtf8,
} from "./common.ts";

export interface BashOptions {
  /** Per-command timeout, milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Working directory for the command. Defaults to process.cwd() at execution time. */
  cwd?: string;
  /** Maximum UTF-8 bytes returned to the model. Defaults to 200 KB. */
  maxOutputBytes?: number;
}

export function createBashTool(opts: BashOptions = {}): Tool {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const cwd = opts.cwd;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  return {
    name: "Bash",
    schema: {
      type: "function",
      function: {
        name: "Bash",
        description:
          "Execute a shell command in the workspace and return combined stdout+stderr. Exits non-zero are returned as text (no throw).",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to execute",
            },
          },
          required: ["command"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Bash", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const command = requireStringArgument("Bash", parsed.args, "command", {
        trimForEmptyCheck: true,
      });
      if (!command.ok) return command.error;

      const result = spawnSync("sh", ["-c", command.value], {
        cwd: cwd ?? process.cwd(),
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: maxOutputBytes + 1024,
      });

      const output = truncateUtf8(
        (result.stdout ?? "") + (result.stderr ?? ""),
        maxOutputBytes,
      );
      const diagnostics = bashDiagnostics(result, timeoutMs);
      if (diagnostics.length === 0) {
        return output;
      }

      return appendDiagnostic(
        output,
        diagnostics.map((d) => `[${d}]`).join("\n"),
      );
    },
  };
}

export const bashTool: Tool = createBashTool();

function bashDiagnostics(
  result: SpawnSyncReturns<string>,
  timeoutMs: number,
): string[] {
  const diagnostics: string[] = [];
  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;

  if (errorCode === "ETIMEDOUT") {
    diagnostics.push(`Command timed out after ${timeoutMs}ms`);
  } else if (result.error) {
    diagnostics.push(`Error executing command: ${formatError(result.error)}`);
  }

  if (typeof result.status === "number" && result.status !== 0) {
    diagnostics.push(`Command exited with status ${result.status}`);
  }

  if (result.signal) {
    diagnostics.push(`Command terminated by signal ${result.signal}`);
  }

  return diagnostics;
}
