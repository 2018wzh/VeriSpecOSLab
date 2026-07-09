#!/usr/bin/env bun

import path from "node:path";
import {
  COMMAND_VERSION,
  executeCliInvocation,
  parseArgs,
  performSelfUpdate,
  maybeCheckForUpdate,
  printCliError,
  printHelp,
  runProgressMcpServer,
  type UpdateChannel,
} from "vos-core";
import { runDemoCli } from "vos-demo";
import { startVosHttpServer } from "vos-server";

async function main(): Promise<void> {
  try {
    const updateInvocation = parseUpdateInvocation(process.argv.slice(2));
    if (updateInvocation.kind === "help") {
      process.exitCode = printHelp("update") ? 0 : 1;
      return;
    }
    if (updateInvocation.kind === "update") {
      const result = await performSelfUpdate(COMMAND_VERSION, updateInvocation.channel);
      if (result.available && result.latestVersion) {
        console.log(`vos: updated to ${result.latestVersion} (${updateInvocation.channel})`);
      } else {
        console.log(`vos: already up to date (${COMMAND_VERSION})`);
      }
      return;
    }
    if (process.argv.slice(2).includes("--version")) {
      console.log(COMMAND_VERSION);
      return;
    }
    void maybeCheckForUpdate(COMMAND_VERSION);
    if (process.argv[2] === "internal" && process.argv[3] === "progress-mcp") {
      await runProgressMcpServer();
      return;
    }
    if (isDemoInvocation(process.argv)) {
      await runDemoCli(process.argv);
      return;
    }

    const parsed = parseArgs(process.argv);
    if (parsed.command.kind === "help") {
      process.exitCode = printHelp(parsed.command.topic) ? 0 : 1;
      return;
    }
    if (parsed.command.kind === "serve") {
      const server = startVosHttpServer({
        projectRoot: path.resolve(parsed.global.projectRoot),
        portalUrl: parsed.command.portalUrl,
        projectId: parsed.command.projectId,
        host: parsed.command.host,
        port: parsed.command.port,
      });
      console.log(`vos serve listening on ${server.url}`);
      await waitForStop(server.server);
      return;
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort);
    process.once("SIGTERM", abort);
    const result = await executeCliInvocation(process.argv, {
      print: true,
      signal: controller.signal,
    });
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    printCliError(error, process.argv);
    process.exitCode = 1;
  }
}

function parseUpdateInvocation(args: string[]): { kind: "help" } | { kind: "update"; channel: UpdateChannel } | { kind: "none" } {
  if (args[0] !== "update" && args[0] !== "self-update") {
    return { kind: "none" };
  }

  let channel: UpdateChannel = "stable";
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }
    if (arg === "--channel") {
      const value = args[++i];
      if (value === "nightly" || value === "stable") {
        channel = value;
        continue;
      }
      throw new Error("--channel must be stable or nightly");
    }
    if (arg.startsWith("--channel=")) {
      const value = arg.slice("--channel=".length);
      if (value === "nightly" || value === "stable") {
        channel = value;
        continue;
      }
      throw new Error("--channel must be stable or nightly");
    }
    throw new Error(`unknown option for ${args[0]}: ${arg}`);
  }

  return { kind: "update", channel };
}

function waitForStop(server: Bun.Server<undefined>): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      server.stop(true);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export { executeCliInvocation, parseArgs, printCliError, printHelp };
export { executeCommand } from "vos-core";
export { startAgentServer } from "vos-core";
export type { CommandOutcome, ExecContext, ExecuteCliOptions } from "vos-core";

export function isDemoInvocation(argv: string[]): boolean {
  const tokens = argv.slice(2);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--project-root" || token === "--progress" || token === "--agent-session" || token === "--report" || token === "--evidence-dir") {
      i++;
      continue;
    }
    if (token.startsWith("--project-root=") || token.startsWith("--progress=")) {
      continue;
    }
    if (token === "--json" || token === "-v" || token === "--verbose") {
      continue;
    }
    return token === "demo";
  }
  return false;
}

if (import.meta.main) {
  main();
}
