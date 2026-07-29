import type { Sql } from "postgres";
import { S3ObjectStore } from "./s3.ts";

export interface GarbageCollectionResult { deleted:number; failed:number }

export async function collectExpiredObjects(sql:Sql,store:S3ObjectStore,limit=100):Promise<GarbageCollectionResult>{
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("garbage collection limit must be between 1 and 1000");
  const rows=await sql`select o.id,o.object_key,o.project_id from object_refs o join projects p on p.id=o.project_id join experiments e on e.id=p.experiment_id join courses c on c.id=e.course_id cross join retention_policies rp where rp.scope='global' and o.deleted_at is null and o.created_at<now()-make_interval(days=>rp.ordinary_days) and c.status in ('closed','archived') order by o.created_at,o.id limit ${limit}`;
  let deleted=0;let failed=0;
  for(const row of rows){
    try{
      await store.delete(String(row.object_key));
      await sql.begin(async tx=>{const updated=await tx`update object_refs set deleted_at=now() where id=${String(row.id)} and deleted_at is null returning id`;if(!updated.length)throw new Error("object reference changed during garbage collection");await tx`insert into audit_events(id,actor_id,action,resource_type,resource_id,reason,trace_id,payload) values(${`audit-${crypto.randomUUID()}`},null,'retention.object.delete','object',${String(row.id)},'course retention policy expired object',${`gc-${crypto.randomUUID()}`},${tx.json({project_id:String(row.project_id),object_key:String(row.object_key)})})`;});
      deleted+=1;
    }catch(error){failed+=1;console.error(JSON.stringify({level:"error",event:"retention_object_delete_failed",object_id:String(row.id),project_id:String(row.project_id),error:error instanceof Error?error.message:String(error)}));}
  }
  return{deleted,failed};
}
