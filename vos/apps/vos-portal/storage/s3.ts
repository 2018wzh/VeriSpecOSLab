import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
  type DeleteObjectCommandOutput,
  type HeadBucketCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignedObjectRequest } from "vos-core/portal-contracts";

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  publicEndpoint?: string;
}
interface S3Sender {
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(command: DeleteObjectCommand): Promise<DeleteObjectCommandOutput>;
  send(command: HeadBucketCommand): Promise<HeadBucketCommandOutput>;
}
export interface VerifiedObjectMetadata {
  size_bytes: number;
  content_type: string;
}

export class S3ObjectStore {
  private readonly internal: S3Sender;
  private readonly publicClient: S3Client;
  constructor(
    private readonly config: S3Config,
    clients: { internal?: S3Sender; publicClient?: S3Client } = {},
  ) {
    validateEndpoint(config.endpoint);
    if (config.publicEndpoint) validateEndpoint(config.publicEndpoint);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket))
      throw new Error("invalid S3 bucket");
    if (!config.accessKey || !config.secretKey)
      throw new Error("S3 credentials are required");
    this.internal = clients.internal ?? this.client(config.endpoint);
    this.publicClient =
      clients.publicClient ??
      this.client(config.publicEndpoint ?? config.endpoint);
  }
  static fromEnv(): S3ObjectStore {
    return new S3ObjectStore({
      endpoint: required("VOS_S3_ENDPOINT"),
      publicEndpoint: process.env.VOS_S3_PUBLIC_ENDPOINT,
      region: process.env.VOS_S3_REGION ?? "us-east-1",
      bucket: process.env.VOS_S3_BUCKET ?? "vos-artifacts",
      accessKey: required("VOS_S3_ACCESS_KEY"),
      secretKey: required("VOS_S3_SECRET_KEY"),
    });
  }
  async health():Promise<string>{await this.internal.send(new HeadBucketCommand({Bucket:this.config.bucket}));return this.config.bucket;}
  async presignGet(
    key: string,
    sha256: string,
    expiresSeconds = 300,
    now = new Date(),
  ): Promise<PresignedObjectRequest> {
    validate(key, sha256, expiresSeconds);
    const url = await getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
      { expiresIn: expiresSeconds, signingDate: now },
    );
    return {
      url,
      headers: {},
      expires_at: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
      sha256,
    };
  }
  async presignPut(
    key: string,
    sha256: string,
    contentType: string,
    expiresSeconds = 300,
    now = new Date(),
  ): Promise<PresignedObjectRequest> {
    validate(key, sha256, expiresSeconds);
    const checksum = Buffer.from(sha256, "hex").toString("base64");
    const values: Record<string, string> = {
      "content-type": contentType,
      "x-amz-checksum-sha256": checksum,
      "x-amz-meta-sha256": sha256,
    };
    const url = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
        ChecksumSHA256: checksum,
        Metadata: { sha256 },
      }),
      {
        expiresIn: expiresSeconds,
        signingDate: now,
        signableHeaders: new Set(["content-type"]),
        unhoistableHeaders: new Set([
          "x-amz-checksum-sha256",
          "x-amz-meta-sha256",
        ]),
      },
    );
    const signed = new Set(
      new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [],
    );
    const headers = Object.fromEntries(
      Object.entries(values).filter(([name]) => signed.has(name)),
    );
    return {
      url,
      headers,
      expires_at: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
      sha256,
    };
  }
  async readVerified(
    key: string,
    expectedSha256: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    validate(key, expectedSha256, 300);
    if (!Number.isInteger(maxBytes) || maxBytes < 1)
      throw new Error("verified read limit must be positive");
    const response = await this.internal.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
    );
    if ((response.ContentLength ?? 0) > maxBytes)
      throw new Error("S3 object exceeds verified read limit");
    if (!response.Body) throw new Error("S3 object has no body");
    const bytes = await response.Body.transformToByteArray();
    if (bytes.byteLength > maxBytes)
      throw new Error("S3 object exceeds verified read limit");
    if (hash(bytes) !== expectedSha256)
      throw new Error("S3 object checksum mismatch");
    if (
      response.Metadata?.sha256 &&
      response.Metadata.sha256 !== expectedSha256
    )
      throw new Error("S3 object metadata checksum mismatch");
    return bytes;
  }
  async verifyMetadata(
    key: string,
    expectedSha256: string,
    expectedSize: number,
    expectedContentType: string,
  ): Promise<VerifiedObjectMetadata> {
    validate(key, expectedSha256, 300);
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0)
      throw new Error("expected object size is invalid");
    const response = await this.internal.send(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ChecksumMode: "ENABLED",
      }),
    );
    const size = Number(response.ContentLength);
    if (!Number.isSafeInteger(size) || size !== expectedSize)
      throw new Error("S3 object size mismatch");
    const checksum = response.ChecksumSHA256
      ? Buffer.from(response.ChecksumSHA256, "base64").toString("hex")
      : undefined;
    if (checksum && checksum !== expectedSha256)
      throw new Error("S3 object checksum mismatch");
    if (response.Metadata?.sha256 !== expectedSha256)
      throw new Error("S3 object metadata checksum missing or mismatched");
    if (
      (response.ContentType ?? "application/octet-stream") !==
      expectedContentType
    )
      throw new Error("S3 object content type mismatch");
    return { size_bytes: size, content_type: expectedContentType };
  }
  async putVerified(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ uri: string; sha256: string; size_bytes: number }> {
    validateKey(key);
    if (!contentType || /[\r\n]/.test(contentType))
      throw new Error("invalid object content type");
    const sha256 = hash(bytes);
    const checksum = Buffer.from(sha256, "hex").toString("base64");
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ChecksumSHA256: checksum,
        Metadata: { sha256 },
      }),
    );
    await this.verifyMetadata(key, sha256, bytes.byteLength, contentType);
    return { uri: this.uri(key), sha256, size_bytes: bytes.byteLength };
  }
  async delete(key:string):Promise<void>{validateKey(key);await this.internal.send(new DeleteObjectCommand({Bucket:this.config.bucket,Key:key}));}
  uri(key: string): string {
    validateKey(key);
    return `s3://${this.config.bucket}/${key}`;
  }
  private client(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
}

function validate(key: string, sha256: string, expires: number): void {
  validateKey(key);
  if (!/^[0-9a-f]{64}$/.test(sha256))
    throw new Error("sha256 must be lowercase hexadecimal");
  if (!Number.isInteger(expires) || expires < 1 || expires > 900)
    throw new Error("presigned URL expiry must be between 1 and 900 seconds");
}
function validateKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\0") ||
    key
      .split("/")
      .some((part) => part === "" || part === "." || part === "..") ||
    key.length > 1024
  )
    throw new Error("invalid S3 object key");
}
function hash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function validateEndpoint(raw: string): void {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        !url.hostname.includes("."))
    )
  )
    throw new Error("S3 endpoint must use HTTPS outside an internal hostname");
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
