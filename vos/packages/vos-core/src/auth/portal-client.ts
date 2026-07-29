import { CliError } from "../errors.ts";
import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";
import type { PolicySnapshot, PortalUserSummary } from "../types.ts";
import type { ArtifactRefV1, EvidenceBundleV1, PipelineEventV1, PipelineRequestV1, PipelineSummaryV1, ProjectBindingV1, RunReproductionV1 } from "../portal/contracts.ts";
import { PipelineEventV1Schema, PresignedObjectRequestSchema, RunReproductionV1Schema } from "../portal/contracts.ts";
import { normalizePortalUrl } from "./store.ts";

export interface PortalClient {
  getMe(portalUrl: string, token: string): Promise<PortalUserSummary>;
  getProjectPolicy(portalUrl: string, projectId: string, token: string): Promise<PolicySnapshot>;
  beginDeviceAuthorization?(portalUrl:string,clientName:string):Promise<DeviceAuthorization>;
  pollDeviceAuthorization?(portalUrl:string,deviceCode:string):Promise<DeviceTokenResult>;
  revokeToken?(portalUrl:string,token:string):Promise<void>;
  triggerPipeline?(portalUrl:string,token:string,input:PipelineRequestV1):Promise<PipelineSummaryV1>;
  getPipeline?(portalUrl:string,token:string,runId:string):Promise<PipelineSummaryV1>;
  watchPipeline?(portalUrl:string,token:string,runId:string):Promise<PipelineEventV1[]>;
  cancelPipeline?(portalUrl:string,token:string,runId:string,reason:string):Promise<PipelineSummaryV1>;
  getEvidence?(portalUrl:string,token:string,runId:string):Promise<EvidenceBundleV1>;
  getReproduction?(portalUrl:string,token:string,runId:string):Promise<RunReproductionV1>;
  downloadArtifact?(portalUrl:string,token:string,artifact:ArtifactRefV1,destination:string):Promise<{size_bytes:number;sha256:string}>;
  getProjectBinding?(portalUrl:string,token:string,projectId:string):Promise<ProjectBindingV1>;
}

export interface DeviceAuthorization {device_code:string;user_code:string;verification_uri:string;expires_in:number;interval:number}
export type DeviceTokenResult={status:"authorization_pending"|"expired_token"|"access_denied"}|{status:"approved";access_token:string;token_type:"Bearer";expires_in:number};

export class HttpPortalClient implements PortalClient {
  async beginDeviceAuthorization(portalUrl:string,clientName:string):Promise<DeviceAuthorization>{const response=await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/auth/device/code`,{method:"POST",headers:{"content-type":"application/json","accept":"application/json","x-idempotency-key":crypto.randomUUID()},body:JSON.stringify({client_name:clientName})});if(!response.ok)throw portalError(response.status,"device_authorization_failed");return await response.json() as DeviceAuthorization;}
  async pollDeviceAuthorization(portalUrl:string,deviceCode:string):Promise<DeviceTokenResult>{const response=await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/auth/device/token`,{method:"POST",headers:{"content-type":"application/json","accept":"application/json"},body:JSON.stringify({device_code:deviceCode})});const payload=await response.json().catch(()=>({status:"expired_token"})) as DeviceTokenResult;if(response.status===428||response.ok||response.status===400)return payload;throw portalError(response.status,"device_token_failed");}
  async revokeToken(portalUrl:string,token:string):Promise<void>{const response=await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/auth/revoke`,{method:"POST",headers:{...authHeaders(token),"x-idempotency-key":crypto.randomUUID()}});if(!response.ok&&response.status!==401)throw portalError(response.status,"token_revoke_failed");}
  async triggerPipeline(portalUrl:string,token:string,input:PipelineRequestV1):Promise<PipelineSummaryV1>{return await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/pipelines`,token,{method:"POST",body:JSON.stringify(input)}) as PipelineSummaryV1;}
  async getPipeline(portalUrl:string,token:string,runId:string):Promise<PipelineSummaryV1>{return await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/pipelines/${encodeURIComponent(runId)}`,token) as PipelineSummaryV1;}
  async cancelPipeline(portalUrl:string,token:string,runId:string,reason:string):Promise<PipelineSummaryV1>{return await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/pipelines/${encodeURIComponent(runId)}/cancel`,token,{method:"POST",body:JSON.stringify({reason})}) as PipelineSummaryV1;}
  async getEvidence(portalUrl:string,token:string,runId:string):Promise<EvidenceBundleV1>{return await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/pipelines/${encodeURIComponent(runId)}/evidence`,token) as EvidenceBundleV1;}
  async getReproduction(portalUrl:string,token:string,runId:string):Promise<RunReproductionV1>{return RunReproductionV1Schema.parse(await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/pipelines/${encodeURIComponent(runId)}/reproduction`,token));}
  async downloadArtifact(portalUrl:string,token:string,artifact:ArtifactRefV1,destination:string):Promise<{size_bytes:number;sha256:string}>{
    const signed=PresignedObjectRequestSchema.parse(await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/objects/${encodeURIComponent(artifact.id)}/download`,token,{method:"POST",body:"{}"}));
    if(signed.sha256!==artifact.sha256||Date.parse(signed.expires_at)<=Date.now())throw new CliError("Portal returned an invalid or expired artifact download authorization","failed",{artifact_id:artifact.id});
    const url=new URL(signed.url);const loopback=url.hostname==="localhost"||url.hostname==="127.0.0.1"||url.hostname==="[::1]"||url.hostname==="::1";
    if(url.protocol!=="https:"&&!(url.protocol==="http:"&&loopback))throw new CliError("Portal artifact download URL must use HTTPS","policy_blocked",{artifact_id:artifact.id});
    const response=await fetch(url,{headers:signed.headers});if(!response.ok||!response.body)throw portalError(response.status,"artifact_download_failed");
    const file=await open(destination,"wx",0o600);const hash=createHash("sha256");let size=0;
    try{const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>artifact.size_bytes){await reader.cancel();throw new CliError("Downloaded artifact exceeds its declared size","failed",{artifact_id:artifact.id,expected_size:artifact.size_bytes});}hash.update(value);let offset=0;while(offset<value.byteLength){const {bytesWritten}=await file.write(value,offset,value.byteLength-offset);if(bytesWritten<=0)throw new Error("artifact download made no filesystem write progress");offset+=bytesWritten;}}const actual=hash.digest("hex");if(size!==artifact.size_bytes||actual!==artifact.sha256)throw new CliError("Downloaded artifact failed integrity verification","failed",{artifact_id:artifact.id,expected_size:artifact.size_bytes,actual_size:size,expected_sha256:artifact.sha256,actual_sha256:actual});return{size_bytes:size,sha256:actual};}catch(error){await file.close();await rm(destination,{force:true});throw error;}finally{await file.close().catch(()=>undefined);}
  }
  async getProjectBinding(portalUrl:string,token:string,projectId:string):Promise<ProjectBindingV1>{return await this.portalJson(`${normalizePortalUrl(portalUrl)}/api/v1/projects/${encodeURIComponent(projectId)}/binding`,token) as ProjectBindingV1;}
  async watchPipeline(portalUrl:string,token:string,runId:string):Promise<PipelineEventV1[]>{
    const base=`${normalizePortalUrl(portalUrl)}/api/v1/pipelines/${encodeURIComponent(runId)}`;
    const events:PipelineEventV1[]=[];const sequences=new Set<number>();let after=-1;let reconnects=0;
    for(;;){
      try{
        const response=await fetch(`${base}/events?after=${after}`,{headers:{...authHeaders(token),accept:"text/event-stream"}});
        if(!response.ok||!response.body)throw portalError(response.status,"pipeline_stream_failed");
        const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();let buffer="";
        for(;;){const {done,value}=await reader.read();if(done)break;buffer+=value.replaceAll("\r\n","\n");const blocks=buffer.split("\n\n");buffer=blocks.pop()??"";for(const block of blocks){const data=block.split("\n").filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");if(!data)continue;const event=PipelineEventV1Schema.parse(JSON.parse(data));if(sequences.has(event.sequence))continue;sequences.add(event.sequence);events.push(event);after=Math.max(after,event.sequence);}}
        const summary=await this.getPipeline(portalUrl,token,runId);if(["passed","failed","cancelled","timed_out"].includes(summary.status))return events;
        throw new Error("pipeline event stream ended before the run reached a terminal state");
      }catch(error){
        if(error instanceof CliError&&error.details?.status===401)throw error;
        reconnects+=1;if(reconnects>5)throw new CliError("Pipeline event stream could not be resumed after 5 attempts","failed",{run_id:runId,after_sequence:after,cause:error instanceof Error?error.message:String(error)});
        await Bun.sleep(Math.min(250*2**(reconnects-1),4000));
      }
    }
  }
  private async portalJson(url:string,token:string,init:RequestInit={}):Promise<unknown>{const response=await fetch(url,{...init,headers:{...authHeaders(token),...(init.body?{"content-type":"application/json","x-idempotency-key":crypto.randomUUID()}:{})}});if(!response.ok)throw portalError(response.status,"portal_request_failed");return await response.json();}
  async getMe(portalUrl: string, token: string): Promise<PortalUserSummary> {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/auth/me`, {
      headers: authHeaders(token),
    });
    if (!response.ok) {
      throw portalError(response.status, "token_invalid");
    }
    const payload = await response.json() as { user?: unknown } | unknown;
    const user = normalizeUser((payload as { user?: unknown }).user ?? payload);
    if (!user) {
      throw new CliError("policy_blocked: invalid Portal user response", "policy_blocked", {
        reason: "policy_unavailable",
      });
    }
    return user;
  }

  async getProjectPolicy(portalUrl: string, projectId: string, token: string): Promise<PolicySnapshot> {
    const response = await fetch(`${normalizePortalUrl(portalUrl)}/api/v1/projects/${encodeURIComponent(projectId)}/vos-policy`, {
      headers: authHeaders(token),
    });
    if (!response.ok) {
      throw portalError(response.status, response.status === 404 ? "policy_unavailable" : "token_invalid");
    }
    const payload = await response.json() as { policy?: unknown } | unknown;
    const policy = normalizePolicySnapshot((payload as { policy?: unknown }).policy ?? payload);
    if (!policy) {
      throw new CliError("policy_blocked: invalid Portal policy response", "policy_blocked", {
        reason: "policy_unavailable",
      });
    }
    if (policy.projectId !== projectId) {
      throw new CliError("policy_blocked: Portal policy project mismatch", "policy_blocked", {
        reason: "policy_unavailable",
        expected_project_id: projectId,
        actual_project_id: policy.projectId,
      });
    }
    return policy;
  }

}

export const defaultPortalClient = new HttpPortalClient();

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
  };
}

function portalError(status: number, reason: string): CliError {
  return new CliError(`policy_blocked: ${reason}`, "policy_blocked", { reason, status });
}

function normalizeUser(raw: unknown): PortalUserSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const id = stringValue(obj.id) ?? stringValue(obj.user_id);
  if (!id) return undefined;
  return {
    id,
    role: stringValue(obj.role),
    username: stringValue(obj.username),
    email: stringValue(obj.email),
  };
}

function normalizePolicySnapshot(raw: unknown): PolicySnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const ref = stringValue(obj.ref) ?? stringValue(obj.id) ?? stringValue(obj.policy_snapshot_ref);
  const projectId = stringValue(obj.project_id) ?? stringValue(obj.projectId);
  if (!ref || !projectId) return undefined;
  return {
    ref,
    projectId,
    allowedCommands: stringArray(obj.allowed_commands) ?? stringArray(obj.allowedCommands) ?? [],
    allowedPaths: stringArray(obj.allowed_paths) ?? stringArray(obj.allowedPaths) ?? [],
    visibilityScope: normalizeVisibilityScope(obj.visibility_scope ?? obj.visibilityScope),
    expiresAt: stringValue(obj.expires_at) ?? stringValue(obj.expiresAt),
  };
}

function normalizeVisibilityScope(value: unknown): "public" | "agent-only" | "staff-only" {
  return value === "staff-only" || value === "agent-only" ? value : "public";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
