import { expect,test } from "bun:test";
import { createHash } from "node:crypto";
import { CreateBucketCommand,DeleteBucketCommand,DeleteObjectCommand,S3Client } from "@aws-sdk/client-s3";
import { S3ObjectStore } from "../storage/s3.ts";

const endpoint=process.env.PORTAL_TEST_S3_ENDPOINT;
const integration=endpoint?test:test.skip;

integration("MinIO accepts presigned checksum upload and verified download",async()=>{
  const accessKey=process.env.PORTAL_TEST_S3_ACCESS_KEY!;
  const secretKey=process.env.PORTAL_TEST_S3_SECRET_KEY!;
  const bucket=`vos-it-${crypto.randomUUID()}`;
  const config={endpoint:endpoint!,region:"us-east-1",bucket,accessKey,secretKey};
  const client=new S3Client({endpoint,region:"us-east-1",forcePathStyle:true,credentials:{accessKeyId:accessKey,secretAccessKey:secretKey}});
  const key="project/run/evidence.json";
  const workerKey="project/run/worker-manifest.json";
  try{
    await client.send(new CreateBucketCommand({Bucket:bucket}));
    const bytes=new TextEncoder().encode('{"result":"pass"}');
    const sha=createHash("sha256").update(bytes).digest("hex");
    const store=new S3ObjectStore(config);
    const upload=await store.presignPut(key,sha,"application/json");
    const response=await fetch(upload.url,{method:"PUT",headers:upload.headers,body:bytes});
    if(!response.ok)throw new Error(`MinIO upload failed: HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);
    expect(await store.verifyMetadata(key,sha,bytes.byteLength,"application/json")).toEqual({size_bytes:bytes.byteLength,content_type:"application/json"});
    expect(new TextDecoder().decode(await store.readVerified(key,sha,1024))).toBe('{"result":"pass"}');
    const workerObject=await store.putVerified(workerKey,bytes,"application/json");
    expect(workerObject).toEqual({uri:`s3://${bucket}/${workerKey}`,sha256:sha,size_bytes:bytes.byteLength});
    expect(new TextDecoder().decode(await store.readVerified(workerKey,sha,1024))).toBe('{"result":"pass"}');
  }finally{
    await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>undefined);
    await client.send(new DeleteObjectCommand({Bucket:bucket,Key:workerKey})).catch(()=>undefined);
    await client.send(new DeleteBucketCommand({Bucket:bucket})).catch(()=>undefined);
    client.destroy();
  }
},30_000);
