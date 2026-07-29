import { expect,test } from "bun:test";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeCliInvocation,HttpPortalClient } from "../src/index.ts";
import type { DeviceAuthorization,DeviceTokenResult } from "../src/auth/portal-client.ts";
import { getToken } from "../src/auth/store.ts";

const portalUrl=process.env.PORTAL_TEST_URL;
const integration=portalUrl?test:test.skip;

integration("CLI device flow obtains, stores, verifies and revokes a real Portal token",async()=>{
  const root=mkdtempSync(join(tmpdir(),"vos-device-integration-"));
  const previous=process.env.VOS_AUTH_STORE;
  process.env.VOS_AUTH_STORE=join(root,"auth.json");
  let issuedToken:string|undefined;
  class ApprovingPortalClient extends HttpPortalClient{
    override async beginDeviceAuthorization(url:string,clientName:string):Promise<DeviceAuthorization>{const authorization=await super.beginDeviceAuthorization(url,clientName);await approve(url,authorization.user_code);return authorization;}
    override async pollDeviceAuthorization(url:string,deviceCode:string):Promise<DeviceTokenResult>{const result=await super.pollDeviceAuthorization(url,deviceCode);if(result.status==="approved")issuedToken=result.access_token;return result;}
  }
  const client=new ApprovingPortalClient();
  try{
    const login=await executeCliInvocation(["bun","vos","--project-root",root,"--json","login","--portal-url",portalUrl!],{print:false,portalClient:client});
    expect(login.status).toBe("passed");
    const stored=await getToken(portalUrl!);
    expect(stored?.token).toBe(issuedToken);
    expect((await client.getMe(portalUrl!,stored!.token)).id).toBe("user-student");
    const whoami=await executeCliInvocation(["bun","vos","--project-root",root,"--json","whoami","--portal-url",portalUrl!],{print:false,portalClient:client});
    expect(whoami.status,JSON.stringify(whoami.details)).toBe("passed");
    const logout=await executeCliInvocation(["bun","vos","--project-root",root,"--json","logout","--portal-url",portalUrl!],{print:false,portalClient:client});
    expect(logout.status).toBe("passed");
    const after=await executeCliInvocation(["bun","vos","--project-root",root,"--json","whoami","--portal-url",portalUrl!],{print:false,portalClient:client});
    expect(after.status).toBe("passed");
    expect((after.details as {authenticated:boolean}).authenticated).toBe(false);
  }finally{
    if(previous===undefined)delete process.env.VOS_AUTH_STORE;else process.env.VOS_AUTH_STORE=previous;
    rmSync(root,{recursive:true,force:true});
  }
},30_000);

async function approve(url:string,userCode:string):Promise<void>{
  const username=process.env.PORTAL_TEST_USERNAME??"student";
  const password=process.env.PORTAL_TEST_PASSWORD??"student";
  const login=await fetch(`${url}/api/v1/auth/login`,{method:"POST",headers:{"content-type":"application/json","x-idempotency-key":crypto.randomUUID()},body:JSON.stringify({username,password})});
  if(!login.ok)throw new Error(`Portal integration login failed: HTTP ${login.status}`);
  const setCookie=login.headers.get("set-cookie")??"";
  const session=/vos_session=([^;,]+)/.exec(setCookie)?.[1];
  const csrf=/vos_csrf=([^;,]+)/.exec(setCookie)?.[1];
  if(!session||!csrf)throw new Error("Portal integration login did not return both secure cookies");
  const response=await fetch(`${url}/api/v1/auth/device/approve`,{method:"POST",headers:{"content-type":"application/json",cookie:`vos_session=${session}; vos_csrf=${csrf}`,origin:url,"x-csrf-token":csrf,"x-idempotency-key":crypto.randomUUID()},body:JSON.stringify({user_code:userCode})});
  if(!response.ok)throw new Error(`Portal device approval failed: HTTP ${response.status}`);
}
