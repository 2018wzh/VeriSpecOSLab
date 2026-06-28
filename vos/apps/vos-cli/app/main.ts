#!/usr/bin/env bun

import path from "node:path";
import {
  executeCliInvocation,
  parseArgs,
  printCliError,
  printHelp,
  runProgressMcpServer,
} from "vos-core";
import { startVosHttpServer } from "vos-server";

async function main(): Promise<void> {
  try {
    if (process.argv[2] === "internal" && process.argv[3] === "progress-mcp") {
      await runProgressMcpServer();
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

if (import.meta.main) {
  main();
}
