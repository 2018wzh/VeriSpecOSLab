export type ParsedArgs =
  | {
      kind: "interactive";
      mode?: string;
      model?: string;
      threadId?: string;
    }
  | {
      kind: "execute";
      prompt?: string;
      mode?: string;
      model?: string;
      threadId?: string;
      streamJson: boolean;
      streamJsonInput: boolean;
    }
  | { kind: "threads-list"; archived: "active" | "archived" | "all" }
  | { kind: "threads-archive"; threadId: string }
  | { kind: "threads-fork"; threadId: string }
  | { kind: "serve"; host?: string; port?: number }
  | { kind: "help" }
  | { kind: "version" };

const VALUE_FLAGS = new Set([
  "-p",
  "--prompt",
  "-m",
  "--mode",
  "--model",
  "--thread",
  "--host",
  "--port",
  "-x",
  "--execute",
]);

/**
 * Parse the VOS agent CLI invocation.
 *
 * Supported shapes:
 *   vos-agent                         interactive mode
 *   vos-agent -p "<prompt>"           execute mode
 *   vos-agent exec -p "<prompt>"      execute mode
 *   vos-agent serve --port 8787       HTTP gateway mode
 *   vos-agent --execute "<prompt>"    execute mode
 *   vos-agent threads list            list saved local threads
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0) {
    return interactiveResult();
  }

  if (args[0] === "threads") {
    return parseThreadsCommand(args);
  }
  if (args[0] === "serve") {
    return parseServeCommand(args);
  }

  let explicitExecute = false;
  let prompt: string | undefined;
  let mode: string | undefined;
  let model: string | undefined;
  let threadId: string | undefined;
  let streamJson = false;
  let streamJsonInput = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];

    if (a === "exec" || a === "run" || a === "ask") {
      explicitExecute = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      return assertOnlyStandaloneFlag(args, i, a, { kind: "help" });
    }
    if (a === "--version" || a === "-v") {
      return assertOnlyStandaloneFlag(args, i, a, { kind: "version" });
    }
    if (a === "--list-threads") {
      return assertOnlyFlag(args, i, { kind: "threads-list", archived: "active" });
    }
    if (a === "--stream-json") {
      streamJson = true;
      continue;
    }
    if (a === "--stream-json-input") {
      streamJsonInput = true;
      explicitExecute = true;
      continue;
    }

    const long = readLongAssignment(a);
    if (long) {
      const { flag, value } = long;
      if (flag === "--prompt") {
        prompt = requireNonEmptyValue(flag, value);
        explicitExecute = true;
        continue;
      }
      if (flag === "--execute") {
        prompt = requireNonEmptyValue(flag, value);
        explicitExecute = true;
        continue;
      }
      if (flag === "--mode") {
        mode = requireNonEmptyValue(flag, value);
        continue;
      }
      if (flag === "--model") {
        model = requireNonEmptyValue(flag, value);
        continue;
      }
      if (flag === "--thread") {
        threadId = requireNonEmptyValue(flag, value);
        continue;
      }
    }

    if (a === "-p" || a === "--prompt") {
      prompt = readRequiredValue(args, i, a, { allowLeadingDash: true });
      explicitExecute = true;
      i++;
      continue;
    }
    if (a === "-x" || a === "--execute") {
      explicitExecute = true;
      const next = args[i + 1];
      if (next !== undefined && !looksLikeFlag(next)) {
        prompt = requireNonEmptyValue(a, next);
        i++;
      }
      continue;
    }
    if (a === "-m" || a === "--mode") {
      mode = readRequiredValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--model") {
      model = readRequiredValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--thread") {
      threadId = readRequiredValue(args, i, a);
      i++;
      continue;
    }

    throw new Error(`unknown argument: ${a}`);
  }

  if (streamJson && !explicitExecute) {
    throw new Error("--stream-json requires execute mode");
  }
  if (streamJsonInput && !streamJson) {
    throw new Error("--stream-json-input requires --stream-json");
  }
  if (streamJsonInput && prompt !== undefined) {
    throw new Error("--stream-json-input cannot be combined with -p/--prompt");
  }

  if (explicitExecute) {
    return { kind: "execute", prompt, mode, model, threadId, streamJson, streamJsonInput };
  }

  return { kind: "interactive", mode, model, threadId };
}

function parseServeCommand(args: string[]): ParsedArgs {
  let host: string | undefined;
  let port: number | undefined;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    const long = readLongAssignment(a);
    if (long) {
      if (long.flag === "--host") {
        host = requireNonEmptyValue(long.flag, long.value);
        continue;
      }
      if (long.flag === "--port") {
        port = parsePort(long.value, long.flag);
        continue;
      }
    }
    if (a === "--host") {
      host = readRequiredValue(args, i, a);
      i++;
      continue;
    }
    if (a === "--port") {
      port = parsePort(readRequiredValue(args, i, a), a);
      i++;
      continue;
    }
    throw new Error(`unknown serve argument: ${a}`);
  }

  return { kind: "serve", host, port };
}

function parseThreadsCommand(args: string[]): ParsedArgs {
  const command = args[1];
  if (command === "list") {
    return parseThreadsListCommand(args);
  }
  if (command === "continue") {
    const threadId = readThreadCommandId(args, command);
    return { kind: "interactive", mode: undefined, model: undefined, threadId };
  }
  if (command === "archive") {
    return { kind: "threads-archive", threadId: readThreadCommandId(args, command) };
  }
  if (command === "fork") {
    return { kind: "threads-fork", threadId: readThreadCommandId(args, command) };
  }
  throw new Error(`unknown threads command: ${args.slice(1).join(" ")}`);
}

function parseThreadsListCommand(args: string[]): ParsedArgs {
  let archived: "active" | "archived" | "all" = "active";
  for (const flag of args.slice(2)) {
    if (flag === "--archived") {
      if (archived !== "active") {
        throw new Error("threads list filters cannot be combined");
      }
      archived = "archived";
      continue;
    }
    if (flag === "--all") {
      if (archived !== "active") {
        throw new Error("threads list filters cannot be combined");
      }
      archived = "all";
      continue;
    }
    throw new Error("threads list cannot be combined with other flags");
  }
  return { kind: "threads-list", archived };
}

function readThreadCommandId(args: string[], command: string): string {
  const id = args[2];
  if (id === undefined) {
    throw new Error(`threads ${command} requires a thread id`);
  }
  if (id.length === 0) {
    throw new Error(`threads ${command} requires a non-empty thread id`);
  }
  if (args.length !== 3) {
    throw new Error(`threads ${command} cannot be combined with other flags`);
  }
  return id;
}

function interactiveResult(): ParsedArgs {
  return {
    kind: "interactive",
    mode: undefined,
    model: undefined,
    threadId: undefined,
  };
}

function assertOnlyFlag<T extends ParsedArgs>(
  args: string[],
  index: number,
  result: T,
): T {
  if (args.length !== 1 || index !== 0) {
    throw new Error("threads list cannot be combined with other flags");
  }
  return result;
}

function assertOnlyStandaloneFlag<T extends ParsedArgs>(
  args: string[],
  index: number,
  flag: string,
  result: T,
): T {
  if (args.length !== 1 || index !== 0) {
    throw new Error(`${flag} cannot be combined with other flags`);
  }
  return result;
}

function readRequiredValue(
  args: string[],
  index: number,
  flag: string,
  opts: { allowLeadingDash?: boolean } = {},
): string {
  const value = args[index + 1];
  if (value === undefined || (!opts.allowLeadingDash && looksLikeFlag(value))) {
    throw new Error(`error: ${flag} requires a value`);
  }
  return requireNonEmptyValue(flag, value);
}

function requireNonEmptyValue(flag: string, value: string): string {
  if (value.length === 0) {
    throw new Error(`error: ${flag} requires a non-empty value`);
  }
  return value;
}

function parsePort(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`error: ${flag} requires a TCP port from 1 to 65535`);
  }
  return parsed;
}

function readLongAssignment(arg: string): { flag: string; value: string } | undefined {
  const equals = arg.indexOf("=");
  if (!arg.startsWith("--") || equals === -1) return undefined;
  return { flag: arg.slice(0, equals), value: arg.slice(equals + 1) };
}

function looksLikeFlag(arg: string): boolean {
  return arg.startsWith("-") || VALUE_FLAGS.has(arg);
}
