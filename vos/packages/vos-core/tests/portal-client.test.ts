import { expect, test } from "bun:test";
import { HttpPortalClient } from "../src/auth/portal-client.ts";

test("Portal pipeline watch resumes SSE after a premature disconnect and deduplicates events",async()=>{
  let eventConnections=0;let statusRequests=0;const afterValues:string[]=[];const now=new Date().toISOString();
  const event=(sequence:number,type:"queued"|"finished")=>({version:"pipeline-event.v1",run_id:"run-1",sequence,type,visibility:"public",occurred_at:now,payload:{}});
  const summary=(status:"running"|"passed")=>({version:"pipeline-summary.v1",id:"run-1",project_id:"project-1",commit_sha:"a".repeat(40),stage_key:"memory",status,passed:status==="passed"?1:0,total:1,public_message:"",created_at:now,...(status==="passed"?{finished_at:now}:{})});
  const server=Bun.serve({port:0,fetch(request){const url=new URL(request.url);if(url.pathname.endsWith("/events")){eventConnections+=1;afterValues.push(url.searchParams.get("after")??"");const values=eventConnections===1?[event(0,"queued")]:[event(0,"queued"),event(1,"finished")];return new Response(values.map(value=>`event: ${value.type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`).join(""),{headers:{"content-type":"text/event-stream"}});}if(url.pathname.endsWith("/run-1")){statusRequests+=1;return Response.json(summary(statusRequests===1?"running":"passed"));}return new Response("not found",{status:404});}});
  try{const client=new HttpPortalClient();const events=await client.watchPipeline(server.url.toString(),"token","run-1");expect(events.map(item=>item.sequence)).toEqual([0,1]);expect(eventConnections).toBe(2);expect(afterValues).toEqual(["-1","0"]);}finally{server.stop(true);}
});
