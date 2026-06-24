import type { CommandStatus, ParsedInvocation, EffectivePolicy, RunAuthContext } from "./types.ts";
import type { EvidenceWriter } from "./evidence/index.ts";
import type { HeadlessAgentRunner } from "./agent/runner.ts";
import type { PortalClient } from "./auth/portal-client.ts";
import type { RunEvent } from "./evidence/events.ts";

export interface CommandOutcome {
  status: CommandStatus;
  details: Record<string, unknown>;
}

export interface ExecContext {
  projectRoot: string;
  global: ParsedInvocation["global"];
  evidence: EvidenceWriter;
  agentRunner?: HeadlessAgentRunner;
  progress?: import("./progress/types.ts").CommandProgress;
  auth?: RunAuthContext;
  effectivePolicy?: EffectivePolicy;
  signal?: AbortSignal;
  portalClient?: PortalClient;
}

export interface ExecuteCliOptions {
  print?: boolean;
  portalClient?: PortalClient;
  agentRunner?: HeadlessAgentRunner;
  serveBinding?: {
    portalUrl: string;
    projectId: string;
    bearerToken?: string;
  };
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void | Promise<void>;
}
