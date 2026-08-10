import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shellInvocation, toPosixPath } from "vos-platform";
import { runStructuredStudentCommand } from "vos-runtime";
import type { Tool } from "./types.ts";
import {
  appendDiagnostic,
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
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

const BASH_PROCESS_GROUP_WRAPPER = [
  "set -m",
  'bash --noprofile --norc -c "$1" &',
  "command_pid=$!",
  "set +m",
  'printf "%s\\n" "$command_pid" > "$2"',
  'wait "$command_pid"',
].join("\n");
const BASH_PROCESS_GROUP_KILL = [
  'kill -TERM -- "-$1" 2>/dev/null || kill -TERM "$1" 2>/dev/null || true',
  "sleep 1",
  'kill -KILL -- "-$1" 2>/dev/null || kill -KILL "$1" 2>/dev/null || true',
].join("\n");

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
          "Execute a GNU Bash command in the workspace and return combined stdout+stderr. Use POSIX shell syntax on every host. Exits non-zero are returned as text (no throw).",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The GNU Bash command to execute using POSIX shell syntax",
            },
          },
          required: ["command"],
        },
      },
    },
    async execute(argumentsJson: string, context): Promise<string> {
      const parsed = parseToolArguments("Bash", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const command = requireStringArgument("Bash", parsed.args, "command", {
        trimForEmptyCheck: true,
      });
      if (!command.ok) return command.error;

      const shell = shellInvocation(command.value);
      const controlRoot = mkdtempSync(join(tmpdir(), "vos-agent-bash-"));
      const pidFile = join(controlRoot, "process-group.pid");
      let timedOut = false;
      let timeoutKill: Promise<void> | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        timeoutKill = terminateBashProcessGroup(shell.executable, pidFile);
      }, timeoutMs);
      let result: Awaited<ReturnType<typeof runStructuredStudentCommand>>;
      try {
        result = await runStructuredStudentCommand(cwd ?? process.cwd(), {
          program: shell.executable,
          args: [
            "--noprofile",
            "--norc",
            "-c",
            BASH_PROCESS_GROUP_WRAPPER,
            "vos-agent-bash",
            command.value,
            toPosixPath(pidFile),
          ],
          cwd: ".",
          env: Object.keys(process.env),
          timeout: timeoutMs + 5_000,
        }, context?.signal);
        if (timeoutKill) await timeoutKill;
      } finally {
        clearTimeout(timer);
        rmSync(controlRoot, { recursive: true, force: true });
      }

      timedOut ||= result.status === "timed_out";
      const output = truncateUtf8(result.stdout + result.stderr, maxOutputBytes);
      const diagnostics = bashDiagnostics(result, timeoutMs, timedOut);
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

async function terminateBashProcessGroup(shellExecutable: string, pidFile: string): Promise<void> {
  let processGroup = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      processGroup = readFileSync(pidFile, "utf8").trim();
    } catch {
      // The shell may still be starting; the outer runtime timeout remains a fallback.
    }
    if (/^[1-9][0-9]*$/.test(processGroup)) break;
    await Bun.sleep(10);
  }
  if (!/^[1-9][0-9]*$/.test(processGroup)) return;
  const killer = Bun.spawn([
    shellExecutable,
    "--noprofile",
    "--norc",
    "-c",
    BASH_PROCESS_GROUP_KILL,
    "vos-agent-bash-kill",
    processGroup,
  ], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await killer.exited;
}

export const bashTool: Tool = createBashTool();

function bashDiagnostics(
  result: Awaited<ReturnType<typeof runStructuredStudentCommand>>,
  timeoutMs: number,
  timedOut: boolean,
): string[] {
  const diagnostics: string[] = [];

  if (timedOut) {
    diagnostics.push(`Command timed out after ${timeoutMs}ms`);
  }

  if (result.status === "failed" && result.exitCode !== 0 && !timedOut) {
    diagnostics.push(`Command exited with status ${result.exitCode}`);
  }

  return diagnostics;
}
