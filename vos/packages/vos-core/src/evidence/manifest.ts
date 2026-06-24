import type { CommandStatus } from "../types.ts";

export interface RunArtifact {
  kind: string;
  path: string;
  size?: number;
  sha256?: string;
  summary?: string;
}

export interface EvidenceRef {
  id: string;
  kind: string;
  path: string;
}

export interface RunManifest {
  run_id: string;
  command: string[];
  arguments: string[];
  git_rev?: string;
  parent_sha?: string;
  spec_hash?: string;
  projection_version?: string;
  ledger_ref?: string;
  input_files?: string[];
  output_files?: string[];
  tests_run?: string[];
  started_at: string;
  finished_at: string;
  status: CommandStatus;
  artifacts: RunArtifact[];
  evidence_refs: EvidenceRef[];
  project_root: string;
  user_id?: string;
  user_role?: string;
  project_id?: string;
  portal_url?: string;
  policy_snapshot_ref?: string;
  auth_verdict?: "allowed" | "denied" | "not_required";
  auth_checked_at?: string;
  agent_session_id?: string;
}
