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
  spec_hash?: string;
  projection_version?: string;
  started_at: string;
  finished_at: string;
  status: CommandStatus;
  artifacts: RunArtifact[];
  evidence_refs: EvidenceRef[];
  project_root: string;
}
