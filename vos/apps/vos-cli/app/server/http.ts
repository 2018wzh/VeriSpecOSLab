import type { PortalClient } from "../auth/portal-client.ts";
import {
  createVosHttpHandler as createPackageVosHttpHandler,
  startVosHttpServer as startPackageVosHttpServer,
} from "vos-server";

export interface VosHttpServerOptions {
  projectRoot: string;
  portalUrl: string;
  projectId: string;
  host?: string;
  port?: number;
  portalClient?: PortalClient;
}

export interface VosHttpServerResult {
  host: string;
  port: number;
  url: string;
  server: Bun.Server<undefined>;
}

export function startVosHttpServer(options: VosHttpServerOptions): VosHttpServerResult {
  return startPackageVosHttpServer({
    ...options,
    executeCommand: executeCommandByCliInvocation,
    importObjectManifest: importObjectManifest,
  });
}

export function createVosHttpHandler(options: VosHttpServerOptions): (request: Request) => Promise<Response> {
  return createPackageVosHttpHandler({
    ...options,
    executeCommand: executeCommandByCliInvocation,
    importObjectManifest: importObjectManifest,
  });
}

async function importObjectManifest(projectRoot: string, manifest: unknown): Promise<void> {
  if (!manifest) return;
  const { createKbEmbedder } = await import("../kb/embedding.ts");
  const { importKbManifest } = await import("vos-kb");
  await importKbManifest(projectRoot, manifest, { embedder: createKbEmbedder(projectRoot) });
}

async function executeCommandByCliInvocation(context: import("vos-server").VosCommandExecutionContext): Promise<import("vos-server").VosCommandResult> {
  const portalClient = context.portalClient as PortalClient | undefined;
  const onEvent = context.onEvent as ((event: import("../evidence/events.ts").RunEvent) => void | Promise<void>) | undefined;
  const { executeCliInvocation } = await import("../main.ts");
  const result = await executeCliInvocation(["bun", "vos", "--project-root", context.projectRoot, "--json", ...(context.agentSessionId ? ["--agent-session", context.agentSessionId] : []), ...context.commandArgs], {
    print: false,
    serveBinding: {
      portalUrl: context.portalUrl,
      projectId: context.projectId,
    },
    portalClient,
    signal: context.signal,
    onEvent,
  });
  return {
    run_id: result.run_id,
    status: result.status,
    command: result.command,
    started_at: result.started_at,
    finished_at: result.finished_at,
    artifacts: result.artifacts,
    evidence_refs: result.evidence_refs,
    message: result.message,
  };
}

export type { VosHttpRun } from "vos-server";
export type { RunEvent } from "vos-core";
