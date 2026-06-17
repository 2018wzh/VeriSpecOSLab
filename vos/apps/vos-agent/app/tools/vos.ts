import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

export interface VosToolOptions {
  rootDir?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowedCommands?: readonly string[];
}

const BLOCKED_COMMANDS = new Set(["serve", "dev", "start", "tui"]);

export function createVosTool(opts: VosToolOptions = {}): Tool {
  const rootDir = resolve(opts.rootDir ?? process.cwd());
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  const allowedCommands = opts.allowedCommands?.map((command) => command.trim());

  return {
    name: "Vos",
    schema: {
      type: "function",
      function: {
        name: "Vos",
        description:
          "Run a bounded VOS TypeScript workspace command and return stdout+stderr. Use this for agent tests/typechecks/builds, web lint/build, and portal route inspection. Do not use it for interactive dev servers.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The VOS command to run, e.g. `agent test`, `agent typecheck`, `web lint`, `web build`, or `portal routes`. Leading `vos` is optional.",
            },
          },
          required: ["command"],
        },
      },
    },
    execute(argumentsJson: string): string {
      const parsed = parseToolArguments("Vos", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const command = requireStringArgument("Vos", parsed.args, "command", {
        trimForEmptyCheck: true,
      });
      if (!command.ok) return command.error;

      const argv = normalizeVosCommand(command.value);
      if (!argv.ok) return argv.error;

      const vosWorkspace = findVosWorkspace(rootDir);
      const commandPlan = resolveWorkspaceCommand(argv.args, rootDir, vosWorkspace, allowedCommands);
      if (!commandPlan.ok) return commandPlan.error;
      if (commandPlan.kind === "text") return commandPlan.output;

      const result = spawnSync(
        commandPlan.command,
        commandPlan.args,
        {
          cwd: commandPlan.cwd,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: maxOutputBytes + 1024,
        },
      );

      const output = truncateUtf8(
        (result.stdout ?? "") + (result.stderr ?? ""),
        maxOutputBytes,
      );
      const diagnostics = commandDiagnostics(result, timeoutMs);
      return diagnostics.length === 0
        ? output
        : appendDiagnostic(output, diagnostics.map((d) => `[${d}]`).join("\n"));
    },
  };
}

type CommandPlan =
  | { ok: true; kind: "text"; output: string }
  | { ok: true; kind: "spawn"; command: string; args: string[]; cwd: string }
  | { ok: false; error: string };

function resolveWorkspaceCommand(
  args: string[],
  rootDir: string,
  vosWorkspace: string | undefined,
  allowedCommands?: readonly string[],
): CommandPlan {
  const [area, action] = args;
  if (area === "help") {
    return { ok: true, kind: "text", output: helpText() };
  }
  if (allowedCommands && !isAllowedCoursedCommand(args, allowedCommands)) {
    return {
      ok: false,
      error:
        "Error validating Vos arguments: command is blocked by current agent policy",
    };
  }
  if (area === "portal" && action === "routes") {
    return { ok: true, kind: "text", output: portalRoutesText() };
  }
  if (isCourseAllowedIntent(args, allowedCommands)) {
    const cwd = resolveCommandCwd(args, rootDir);
    return resolveCliCommand(args, cwd, vosWorkspace);
  }
  if (area === "agent") {
    if (!action) return { ok: false, error: "Error validating Vos arguments: agent command must include test, typecheck, or build" };
    if (BLOCKED_COMMANDS.has(action)) {
      return { ok: false, error: `Error running VOS command: interactive command \`agent ${action}\` is not allowed` };
    }
    if (!vosWorkspace) {
      return { ok: false, error: `Error running VOS command: could not find VOS TypeScript workspace from ${rootDirHint(args)}` };
    }
    if (action === "test" || action === "typecheck" || action === "build") {
      return {
        ok: true,
        kind: "spawn",
        command: "bun",
        args: ["run", action],
        cwd: join(vosWorkspace, "apps", "vos-agent"),
      };
    }
  }
  if (area === "web") {
    if (!action) return { ok: false, error: "Error validating Vos arguments: web command must include lint or build" };
    if (BLOCKED_COMMANDS.has(action)) {
      return { ok: false, error: `Error running VOS command: interactive command \`web ${action}\` is not allowed` };
    }
    if (!vosWorkspace) {
      return { ok: false, error: `Error running VOS command: could not find VOS TypeScript workspace from ${rootDirHint(args)}` };
    }
    if (action === "lint" || action === "build") {
      return {
        ok: true,
        kind: "spawn",
        command: "npm",
        args: ["run", action],
        cwd: join(vosWorkspace, "apps", "vos-web"),
      };
    }
  }
  return {
    ok: false,
    error: `Error validating Vos arguments: unsupported command \`${args.join(" ")}\`. Try \`help\`.`,
  };
}

function isCourseAllowedIntent(
  args: string[],
  allowedCommands?: readonly string[],
): boolean {
  if (!allowedCommands || allowedCommands.length === 0) return false;
  const normalizedIntent = matchCommandIntent(args);
  return normalizeAllowedCommand(normalizedIntent) !== "" &&
    allowedCommandIntents(allowedCommands).has(normalizedIntent);
}

function resolveCliCommand(
  args: string[],
  cwd: string,
  vosWorkspace: string | undefined,
): CommandPlan {
  const cliScript = vosWorkspace
    ? join(vosWorkspace, "apps", "vos-cli", "app", "main.ts")
    : "vos";
  if (cliScript === "vos") {
    return {
      ok: true,
      kind: "spawn",
      command: "vos",
      args,
      cwd,
    };
  }
  return {
    ok: true,
    kind: "spawn",
    command: "bun",
    args: ["run", cliScript, ...args],
    cwd,
  };
}

function resolveCommandCwd(args: string[], rootDir: string): string {
  if (!Array.isArray(args)) return rootDir;
  for (const arg of args) {
    if (arg === "--project-root" || arg.startsWith("--project-root=")) {
      if (arg.includes("=")) {
        return arg.slice(arg.indexOf("=") + 1);
      }
      const nextIndex = args.indexOf(arg) + 1;
      if (nextIndex < args.length) {
        return args[nextIndex];
      }
    }
  }
  return rootDir;
}

function isAllowedCoursedCommand(
  args: string[],
  allowedCommands?: readonly string[],
): boolean {
  if (!allowedCommands || allowedCommands.length === 0) {
    return true;
  }
  const allowed = new Set(
    Array.from(allowedCommandIntents(allowedCommands)),
  );
  return allowed.has(matchCommandIntent(args));
}

function matchCommandIntent(args: string[]): string {
  if (args.length === 0) return "";
  if (args[0] === "spec" && args[1] === "lint") return "spec lint";
  if (args[0] === "arch" && args[1] === "lint") return "arch lint";
  if (args[0] === "build") return "build";
  if (args[0] === "run" && args[1] === "qemu") return "run qemu";
  if (args[0] === "verify" && args[1] === "public") return "verify public";
  return args.join(" ");
}

function normalizeAllowedCommand(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function allowedCommandIntents(commands: readonly string[]): Set<string> {
  return new Set(commands.map((command) => {
    const normalized = normalizeVosCommand(command);
    return normalized.ok ? matchCommandIntent(normalized.args) : "";
  }).filter(Boolean));
}

function normalizeVosCommand(command: string):
  | { ok: true; args: string[] }
  | { ok: false; error: string } {
  const args = splitShellLike(command.trim());
  if (args.length === 0) {
    return { ok: false, error: "Error validating Vos arguments: command must be non-empty" };
  }
  const normalized = args[0] === "vos" ? args.slice(1) : args;
  if (normalized.length === 0) {
    return { ok: false, error: "Error validating Vos arguments: command must include a subcommand" };
  }
  if (normalized[0] === "tui") {
    return {
      ok: false,
      error: "Error running VOS command: interactive command `vos tui` is not allowed",
    };
  }
  return { ok: true, args: normalized };
}

function splitShellLike(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current.length > 0) args.push(current);
  return args;
}

function findVosWorkspace(rootDir: string): string | undefined {
  let current = resolve(rootDir);
  while (true) {
    if (isVosTypescriptWorkspace(join(current, "vos"))) {
      return join(current, "vos");
    }
    if (isVosTypescriptWorkspace(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function isVosTypescriptWorkspace(dir: string): boolean {
  return existsSync(join(dir, "apps", "vos-agent", "package.json")) &&
    existsSync(join(dir, "apps", "vos-web", "package.json"));
}

function helpText(): string {
  return [
    "VOS TypeScript workspace commands:",
    "  agent test        Run vos-agent Bun tests",
    "  agent typecheck   Typecheck vos-agent",
    "  agent build       Build the vos-agent binary",
    "  web lint          Typecheck vos-web",
    "  web build         Build vos-web",
    "  portal routes     List TS portal/API routes served by vos-agent",
  ].join("\n");
}

function portalRoutesText(): string {
  return [
    "VOS portal routes served by vos-agent:",
    "  GET  /health",
    "  GET  /v1/models",
    "  POST /v1/chat/completions",
    "  POST /api/v1/auth/login",
    "  GET  /api/v1/auth/me",
    "  GET  /api/v1/users",
    "  GET/POST /api/v1/courses",
    "  GET/POST /api/v1/experiments",
    "  GET/POST /api/v1/experiments/:id/stage-gates",
    "  GET/POST /api/v1/projects",
    "  GET  /api/v1/projects/:id/progress",
    "  GET  /api/v1/projects/:id/evidence",
    "  GET  /api/v1/projects/:id/scores",
    "  GET  /api/v1/projects/:id/agent-audit",
    "  GET/POST /api/v1/rubrics",
    "  GET  /api/v1/design-submissions",
    "  PATCH /api/v1/design-submissions/:id",
    "  GET  /api/v1/teacher/experiments/:id/students",
    "  POST /api/v1/teacher/projects/:id/grade",
  ].join("\n");
}

function rootDirHint(args: string[]): string {
  return args.length ? `command \`${args.join(" ")}\`` : "current directory";
}

function commandDiagnostics(
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
