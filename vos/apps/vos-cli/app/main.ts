#!/usr/bin/env bun

import path from "node:path";
import { readFileSync } from "node:fs";
import type { PolicySnapshot, PortalUserSummary } from "vos-core";
import {
  COMMAND_VERSION,
  executeCliInvocation,
  parseArgs,
  printCliError,
  printHelp,
  runProgressMcpServer,
} from "vos-core";
import { runDemoCli } from "vos-demo";
import { startVosHttpServer } from "vos-server";

async function main(): Promise<void> {
  try {
    if (process.argv.slice(2).includes("--version")) {
      console.log(COMMAND_VERSION);
      return;
    }
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
      const accessToken = process.env.VOS_SERVE_ACCESS_TOKEN;
      const runnerIdentity = loadRunnerIdentity(process.env.VOS_RUNNER_IDENTITY_FILE);
      delete process.env.VOS_SERVE_ACCESS_TOKEN;
      delete process.env.VOS_RUNNER_IDENTITY_FILE;
      const server = startVosHttpServer({
        projectRoot: path.resolve(parsed.global.projectRoot),
        portalUrl: parsed.command.portalUrl,
        projectId: parsed.command.projectId,
        host: parsed.command.host,
        port: parsed.command.port,
        accessToken,
        runnerIdentity,
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

function loadRunnerIdentity(file: string | undefined): { user: PortalUserSummary; policy: PolicySnapshot } | undefined {
  if (!file) return undefined;
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { user?: PortalUserSummary; policy?: PolicySnapshot };
  if (!parsed.user?.id || !parsed.policy?.ref || !parsed.policy.projectId || !parsed.policy.expiresAt) {
    throw new Error("VOS_RUNNER_IDENTITY_FILE does not contain a valid runner identity and policy snapshot");
  }
  return { user: parsed.user, policy: parsed.policy };
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
