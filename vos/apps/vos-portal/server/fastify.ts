import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import { db } from "../storage/database.ts";
import { GiteaClient } from "../storage/gitea.ts";
import { S3ObjectStore } from "../storage/s3.ts";
import { createPortalHttpHandler } from "./http.ts";
import { registerPortalRoutes } from "./fastify-routes.ts";

export interface PortalServer {url:URL;stop(closeActiveConnections?:boolean):Promise<void>}

export async function startPortalServer(options:{host?:string;port?:number}={}):Promise<PortalServer>{
  const registry=new Registry();collectDefaultMetrics({register:registry,prefix:"vos_portal_"});
  const requests=new Counter({name:"vos_portal_http_requests_total",help:"Portal HTTP requests",labelNames:["method","status"] as const,registers:[registry]});
  const duration=new Histogram({name:"vos_portal_http_request_duration_seconds",help:"Portal HTTP request duration",labelNames:["method"] as const,registers:[registry]});
  const app=Fastify({logger:{level:process.env.VOS_LOG_LEVEL??"info",redact:{paths:["req.headers.authorization","req.headers.cookie","req.headers.x-csrf-token","req.body","res.headers.set-cookie"],censor:"[redacted]"},serializers:{req(request){return{method:request.method,url:request.url,host:request.host,remoteAddress:request.ip};}}},bodyLimit:2_097_152,genReqId:()=>`trace-${crypto.randomUUID()}`});
  await app.register(cookie);
  await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],connectSrc:["'self'"],imgSrc:["'self'","data:"],styleSrc:["'self'","'unsafe-inline'"],scriptSrc:["'self'"]}}});
  await app.register(rateLimit,{global:false,max:10,timeWindow:"1 minute"});
  app.removeAllContentTypeParsers();app.addContentTypeParser("*",{parseAs:"buffer"},(_request,payload,done)=>done(null,payload));
  const handle=await createPortalHttpHandler();
  app.addHook("onRequest",async request=>{(request as typeof request&{portalStartedAt?:bigint}).portalStartedAt=process.hrtime.bigint();});
  app.addHook("onResponse",async(request,reply)=>{requests.inc({method:request.method,status:String(reply.statusCode)});const started=(request as typeof request&{portalStartedAt?:bigint}).portalStartedAt;if(started)duration.observe({method:request.method},Number(process.hrtime.bigint()-started)/1e9);});
  app.get("/healthz",async()=>({ok:true,service:"vos-portal"}));
  app.get("/readyz",async(_request,reply)=>{const checks=await dependencyChecks();const ready=Object.values(checks).every(value=>value==="ready");if(!ready)reply.code(503);return{ready,checks};});
  app.get("/metrics",async(_request,reply)=>{reply.type(registry.contentType);return await registry.metrics();});
  await registerPortalRoutes(app, handle);
  const dist=path.resolve(import.meta.dir,"..","dist");
  if(existsSync(path.join(dist,"index.html"))){await app.register(fastifyStatic,{root:dist,wildcard:false,setHeaders(response,file){response.setHeader("cache-control",file.endsWith("index.html")?"no-cache":"public, max-age=31536000, immutable");}});app.setNotFoundHandler(async(_request,reply)=>reply.header("cache-control","no-cache").sendFile("index.html"));}
  else{if(process.env.NODE_ENV==="production")throw new Error("Portal production frontend is not built");app.setNotFoundHandler(async(_request,reply)=>reply.code(503).send("Portal frontend is not built"));}
  const host=options.host??process.env.VOS_PORTAL_HOST??"127.0.0.1";await app.listen({host,port:options.port??Number(process.env.VOS_PORTAL_PORT??8787)});const address=app.server.address();if(!address||typeof address==="string")throw new Error("Fastify did not expose a TCP listening address");const url=new URL(`http://${host.includes(":")?`[${host}]`:host}:${address.port}/`);return{url,async stop(){await app.close();}};
}

async function dependencyChecks():Promise<Record<string,"ready"|"unavailable">>{const sql=db();const gitea=GiteaClient.fromEnv();const objects=S3ObjectStore.fromEnv();const results=await Promise.allSettled([sql`select 1`,gitea.health(),objects.health(),sql`select 1 from retention_policies where scope='global'`,sql`select 1 from worker_nodes where last_heartbeat>=now()-interval '30 seconds' limit 1`]);return{postgres:state(results[0],true),gitea:state(results[1],true),minio:state(results[2],true),policy:state(results[3],Boolean(results[3].status==="fulfilled"&&results[3].value.length)),runner:state(results[4],Boolean(results[4].status==="fulfilled"&&results[4].value.length))};}
function state(result:PromiseSettledResult<unknown>,valid:boolean):"ready"|"unavailable"{return result.status==="fulfilled"&&valid?"ready":"unavailable";}
