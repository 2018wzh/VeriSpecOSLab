import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkerEvidenceReportV1 } from "vos-core/portal-contracts";

const ArtifactSchema = z
  .object({
    kind: z.string().min(1).max(100),
    path: z.string().min(1).max(1024),
    size: z.number().int().nonnegative().optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    summary: z.string().max(1000).optional(),
  })
  .strict();
const EvidenceRefSchema = z
  .object({
    id: z.string().min(1).max(200),
    kind: z.string().min(1).max(100),
    path: z.string().min(1).max(1024),
  })
  .strict();
export const RunnerManifestSchema = z
  .object({
    run_id: z.string().min(1),
    command: z.array(z.string()),
    arguments: z.array(z.string()),
    git_rev: z.string().optional(),
    parent_sha: z.string().optional(),
    spec_hash: z.string().optional(),
    projection_version: z.string().optional(),
    ledger_ref: z.string().optional(),
    input_files: z.array(z.string()).optional(),
    output_files: z.array(z.string()).optional(),
    tests_run: z.array(z.string()).optional(),
    started_at: z.string().datetime(),
    finished_at: z.string().datetime(),
    status: z.string(),
    message: z.string().max(4000).optional(),
    artifacts: z.array(ArtifactSchema).max(100),
    evidence_refs: z.array(EvidenceRefSchema).max(1000),
    project_root: z.string(),
    user_id: z.string().optional(),
    user_role: z.string().optional(),
    project_id: z.string().optional(),
    portal_url: z.string().optional(),
    policy_snapshot_ref: z.string().optional(),
    auth_verdict: z.enum(["allowed", "denied", "not_required"]).optional(),
    auth_checked_at: z.string().datetime().optional(),
    agent_session_id: z.string().optional(),
  })
  .strict();
export type RunnerManifest = z.infer<typeof RunnerManifestSchema>;
export interface RunnerObjectStore {
  putVerified(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ uri: string; sha256: string; size_bytes: number }>;
}

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_ARTIFACT_BYTES = 52_428_800;
const MAX_TOTAL_BYTES = 262_144_000;
export async function collectRunnerEvidence(input: {
  store: RunnerObjectStore;
  workerId:string;
  endpoint: string;
  accessToken?: string;
  remoteRunId: string;
  portalRun: {
    id: string;
    project_id: string;
    commit_sha: string;
    policy_snapshot_ref: string;
    scope: string;
    stage_key?: string;
  };
}): Promise<{manifest:RunnerManifest;report:WorkerEvidenceReportV1}> {
  const base = input.endpoint.replace(/\/$/, "");
  const manifestBytes = await fetchBounded(
    `${base}/api/v1/runs/${encodeURIComponent(input.remoteRunId)}/manifest`,
    MAX_MANIFEST_BYTES,
    input.accessToken,
  );
  const manifest = RunnerManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(manifestBytes)),
  );
  if (manifest.run_id !== input.remoteRunId)
    throw new Error("runner manifest run_id does not match the leased run");
  if (manifest.project_id && manifest.project_id !== input.portalRun.project_id)
    throw new Error("runner manifest project_id mismatch");
  if (manifest.git_rev && manifest.git_rev !== input.portalRun.commit_sha)
    throw new Error("runner manifest git revision mismatch");
  if (
    manifest.policy_snapshot_ref &&
    manifest.policy_snapshot_ref !== input.portalRun.policy_snapshot_ref
  )
    throw new Error("runner manifest policy snapshot mismatch");
  const visibility: "student" | "staff" = input.portalRun.scope === "staff" ? "staff" : "student";
  const stored: Array<{
    id: string;
    key: string;
    uri: string;
    sha256: string;
    size: number;
    contentType: string;
    label: string;
    lineage: Record<string, string>;
  }> = [];
  const manifestKey = `projects/${input.portalRun.project_id}/runs/${input.portalRun.id}/manifest.json`;
  const storedManifest = await input.store.putVerified(
    manifestKey,
    manifestBytes,
    "application/json",
  );
  stored.push({
    id: `object-${crypto.randomUUID()}`,
    key: manifestKey,
    uri: storedManifest.uri,
    sha256: storedManifest.sha256,
    size: storedManifest.size_bytes,
    contentType: "application/json",
    label: "runner manifest",
    lineage: { remote_run_id: input.remoteRunId, kind: "manifest" },
  });
  let total = 0;
  for (const artifact of manifest.artifacts) {
    validateArtifactPath(artifact.path, input.remoteRunId);
    const bytes = await fetchBounded(
      `${base}/api/v1/runs/${encodeURIComponent(input.remoteRunId)}/artifacts?path=${encodeURIComponent(artifact.path)}`,
      MAX_ARTIFACT_BYTES,
      input.accessToken,
    );
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES)
      throw new Error("runner artifacts exceed the total upload limit");
    const digest = sha256(bytes);
    if (artifact.size !== undefined && artifact.size !== bytes.byteLength)
      throw new Error(`runner artifact size mismatch: ${artifact.path}`);
    if (artifact.sha256 && artifact.sha256 !== digest)
      throw new Error(`runner artifact checksum mismatch: ${artifact.path}`);
    const suffix = artifact.path
      .slice(`.vos/runs/${input.remoteRunId}/artifacts/`.length)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const key = `projects/${input.portalRun.project_id}/runs/${input.portalRun.id}/artifacts/${suffix}`;
    const object = await input.store.putVerified(
      key,
      bytes,
      "application/octet-stream",
    );
    if (object.sha256 !== digest)
      throw new Error("object store changed runner artifact content");
    stored.push({
      id: `object-${crypto.randomUUID()}`,
      key,
      uri: object.uri,
      sha256: object.sha256,
      size: object.size_bytes,
      contentType: "application/octet-stream",
      label: artifact.summary ?? artifact.kind,
      lineage: {
        remote_run_id: input.remoteRunId,
        kind: artifact.kind,
        source_path: artifact.path,
      },
    });
  }
  return {
    manifest,
    report:{version:"worker-evidence-report.v1",worker_id:input.workerId,remote_run_id:input.remoteRunId,objects:stored.map(object=>({id:object.id,key:object.key,uri:object.uri,sha256:object.sha256,size_bytes:object.size,content_type:object.contentType,visibility,label:object.label,lineage:object.lineage})),evidence:[...manifest.evidence_refs.map(ref=>({id:`evidence-${crypto.randomUUID()}`,suite:ref.kind,case_name:ref.id,result:manifest.status==="passed"||manifest.status==="ok"?"pass" as const:"fail" as const,visibility,metrics:{path:ref.path,remote_run_id:input.remoteRunId},public_message:ref.kind})),...(input.portalRun.stage_key?[{id:`evidence-${crypto.randomUUID()}`,suite:input.portalRun.stage_key,case_name:"public",result:manifest.status==="passed"||manifest.status==="ok"?"pass" as const:"fail" as const,visibility,metrics:{remote_run_id:input.remoteRunId},public_message:"阶段公开门槛"}]:[])]},
  };
}

async function fetchBounded(
  url: string,
  maxBytes: number,
  accessToken?: string,
): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!response.ok){const endpoint=new URL(url);const detail=(await response.text()).replace(/[\r\n]+/g," ").slice(0,300);throw new Error(`runner evidence fetch failed: HTTP ${response.status} ${endpoint.pathname}${endpoint.search} ${detail}`);}
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes)
    throw new Error("runner response exceeds the allowed size");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes)
    throw new Error("runner response exceeds the allowed size");
  return bytes;
}
function validateArtifactPath(value: string, runId: string): void {
  const prefix = `.vos/runs/${runId}/artifacts/`;
  if (
    !value.startsWith(prefix) ||
    value.includes("\0") ||
    value.split(/[\\/]+/).includes("..") ||
    value.slice(prefix.length).length === 0
  )
    throw new Error("runner manifest contains an invalid artifact path");
}
function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
