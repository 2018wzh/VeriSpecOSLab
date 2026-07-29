import { describe,expect,test } from "bun:test";
import { createHash,createHmac } from "node:crypto";
import { GiteaClient,verifyGiteaWebhook } from "../storage/gitea.ts";
import { S3ObjectStore } from "../storage/s3.ts";

const repository={id:1,full_name:"course/team-1",html_url:"https://git.example/course/team-1",clone_url:"https://git.example/course/team-1.git",private:true};
const request={owner:"course",name:"team-1",template_owner:"templates",template_repo:"xv6",description:"team repository",private:true,collaborators:["student-1"],webhook_url:"https://portal.example/api/v1/internal/gitea/webhook",webhook_secret:"webhook-secret"};

describe("production storage adapters",()=>{
  test("provisions Gitea repository, membership and signed webhook idempotently",async()=>{
    const calls:string[]=[];
    const transport=async(input:URL|RequestInfo,init?:RequestInit)=>{const url=String(input);calls.push(`${init?.method??"GET"} ${new URL(url).pathname}`);if(url.endsWith("/repos/course/team-1")&&!init?.method)return new Response("not found",{status:404});if(url.includes("/generate"))return Response.json(repository,{status:201});if(url.includes("/collaborators/"))return new Response(null,{status:204});if(url.endsWith("/hooks")&&!init?.method)return Response.json([]);if(url.endsWith("/hooks")&&init?.method==="POST")return Response.json({id:4},{status:201});throw new Error(`unexpected ${url}`);};
    const client=new GiteaClient("http://gitea:3000","token",transport as typeof fetch);expect((await client.provision(request)).full_name).toBe("course/team-1");expect(calls).toContain("POST /api/v1/repos/templates/xv6/generate");expect(calls).toContain("PUT /api/v1/repos/course/team-1/collaborators/student-1");
  });
  test("rolls back a newly created repository when collaborator binding fails",async()=>{
    const methods:string[]=[];
    const transport=async(input:URL|RequestInfo,init?:RequestInit)=>{const url=String(input);methods.push(init?.method??"GET");if(url.endsWith("/repos/course/team-1")&&!init?.method)return new Response(null,{status:404});if(url.includes("/generate"))return Response.json(repository,{status:201});if(url.includes("/collaborators/"))return new Response("denied",{status:403});if(url.endsWith("/repos/course/team-1")&&init?.method==="DELETE")return new Response(null,{status:204});throw new Error("unexpected request");};
    await expect(new GiteaClient("http://gitea:3000","token",transport as typeof fetch).provision(request)).rejects.toThrow("Gitea HTTP 403");expect(methods.at(-1)).toBe("DELETE");
  });
  test("verifies Gitea webhook HMAC without accepting malformed signatures",()=>{
    const body=new TextEncoder().encode('{"ref":"refs/heads/main"}');const signature=createHmac("sha256","secret").update(body).digest("hex");const replacement=signature.endsWith("0")?"1":"0";
    expect(verifyGiteaWebhook(body,signature,"secret")).toBe(true);expect(verifyGiteaWebhook(body,`${signature.slice(0,-1)}${replacement}`,"secret")).toBe(false);expect(verifyGiteaWebhook(body,null,"secret")).toBe(false);
  });
  test("uses AWS SDK presigning and verifies downloaded object checksums",async()=>{
    const bytes=new TextEncoder().encode("verified evidence");const sha=createHash("sha256").update(bytes).digest("hex");
    const internal={async send(){return{ContentLength:bytes.length,Metadata:{sha256:sha},Body:{transformToByteArray:async()=>bytes}};}};
    const store=new S3ObjectStore({endpoint:"http://minio:9000",publicEndpoint:"https://objects.example",region:"us-east-1",bucket:"vos-artifacts",accessKey:"ACCESS",secretKey:"SECRET"},{internal:internal as never});
    const signed=await store.presignPut("project-1/run-1/report.json",sha,"application/json",300,new Date("2026-07-18T00:00:00Z"));const url=new URL(signed.url);expect(url.hostname).toBe("objects.example");expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");expect(url.searchParams.get("X-Amz-Expires")).toBe("300");expect(url.searchParams.get("x-amz-checksum-sha256")??signed.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(sha,"hex").toString("base64"));expect(new TextDecoder().decode(await store.readVerified("project-1/run-1/report.json",sha,1024))).toBe("verified evidence");await expect(store.presignGet("../secret",sha)).rejects.toThrow("invalid S3 object key");
  });
});
