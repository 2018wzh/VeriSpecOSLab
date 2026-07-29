import { WorkerAckV1Schema, WorkerHeartbeatResultV1Schema, WorkerPipelineLeaseV1Schema, type WorkerEvidenceReportV1, type WorkerHeartbeatResultV1, type WorkerPipelineLeaseV1, type WorkerRunCompleteV1 } from "vos-core/portal-contracts";
import { workerControlToken } from "../server/worker-auth.ts";

export class WorkerControlClient{
  private constructor(private readonly baseUrl:string,private readonly workerId:string){}
  static fromEnv(workerId:string):WorkerControlClient{const raw=process.env.VOS_WORKER_CONTROL_URL??"http://vos-portal:8787/api/v1/internal/worker";const url=new URL(raw);if(url.protocol!=="https:"&&!(url.protocol==="http:"&&["vos-portal","127.0.0.1","localhost"].includes(url.hostname)))throw new Error("VOS_WORKER_CONTROL_URL must use HTTPS or the internal vos-portal hostname");return new WorkerControlClient(url.toString().replace(/\/$/,""),workerId);}
  async lease():Promise<WorkerPipelineLeaseV1|null>{const value=await this.request("/lease",{version:"worker-lease-request.v1",worker_id:this.workerId});return value===null?null:WorkerPipelineLeaseV1Schema.parse(value);}
  async heartbeat(runId?:string):Promise<WorkerHeartbeatResultV1>{return WorkerHeartbeatResultV1Schema.parse(await this.request("/heartbeat",{version:"worker-heartbeat.v1",worker_id:this.workerId,run_id:runId,metadata:{runtime:"docker",pid:process.pid}}));}
  async start(runId:string,remoteRunId:string):Promise<void>{WorkerAckV1Schema.parse(await this.request(`/runs/${encodeURIComponent(runId)}/start`,{version:"worker-run-start.v1",worker_id:this.workerId,remote_run_id:remoteRunId}));}
  async reportEvidence(runId:string,report:WorkerEvidenceReportV1):Promise<void>{WorkerAckV1Schema.parse(await this.request(`/runs/${encodeURIComponent(runId)}/evidence`,report));}
  async complete(runId:string,input:WorkerRunCompleteV1):Promise<void>{WorkerAckV1Schema.parse(await this.request(`/runs/${encodeURIComponent(runId)}/complete`,input));}
  private async request(pathname:string,body:unknown):Promise<unknown>{const response=await fetch(`${this.baseUrl}${pathname}`,{method:"POST",signal:AbortSignal.timeout(30_000),headers:{authorization:`Bearer ${workerControlToken(this.workerId)}`,"x-vos-worker-id":this.workerId,"content-type":"application/json"},body:JSON.stringify(body)});if(!response.ok){const detail=(await response.text()).replace(/[\r\n]+/g," ").slice(0,500);throw new Error(`worker control request failed: HTTP ${response.status} ${pathname} ${detail}`);}return await response.json();}
}
