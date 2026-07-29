import { timingSafeEqual } from "node:crypto";

const WORKER_ID = /^[a-zA-Z0-9_.:-]{1,128}$/;

export function workerControlToken(workerId:string,now=new Date()):string{
  if(!WORKER_ID.test(workerId))throw new Error("worker ID is invalid");
  const master=process.env.VOS_PORTAL_MASTER_KEY;
  if(!master||master.length<32)throw new Error("VOS_PORTAL_MASTER_KEY must contain at least 32 characters");
  const day=now.toISOString().slice(0,10);
  const digest=new Bun.CryptoHasher("sha256",master).update(`worker-control:v1:${workerId}:${day}`).digest("base64").replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");
  return`voswc_${digest}`;
}

export function authenticateWorkerRequest(request:Request,now=new Date()):string|undefined{
  const workerId=request.headers.get("x-vos-worker-id")??"";
  const token=request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token||!WORKER_ID.test(workerId))return undefined;
  const candidates=[workerControlToken(workerId,now),workerControlToken(workerId,new Date(now.getTime()-86_400_000))];
  return candidates.some(candidate=>safeEqual(candidate,token))?workerId:undefined;
}

function safeEqual(left:string,right:string):boolean{
  const a=Buffer.from(left);const b=Buffer.from(right);
  return a.length===b.length&&timingSafeEqual(a,b);
}
