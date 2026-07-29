import Docker from "dockerode";
import { PassThrough } from "node:stream";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docker=process.env.DOCKER_HOST?new Docker({host:process.env.DOCKER_HOST}):new Docker({socketPath:process.platform==="win32"?"\\\\.\\pipe\\docker_engine":"/var/run/docker.sock"});
const connectedTest=process.env.VOS_CONNECTED_TEST??process.argv[2]??"teaching-cycle";
const testConfig={
  "teaching-cycle":{file:"tests/teaching-cycle.integration.test.ts",flag:"VOS_TEST_TEACHING_CYCLE=1",timeout:"180000"},
  "runner-load":{file:"tests/runner-load.integration.test.ts",flag:"VOS_TEST_RUNNER_LOAD=1",timeout:"180000"},
}[connectedTest];
if(!testConfig)throw new Error("VOS_CONNECTED_TEST must be teaching-cycle or runner-load");
const suffix=crypto.randomUUID().replaceAll("-","").slice(0,8);
const proxyName=`vos-socket-proxy-qa-${suffix}`;
const testName=`vos-${connectedTest}-qa-${suffix}`;
const controlPortalName=`vos-portal-control-qa-${suffix}`;
const runnerNetworkName="vos-portal-runner";
const runtimeNetworkName="vos-portal-runtime-control";
let proxy:Docker.Container|undefined;
let testContainer:Docker.Container|undefined;
let controlPortal:Docker.Container|undefined;
let createdRunner=false;
let createdRuntime=false;

try{
  const postgres=await service("postgres");
  const portal=await service("vos-portal");
  const gitea=await service("gitea");
  const minio=await service("minio");
  const controlNetwork=networkContaining(await postgres.inspect(),"control");
  const checkoutNetwork=networkContaining(await gitea.inspect(),"checkout");
  const objectsNetwork=networkContaining(await minio.inspect(),"objects");
  const pgPassword=containerEnv(await postgres.inspect(),"POSTGRES_PASSWORD");
  const giteaToken=containerEnv(await portal.inspect(),"VOS_GITEA_TOKEN");
  const webhookSecret=containerEnv(await portal.inspect(),"VOS_GITEA_WEBHOOK_SECRET");
  const masterKey=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const s3User=containerEnv(await minio.inspect(),"MINIO_ROOT_USER");
  const s3Password=containerEnv(await minio.inspect(),"MINIO_ROOT_PASSWORD");
  const admin=optionalContainerEnv(await gitea.inspect(),"GITEA_ADMIN_USER")??"portal-admin";
  createdRunner=await ensureNetwork(runnerNetworkName,true);
  createdRuntime=await ensureNetwork(runtimeNetworkName,true);
  proxy=await docker.createContainer({name:proxyName,Image:"ghcr.io/tecnativa/docker-socket-proxy:v0.4.2",Env:["CONTAINERS=1","EXEC=1","IMAGES=1","NETWORKS=1","VOLUMES=1","POST=1","ALLOW_START=1","ALLOW_STOP=1","ALLOW_RESTARTS=1","LOG_LEVEL=warning"],HostConfig:{NetworkMode:runtimeNetworkName,ReadonlyRootfs:true,CapDrop:["ALL"],SecurityOpt:["no-new-privileges:true"],Binds:["/var/run/docker.sock:/var/run/docker.sock:ro"],Tmpfs:{"/tmp":"rw,nosuid,noexec,size=8m","/run":"rw,nosuid,noexec,size=8m","/var/lib/haproxy":"rw,nosuid,noexec,size=8m"}},NetworkingConfig:{EndpointsConfig:{[runtimeNetworkName]:{Aliases:["docker-socket-proxy"]}}}});
  await proxy.start();
  const databaseUrl=`postgresql://vos_portal:${pgPassword}@postgres:5432/vos_portal`;
  const env=[`DATABASE_URL=${databaseUrl}`,`PORTAL_TEST_DATABASE_URL=${databaseUrl}`,`PORTAL_TEST_MASTER_KEY=${masterKey}`,`VOS_PORTAL_MASTER_KEY=${masterKey}`,testConfig.flag,"PORTAL_TEST_GITEA_URL=http://gitea:3000",`PORTAL_TEST_GITEA_TOKEN=${giteaToken}`,`PORTAL_TEST_GITEA_USERNAME=${admin}`,`PORTAL_TEST_GITEA_WEBHOOK_SECRET=${webhookSecret}`,"DOCKER_HOST=tcp://docker-socket-proxy:2375","VOS_RUNNER_IMAGE=vos-runner:local",`VOS_RUNNER_CHECKOUT_NETWORK=${checkoutNetwork}`,`VOS_RUNNER_NETWORK=${runnerNetworkName}`,"VOS_RUNNER_PORTAL_URL=https://portal.test","VOS_RUNNER_CPUS=1","VOS_RUNNER_MEMORY_BYTES=536870912","VOS_RUNNER_PIDS=128","VOS_RUNNER_DISK_BYTES=536870912","VOS_GITEA_URL=http://gitea:3000",`VOS_GITEA_TOKEN=${giteaToken}`,"VOS_GITEA_WEBHOOK_URL=http://vos-portal:8787/api/v1/internal/gitea/webhook",`VOS_GITEA_WEBHOOK_SECRET=${webhookSecret}`,"VOS_QA_AGENT_ENDPOINT=http://vos-agent:8787","VOS_QA_AGENT_TOKEN=qa-not-used","VOS_S3_ENDPOINT=http://minio:9000","VOS_S3_BUCKET=vos-artifacts","VOS_S3_REGION=us-east-1",`VOS_S3_ACCESS_KEY=${s3User}`,`VOS_S3_SECRET_KEY=${s3Password}`,`VOS_RUNNER_TIMEOUT_MS=${process.env.VOS_RUNNER_TIMEOUT_MS??"90000"}`];
  const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
  const overlays=[testConfig.file,"worker/worker.ts","worker/qa-agent.ts","worker/runner-evidence.ts","worker/docker-runner.ts","server/postgres-repository.ts","server/grading-service.ts","server/model-control.ts","server/model-credentials.ts"].map(relative=>`${path.join(appRoot,...relative.split("/"))}:/workspace/vos/apps/vos-portal/${relative}:ro`);
  for(const migration of readdirSync(path.join(appRoot,"storage","migrations")).filter(name=>/^\d+_.+\.sql$/.test(name)).toSorted())overlays.push(`${path.join(appRoot,"storage","migrations",migration)}:/workspace/vos/apps/vos-portal/storage/migrations/${migration}:ro`);
  overlays.push(`${path.resolve(appRoot,"..","..","packages","vos-core","src","portal","contracts.ts")}:/workspace/vos/packages/vos-core/src/portal/contracts.ts:ro`);
  overlays.push(`${path.join(appRoot,"tests","fixtures","teaching-project")}:/workspace/vos/apps/vos-portal/tests/fixtures/teaching-project:ro`);
  const controlOverlays=["server/http.ts","server/worker-auth.ts","server/worker-control.ts","storage/database.ts","storage/s3.ts"].map(relative=>`${path.join(appRoot,...relative.split("/"))}:/workspace/vos/apps/vos-portal/${relative}:ro`);
  controlOverlays.push(`${path.resolve(appRoot,"..","..","packages","vos-core","src","portal","contracts.ts")}:/workspace/vos/packages/vos-core/src/portal/contracts.ts:ro`);
  controlPortal=await docker.createContainer({name:controlPortalName,Image:"vos-portal:local",Env:[...env,"VOS_PORTAL_HOST=0.0.0.0"],HostConfig:{NetworkMode:runtimeNetworkName,Binds:controlOverlays},NetworkingConfig:{EndpointsConfig:{[runtimeNetworkName]:{Aliases:["vos-portal"]}}}});
  await docker.getNetwork(controlNetwork).connect({Container:controlPortal.id});
  await docker.getNetwork(objectsNetwork).connect({Container:controlPortal.id});
  await controlPortal.start();
  await new Promise(resolve=>setTimeout(resolve,1_000));
  const controlState=(await controlPortal.inspect()).State;
  if(!controlState.Running)throw new Error(`temporary worker control API stopped during startup: ${controlState.Error||controlState.Status}`);
  testContainer=await docker.createContainer({name:testName,Image:"vos-portal:local",Entrypoint:["/bin/sh","-euc"],Cmd:[`bun run apps/vos-portal/server/main.ts migrate; exec bun test apps/vos-portal/${testConfig.file}`],Env:[...env,"VOS_WORKER_CONTROL_URL=http://vos-portal:8787/api/v1/internal/worker"],HostConfig:{NetworkMode:runtimeNetworkName,Binds:overlays}});
  await docker.getNetwork(controlNetwork).connect({Container:testContainer.id});
  await docker.getNetwork(runnerNetworkName).connect({Container:testContainer.id});
  const attached=await testContainer.attach({stream:true,stdout:true,stderr:true});
  const stdout=new PassThrough();const stderr=new PassThrough();stdout.pipe(process.stdout);stderr.pipe(process.stderr);
  (docker as unknown as {modem:{demuxStream(stream:NodeJS.ReadableStream,stdout:NodeJS.WritableStream,stderr:NodeJS.WritableStream):void}}).modem.demuxStream(attached,stdout,stderr);
  await testContainer.start();
  const result=await testContainer.wait();
  if(result.StatusCode!==0)throw new Error(`connected ${connectedTest} test exited with ${result.StatusCode}`);
}finally{
  await remove(testContainer);await remove(controlPortal);await remove(proxy);
  if(createdRuntime)await docker.getNetwork(runtimeNetworkName).remove().catch(()=>undefined);
  if(createdRunner)await docker.getNetwork(runnerNetworkName).remove().catch(()=>undefined);
}

async function service(name:string):Promise<Docker.Container>{
  const rows=await docker.listContainers({filters:{label:[`com.docker.compose.service=${name}`]}});
  if(rows.length!==1)throw new Error(`expected one running Compose service for ${name}, found ${rows.length}`);
  const container=docker.getContainer(rows[0].Id);
  const deadline=Date.now()+120_000;
  while(Date.now()<deadline){
    const state=(await container.inspect()).State;
    if(!state.Running)throw new Error(`Compose service ${name} stopped during readiness: ${state.Error||state.Status}`);
    if(!state.Health||state.Health.Status==="healthy")return container;
    if(state.Health.Status==="unhealthy")throw new Error(`Compose service ${name} failed its health check`);
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`Compose service ${name} did not become healthy within 120000 ms`);
}
function containerEnv(inspect:Docker.ContainerInspectInfo,name:string):string{const value=optionalContainerEnv(inspect,name);if(value===undefined)throw new Error(`${name} is missing from connected service`);return value;}
function optionalContainerEnv(inspect:Docker.ContainerInspectInfo,name:string):string|undefined{const entry=inspect.Config.Env?.find(item=>item.startsWith(`${name}=`));return entry?.slice(name.length+1);}
function networkContaining(inspect:Docker.ContainerInspectInfo,fragment:string):string{const names=Object.keys(inspect.NetworkSettings.Networks).filter(name=>name.includes(fragment));if(names.length!==1)throw new Error(`expected one ${fragment} network, found ${names.length}`);return names[0];}
async function ensureNetwork(name:string,internal:boolean):Promise<boolean>{try{await docker.getNetwork(name).inspect();return false;}catch{await docker.createNetwork({Name:name,Internal:internal,CheckDuplicate:true});return true;}}
async function remove(container:Docker.Container|undefined):Promise<void>{if(!container)return;const exists=await container.inspect().catch(()=>undefined);if(!exists)return;await container.remove({force:true});}
