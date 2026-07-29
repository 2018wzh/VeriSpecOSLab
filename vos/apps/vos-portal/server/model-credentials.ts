import type { Sql } from "postgres";
import type { ModelCredentialInputV1, ModelCredentialRefV1, PortalActor } from "vos-core/portal-contracts";
import { ModelCredentialInputV1Schema } from "vos-core/portal-contracts";
import { EnvelopeEncryption } from "../storage/envelope.ts";

type Row = Record<string, unknown>;
function id(prefix:string):string{return `${prefix}-${crypto.randomUUID()}`;}
export interface RunnerModelCredentialLease {leaseId:string;provider:string;secret:string;expiresAt:string;}

export class ModelCredentialService {
  private constructor(private readonly sql:Sql,private readonly envelope:EnvelopeEncryption){}
  static async create(sql:Sql,masterKey:string):Promise<ModelCredentialService>{return new ModelCredentialService(sql,await EnvelopeEncryption.fromBase64Url(masterKey));}

  async save(actor:PortalActor,raw:ModelCredentialInputV1,traceId:string,key:string,requestHash:string):Promise<ModelCredentialRefV1>{
    const input=ModelCredentialInputV1Schema.parse(raw);
    return await this.sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtext(${`${actor.id}:${key}`}))`;
      const replay=await tx`select request_hash,response from idempotency_keys where actor_id=${actor.id} and key=${key} and expires_at>now()`;
      if(replay[0]){if(replay[0].request_hash!==requestHash)throw new Error("幂等键已被不同请求使用");return replay[0].response as ModelCredentialRefV1;}
      const policy=await tx`select cap.policy from course_memberships cm join courses c on c.id=cm.course_id and c.status in ('published','active','grading','appeal') join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version where cm.user_id=${actor.id} and cm.status='active' and (cap.policy->>'allow_byok')::boolean=true and cap.policy->'allowed_models' ? ${input.provider} limit 1`;
      if(!policy.length)throw new Error("当前课程未允许该模型的 BYOK 凭据");
      const credentialId=id("model-credential");
      const sealed=await this.envelope.seal(input.secret,`model-credential:${credentialId}:${actor.id}`);
      const rows=await tx`insert into model_credentials(id,owner_id,provider,label,last_four,secret_cipher,secret_iv) values(${credentialId},${actor.id},${input.provider},${input.label},${input.secret.slice(-4)},${sealed.cipher},${sealed.iv}) returning *`;
      const response=this.ref(rows[0] as Row);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'model_credential.create','model_credential',${credentialId},${input.reason},${traceId},${tx.json({provider:input.provider,label:input.label,last_four:response.last_four})})`;
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${actor.id},${key},${requestHash},201,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  async list(actor:PortalActor):Promise<ModelCredentialRefV1[]>{const rows=await this.sql`select * from model_credentials where owner_id=${actor.id} order by created_at desc`;return rows.map(row=>this.ref(row as Row));}
  async leaseForRun(runId:string,workerId:string,traceId:string,ttlSeconds=600):Promise<RunnerModelCredentialLease|undefined>{
    if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(workerId))throw new Error("worker identity is invalid");
    if(!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>900)throw new Error("credential lease TTL must be between 60 and 900 seconds");
    return await this.sql.begin(async tx=>{
      const runs=await tx`select pr.*,mc.owner_id credential_owner_id,mc.provider,mc.secret_cipher,mc.secret_iv,mc.revoked_at credential_revoked_at from pipeline_runs pr left join model_credentials mc on mc.id=pr.model_credential_id where pr.id=${runId} for update of pr`;
      const run=runs[0] as Row|undefined;if(!run)throw new Error("pipeline run does not exist");if(!run.model_credential_id)return undefined;
      if(!["leased","running"].includes(String(run.status))||run.lease_owner!==workerId||!run.leased_until||new Date(String(run.leased_until)).getTime()<=Date.now())throw new Error("worker does not hold an active lease for this pipeline run");
      if(run.requested_by!==run.credential_owner_id||run.credential_revoked_at)throw new Error("pipeline credential is revoked or no longer owned by the requester");
      const policy=await tx`select 1 from projects p join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id join course_ai_policies cap on cap.course_id=c.id and cap.manifest_version=c.published_manifest_version where p.id=${String(run.project_id)} and p.status='active' and c.status in ('published','active','grading','appeal') and (cap.policy->>'allow_byok')::boolean=true and cap.policy->'allowed_models' ? ${String(run.provider)}`;
      if(!policy[0])throw new Error("pipeline credential is no longer allowed by the published course policy");
      const leaseId=id("model-credential-lease");const expiresAt=new Date(Date.now()+ttlSeconds*1000);
      const leases=await tx`insert into model_credential_leases(id,credential_id,run_id,worker_id,provider,expires_at,consumed_at) values(${leaseId},${String(run.model_credential_id)},${runId},${workerId},${String(run.provider)},${expiresAt},now()) on conflict(run_id,credential_id) do update set worker_id=excluded.worker_id,provider=excluded.provider,expires_at=excluded.expires_at,consumed_at=now(),revoked_at=null where model_credential_leases.worker_id=excluded.worker_id or model_credential_leases.expires_at<now() returning *`;
      if(!leases[0])throw new Error("an active credential lease is held by another worker");
      const secret=await this.envelope.open(run.secret_cipher as Uint8Array,run.secret_iv as Uint8Array,`model-credential:${String(run.model_credential_id)}:${String(run.requested_by)}`);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},null,'model_credential.runner_unseal','pipeline',${runId},'authorized short-lived runner credential lease',${traceId},${tx.json({worker_id:workerId,credential_id:String(run.model_credential_id),lease_id:String(leases[0].id),provider:String(run.provider),expires_at:expiresAt.toISOString()})})`;
      return{leaseId:String(leases[0].id),provider:String(run.provider),secret,expiresAt:expiresAt.toISOString()};
    });
  }
  async revoke(actor:PortalActor,credentialId:string,reason:string,traceId:string,key:string,requestHash:string):Promise<ModelCredentialRefV1>{
    if(reason.trim().length<10)throw new Error("撤销理由至少需要 10 个字符");
    return await this.sql.begin(async tx=>{
      await tx`select pg_advisory_xact_lock(hashtext(${`${actor.id}:${key}`}))`;
      const replay=await tx`select request_hash,response from idempotency_keys where actor_id=${actor.id} and key=${key} and expires_at>now()`;
      if(replay[0]){if(replay[0].request_hash!==requestHash)throw new Error("幂等键已被不同请求使用");return replay[0].response as ModelCredentialRefV1;}
      const rows=await tx`update model_credentials set revoked_at=now() where id=${credentialId} and owner_id=${actor.id} and revoked_at is null returning *`;
      if(!rows[0])throw new Error("凭据不存在、已撤销或不属于当前用户");
      await tx`update model_credential_leases set revoked_at=now() where credential_id=${credentialId} and revoked_at is null`;
      const response=this.ref(rows[0] as Row);
      await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${id("audit")},${actor.id},'model_credential.revoke','model_credential',${credentialId},${reason},${traceId},${tx.json({provider:response.provider,label:response.label})})`;
      await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${actor.id},${key},${requestHash},200,${tx.json(response)},now()+interval '24 hours')`;
      return response;
    });
  }
  private ref(row:Row):ModelCredentialRefV1{return{version:"model-credential-ref.v1",id:String(row.id),owner_id:String(row.owner_id),provider:String(row.provider),label:String(row.label),last_four:String(row.last_four),created_at:new Date(String(row.created_at)).toISOString(),revoked_at:row.revoked_at?new Date(String(row.revoked_at)).toISOString():undefined};}
}
