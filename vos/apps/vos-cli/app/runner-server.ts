#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { startVosHttpServer } from "vos-server";
import type { PolicySnapshot, PortalUserSummary } from "vos-core";

const identity=JSON.parse(await readFile(required("VOS_RUNNER_IDENTITY_FILE"),"utf8")) as {user:PortalUserSummary;policy:PolicySnapshot};
const server=startVosHttpServer({projectRoot:process.cwd(),portalUrl:required("VOS_RUNNER_PORTAL_URL"),projectId:required("VOS_RUNNER_PROJECT_ID"),host:"0.0.0.0",port:Number(process.env.VOS_RUNNER_PORT??8788),accessToken:required("VOS_SERVE_ACCESS_TOKEN"),runnerIdentity:identity});
console.log(JSON.stringify({level:"info",event:"vos_runner_server_listening",host:server.host,port:server.port,project_id:required("VOS_RUNNER_PROJECT_ID")}));

function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required`);return value;}
