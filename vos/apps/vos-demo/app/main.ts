#!/usr/bin/env bun

import path from "node:path";
import { createDemoHandler } from "./server.ts";

export interface DemoCliOptions {
  projectRoot: string;
  host: string;
  port: number;
  accessCodes: string[];
  dbPath?: string;
}

export function parseDemoArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): DemoCliOptions {
  const args = argv.slice(2);
  let projectRoot: string | undefined;
  let host = env.VOS_DEMO_HOST ?? "127.0.0.1";
  let port = Number(env.VOS_DEMO_PORT ?? "8789");
  let dbPath = env.VOS_DEMO_DB;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "demo") continue;
    if (arg === "--project-root") {
      projectRoot = required(args, ++i, arg);
      continue;
    }
    if (arg.startsWith("--project-root=")) {
      projectRoot = arg.slice("--project-root=".length);
      continue;
    }
    if (arg === "--host") {
      host = required(args, ++i, arg);
      continue;
    }
    if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--port") {
      port = Number(required(args, ++i, arg));
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
      continue;
    }
    if (arg === "--db") {
      dbPath = required(args, ++i, arg);
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = arg.slice("--db=".length);
      continue;
    }
    throw new Error(`unknown flag for demo: ${arg}`);
  }
  if (!projectRoot) throw new Error("demo requires --project-root");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port requires a valid TCP port");
  const accessCodes = (env.VOS_DEMO_ACCESS_CODES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  if (accessCodes.length === 0) throw new Error("VOS_DEMO_ACCESS_CODES must contain at least one access code");
  return {
    projectRoot: path.resolve(projectRoot),
    host,
    port,
    accessCodes,
    dbPath,
  };
}

export async function runDemoCli(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = parseDemoArgs(argv, env);
  const server = Bun.serve({
    hostname: options.host,
    port: options.port,
    fetch: createDemoHandler(options),
  });
  console.log(`vos demo listening on http://${server.hostname}:${server.port}`);
  await new Promise<void>((resolve) => {
    const stop = () => {
      server.stop(true);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

function required(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (import.meta.main) {
  runDemoCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
