#!/usr/bin/env bun
import { parseArgs } from "./cli.ts";
import { loadConfig } from "./config.ts";
import { resolveActiveModelSettings, shouldUseStoredThreadModel } from "./resolve-model.ts";
import { createChatClientFromConfig } from "./llm/providers.ts";
import { createThreadStore } from "./session/thread-store.ts";
import { runSessionTurn } from "./session/run-turn.ts";
import { loadSettings } from "./settings.ts";
import {
  StreamJsonEncoder,
  createStreamJsonErrorEvent,
  formatStreamJsonEvent,
  type StreamJsonOutputEvent,
} from "./output/stream-json.ts";
import {
  StreamJsonInputError,
  runStreamJsonInputSession,
} from "./session/stream-json-input.ts";
import { discoverWorkspaceRoot } from "./workspace.ts";
import { runInteractive } from "./terminal/repl.ts";
import { serveAgentHttp } from "./server/http.ts";
import { runHttpServerMcpServer } from "./mcp/http-server.ts";
import { runQemuMonitorMcpServer } from "./mcp/qemu-monitor-server.ts";
import { runProjectContextMcpServer } from "./mcp/project-context-server.ts";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  if (process.argv[2] === "internal" && process.argv[3] === "qemu-monitor-mcp") {
    await runQemuMonitorMcpServer();
    return;
  }
  if (process.argv[2] === "internal" && process.argv[3] === "project-context-mcp") {
    await runProjectContextMcpServer();
    return;
  }
  if (process.argv[2] === "internal" && process.argv[3] === "http-server-mcp") {
    await runHttpServerMcpServer();
    return;
  }

  const args = parseArgs(process.argv);
  const workspaceRoot = discoverWorkspaceRoot();
  const store = createThreadStore({ workspaceRoot });

  if (args.kind === "help") {
    console.log(helpText());
    return;
  }
  if (args.kind === "version") {
    console.log(VERSION);
    return;
  }
  if (args.kind === "threads-list") {
    console.log(JSON.stringify(store.list({ archived: args.archived }), null, 2));
    return;
  }
  if (args.kind === "threads-archive") {
    const thread = store.archive(args.threadId);
    console.log(JSON.stringify({
      id: thread.id,
      archivedAt: thread.archivedAt,
      path: store.pathFor(thread.id),
    }, null, 2));
    return;
  }
  if (args.kind === "threads-fork") {
    const fork = store.fork(args.threadId);
    console.log(JSON.stringify({
      id: fork.id,
      sourceId: args.threadId,
      path: store.pathFor(fork.id),
    }, null, 2));
    return;
  }

  const settings = loadSettings({ workspaceRoot });
  const config = loadConfig(process.env, settings);
  const chat = createChatClientFromConfig(config);

  if (args.kind === "serve") {
    const host = args.host ?? process.env.VOS_AGENT_HOST ?? "127.0.0.1";
    const port = args.port ?? readPortEnv(process.env.VOS_AGENT_PORT) ?? 8787;
    const server = serveAgentHttp({ chat, config, store, workspaceRoot, host, port });
    console.error(`vos-agent: listening on http://${server.hostname}:${server.port}`);
    return;
  }

  const stdinText = args.kind === "execute" && args.streamJsonInput
    ? await readStreamJsonInputStdin()
    : await readStdinIfPiped();

  if (args.kind === "interactive" && stdinText === undefined) {
    await runInteractive({
      chat,
      config,
      store,
      workspaceRoot,
      startDir: process.cwd(),
      mode: args.mode,
      model: args.model,
      threadId: args.threadId,
    });
    return;
  }

  const prompt = composePrompt(
    args.kind === "execute" ? args.prompt : undefined,
    stdinText,
  );
  if (args.kind === "execute" && args.streamJsonInput) {
    const modelSettings = shouldUseStoredThreadModel(args)
      ? undefined
      : resolveActiveModelSettings(config, args);
    const encoder = new StreamJsonEncoder({
      cwd: process.cwd(),
      emitFinalResult: false,
    });
    try {
      const result = await runStreamJsonInputSession({
        chat,
        store,
        workspaceRoot,
        startDir: process.cwd(),
        threadId: args.threadId,
        input: stdinText ?? "",
        model: modelSettings?.model,
        reasoningEffort: modelSettings?.reasoningEffort,
        mode: modelSettings?.mode,
        disabledTools: config.tools.disabled,
        permissionRules: config.tools.permissions,
        onTurnStart: (turnPrompt) => {
          encoder.beginTurn(turnPrompt);
        },
        onEvent: (event) => {
          writeStreamJsonEvents(encoder.encode(event));
        },
      });
      process.stdout.write(formatStreamJsonEvent(encoder.successEvent(result.content)));
    } catch (e) {
      process.stdout.write(formatStreamJsonEvent(encoder.errorEvent(e, streamJsonErrorOptions(e))));
      process.exitCode = 1;
    }
    return;
  }

  if (!prompt) {
    throw new Error("no prompt provided: pass -p/--prompt, -x/--execute, or pipe stdin");
  }

  const modelSettings = shouldUseStoredThreadModel(args)
    ? undefined
    : resolveActiveModelSettings(config, args);
  const streamJson = args.kind === "execute" ? args.streamJson : false;
  const encoder = streamJson ? new StreamJsonEncoder({ cwd: process.cwd() }) : undefined;
  encoder?.beginTurn(prompt);
  let result;
  try {
    result = await runSessionTurn({
      chat,
      store,
      workspaceRoot,
      startDir: process.cwd(),
      threadId: args.threadId,
      prompt,
      model: modelSettings?.model,
      reasoningEffort: modelSettings?.reasoningEffort,
      mode: modelSettings?.mode,
      disabledTools: config.tools.disabled,
      permissionRules: config.tools.permissions,
      onEvent: encoder
        ? (event) => {
            writeStreamJsonEvents(encoder.encode(event));
          }
        : undefined,
    });
  } catch (e) {
    if (encoder) {
      process.stdout.write(formatStreamJsonEvent(encoder.errorEvent(e, streamJsonErrorOptions(e))));
      process.exitCode = 1;
      return;
    }
    throw e;
  }

  if (!streamJson) {
    console.error(`thread: ${result.thread.id}`);
    if (result.content !== null) {
      console.log(result.content);
      return;
    }
    throw new Error("final assistant response did not contain text");
  }
}

function helpText(): string {
  return [
    "VOS Agent — TypeScript coding-agent backend",
    "",
    "Usage:",
    "  vos-agent                         Start interactive mode",
    "  vos-agent -p <prompt>             Execute one prompt and exit",
    "  vos-agent -x <prompt>             Execute one prompt and exit",
    "  vos-agent exec -p <prompt>        Execute one prompt and exit",
    "  vos-agent serve --port 8787       Start OpenAI-compatible HTTP gateway",
    "  echo <prompt> | vos-agent         Execute stdin as a prompt",
    "  vos-agent --stream-json --stream-json-input < input.jsonl",
    "  vos-agent threads list            List local saved threads",
    "  vos-agent threads continue <id>   Resume a local thread interactively",
    "  vos-agent threads archive <id>    Archive a local thread",
    "  vos-agent threads fork <id>       Copy a local thread transcript",
    "",
    "Options:",
    "  -m, --mode <smart|deep|rush>  Select mode",
    "  --model <id>                  Pin raw model id",
    "  --thread <id>                 Continue a local thread",
    "  --stream-json                 Emit JSONL events in execute mode",
    "  --stream-json-input           Read JSONL user messages from stdin",
    "  threads list --archived       List archived local threads",
    "  threads list --all            List active and archived local threads",
    "  -h, --help                    Show this help",
    "  -v, --version                 Show version",
  ].join("\n");
}

function readPortEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("VOS_AGENT_PORT must be a TCP port from 1 to 65535");
  }
  return parsed;
}

async function readStreamJsonInputStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await Bun.stdin.text();
}

async function readStdinIfPiped(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const text = await Bun.stdin.text();
  return text.trim().length > 0 ? text : undefined;
}

function composePrompt(
  prompt: string | undefined,
  stdinText: string | undefined,
): string | undefined {
  if (prompt && stdinText) return `${prompt}\n\n${stdinText}`;
  return prompt ?? stdinText;
}

function writeStreamJsonEvents(events: readonly StreamJsonOutputEvent[]): void {
  for (const event of events) {
    process.stdout.write(formatStreamJsonEvent(event));
  }
}

function streamJsonErrorOptions(err: unknown): {
  errorCode: "malformed_stream_json_input" | "agent_error" | "max_turns";
  line?: number;
} {
  if (err instanceof StreamJsonInputError) {
    return { errorCode: err.code, line: err.line };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("max iterations")) {
    return { errorCode: "max_turns" };
  }
  return { errorCode: "agent_error" };
}

function shouldEmitStreamJsonError(argv: string[]): boolean {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--prompt" || arg === "-x" || arg === "--execute") {
      i++;
      continue;
    }
    if (arg.startsWith("--prompt=") || arg.startsWith("--execute=")) {
      continue;
    }
    if (arg === "--stream-json") {
      return true;
    }
  }
  return false;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (shouldEmitStreamJsonError(process.argv)) {
    process.stdout.write(formatStreamJsonEvent(createStreamJsonErrorEvent(err, {
      errorCode: "agent_error",
    })));
    process.exit(1);
  }
  console.error(`vos-agent: ${message}`);
  process.exit(1);
});
