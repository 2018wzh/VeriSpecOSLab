import type { Sql } from "postgres";
import { RetentionPolicyUpdateV1Schema, type AdminSystemStatusV1, type PortalActor, type RetentionPolicyUpdateV1, type RetentionPolicyV1 } from "vos-core/portal-contracts";
import { GiteaClient } from "../storage/gitea.ts";
import { S3ObjectStore } from "../storage/s3.ts";

export class AdminSystemService {
  constructor(private readonly sql:Sql,private readonly gitea:GiteaClient,private readonly objects:S3ObjectStore){}

  async status(actor:PortalActor):Promise<AdminSystemStatusV1>{
    if(actor.role!=="admin")throw new Error("administrator access required");
    const checkedAt=new Date();
    const [queueRows,workerRows,postgresCheck,giteaCheck,minioCheck]=await Promise.all([
      this.sql`select count(*) filter(where status='queued')::int pipeline_queued,count(*) filter(where status in ('leased','running'))::int pipeline_active from pipeline_runs`,
      this.sql`select id,last_heartbeat,current_run_id,last_heartbeat>=now()-interval '30 seconds' online from worker_nodes order by last_heartbeat desc,id limit 100`,
      settled(async()=>{await this.sql`select 1`;return"connected";}),
      settled(async()=>`Gitea ${await this.gitea.health()}`),
      settled(async()=>`bucket ${await this.objects.health()}`),
    ]);
    const pending=await this.sql`select count(*) filter(where published_at is null)::int outbox_pending,count(*) filter(where published_at is null and topic='project.provision.requested')::int provisioning_pending from outbox_events`;
    const services=[service("postgres",postgresCheck),service("gitea",giteaCheck),service("minio",minioCheck)];
    const unavailable=services.filter(item=>item.status==="unavailable").length;
    return{version:"admin-system-status.v1",checked_at:checkedAt.toISOString(),overall:unavailable===0?"healthy":unavailable===services.length?"unavailable":"degraded",services,workers:workerRows.map(row=>({id:String(row.id),status:row.online?"online":"stale",last_heartbeat:new Date(String(row.last_heartbeat)).toISOString(),current_run_id:row.current_run_id?String(row.current_run_id):undefined})),queues:{pipeline_queued:Number(queueRows[0]?.pipeline_queued??0),pipeline_active:Number(queueRows[0]?.pipeline_active??0),outbox_pending:Number(pending[0]?.outbox_pending??0),provisioning_pending:Number(pending[0]?.provisioning_pending??0)}};
  }
  async retention(actor:PortalActor):Promise<RetentionPolicyV1>{if(actor.role!=="admin")throw new Error("administrator access required");const rows=await this.sql`select * from retention_policies where scope='global'`;if(!rows[0])throw new Error("global retention policy is missing");return policy(rows[0]);}
  async updateRetention(actor:PortalActor,raw:RetentionPolicyUpdateV1,traceId:string,idempotencyKey:string,requestHash:string):Promise<RetentionPolicyV1>{if(actor.role!=="admin")throw new Error("administrator access required");const input=RetentionPolicyUpdateV1Schema.parse(raw);return await this.sql.begin(async tx=>{await tx`select pg_advisory_xact_lock(hashtext(${`${actor.id}:${idempotencyKey}`}))`;const existing=await tx`select request_hash,response from idempotency_keys where actor_id=${actor.id} and key=${idempotencyKey} and expires_at>now()`;if(existing[0]){if(existing[0].request_hash!==requestHash)throw new Error("幂等键已被不同请求使用");return existing[0].response as RetentionPolicyV1;}const rows=await tx`update retention_policies set ordinary_days=${input.ordinary_days},records_days=${input.records_days},revision=revision+1,updated_by=${actor.id},updated_at=now() where scope='global' and revision=${input.expected_revision} returning *`;if(!rows[0])throw new Error("保留策略已被并发更新，请刷新后重试");const response=policy(rows[0]);await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},${actor.id},'retention.policy.update','retention_policy','global',${input.reason},${traceId},${tx.json({ordinary_days:input.ordinary_days,records_days:input.records_days,revision:response.revision})})`;await tx`insert into idempotency_keys(actor_id,key,request_hash,status_code,response,expires_at) values(${actor.id},${idempotencyKey},${requestHash},200,${tx.json(response)},now()+interval '24 hours')`;return response;});}
}

type Check={ok:true;detail:string}|{ok:false;detail:string};
async function settled(operation:()=>Promise<string>):Promise<Check>{try{return{ok:true,detail:await operation()};}catch(error){return{ok:false,detail:safeError(error)};}}
function service(id:"postgres"|"gitea"|"minio",check:Check):AdminSystemStatusV1["services"][number]{return{id,status:check.ok?"healthy":"unavailable",detail:check.detail};}
function safeError(error:unknown):string{return(error instanceof Error?error.message:String(error)).replace(/(token|secret|password|authorization)\s*[=:]\s*[^\s,;]+/gi,"$1=[redacted]").replace(/https?:\/\/[^@\s]+@/gi,"https://[redacted]@").slice(0,500);}
function policy(row:Record<string,unknown>):RetentionPolicyV1{return{version:"retention-policy.v1",ordinary_days:Number(row.ordinary_days),records_days:Number(row.records_days),revision:Number(row.revision),updated_at:new Date(String(row.updated_at)).toISOString()};}
