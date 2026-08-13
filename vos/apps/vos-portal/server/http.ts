import { ZodError } from "zod";
import type { PortalActor } from "vos-core/portal-contracts";
import { AssessmentReviewV1Schema } from "vos-core/portal-contracts";
import {
  AppealSubmitV1Schema,
  AppealTransitionV1Schema,
  AssessmentSubmissionRequestV1Schema,
  CourseGroupMutationV1Schema,
  CourseManifestImportV1Schema,
  CourseManifestPublishV1Schema,
  CourseManifestRollbackV1Schema,
  DesignReviewInputV1Schema,
  DesignSubmissionInputV1Schema,
  EnrollmentCsvImportV1Schema,
  EnrollmentInviteCreateV1Schema,
  EnrollmentInviteRedeemV1Schema,
  ModelCredentialInputV1Schema,
  ModelProviderInputV1Schema,
  ModelQuotaPolicyInputV1Schema,
  NotificationReadV1Schema,
  ObjectUploadRequestV1Schema,
  OAuthProviderInputV1Schema,
  OidcProviderInputV1Schema,
  PipelineRequestV1Schema,
  ProjectProvisionRequestV1Schema,
  RetentionPolicyUpdateV1Schema,
  ReviewActionV1Schema,
  ScoreAdjustmentInputV1Schema,
  ScoreCalculationV1Schema,
  ScoreTransitionV1Schema,
  ServiceTokenCreateV1Schema,
  WorkerEvidenceReportV1Schema,
  WorkerHeartbeatV1Schema,
  WorkerLeaseRequestV1Schema,
  WorkerRunCompleteV1Schema,
  WorkerRunStartV1Schema,
  portalOpenApiDocument,
} from "vos-core/portal-contracts";
import type { CourseState } from "../domain/state-machines.ts";
import { db } from "../storage/database.ts";
import { GiteaClient, verifyGiteaWebhook } from "../storage/gitea.ts";
import { S3ObjectStore } from "../storage/s3.ts";
import { PostgresPortalRepository } from "./postgres-repository.ts";
import { OidcService } from "./oidc.ts";
import { ModelCredentialService } from "./model-credentials.ts";
import { AdminSystemService } from "./admin-system.ts";
import { ModelControlService } from "./model-control.ts";
import { authenticateWorkerRequest } from "./worker-auth.ts";
import { WorkerControlService } from "./worker-control.ts";

function traceId(): string {
  return `trace-${crypto.randomUUID()}`;
}
function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const at = item.indexOf("=");
        return [
          decodeURIComponent(item.slice(0, at)),
          decodeURIComponent(item.slice(at + 1)),
        ];
      }),
  );
}
function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}
function sessionResponse(body: unknown, cookiesToSet: string[]): Response {
  const headers = new Headers();
  for (const cookie of cookiesToSet) headers.append("set-cookie", cookie);
  return json(body, 200, headers);
}
function sessionCookies(token: string, csrf: string): string[] {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    `vos_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`,
    `vos_csrf=${encodeURIComponent(csrf)}; Path=/; SameSite=Strict; Max-Age=43200${secure}`,
  ];
}
function redirect(location: string, cookiesToSet: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookiesToSet) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
async function body(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 2_097_152)
    throw new Unauthorized(413, "请求体超过 2 MiB 限制");
  const source = await request.text();
  if (new TextEncoder().encode(source).byteLength > 2_097_152)
    throw new Unauthorized(413, "请求体超过 2 MiB 限制");
  const value = JSON.parse(source || "null") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("请求体必须是 JSON object");
  return value as Record<string, unknown>;
}
function text(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} is required`);
  return value.trim();
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
async function requestHash(value: unknown): Promise<string> {
  return new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}
function publicOrigin(request: Request): string {
  const configured = process.env.VOS_PORTAL_PUBLIC_ORIGIN;
  if (!configured) {
    if (process.env.NODE_ENV === "production")
      throw new Error("VOS_PORTAL_PUBLIC_ORIGIN is required in production");
    return new URL(request.url).origin;
  }
  const origin = new URL(configured);
  if (origin.protocol !== "https:")
    throw new Error("VOS_PORTAL_PUBLIC_ORIGIN must use HTTPS");
  return origin.origin;
}

export async function createPortalHttpHandler(): Promise<
  (request: Request) => Promise<Response>
> {
  if (process.env.NODE_ENV === "production")
    publicOrigin(new Request("http://localhost"));
  const sql = db();
  const repository = new PostgresPortalRepository(sql);
  const objectStore = S3ObjectStore.fromEnv();
  const webhookSecret = required("VOS_GITEA_WEBHOOK_SECRET");
  const masterKey = required("VOS_PORTAL_MASTER_KEY");
  const oidc = await OidcService.create(sql, masterKey);
  const modelCredentials = await ModelCredentialService.create(sql, masterKey);
  const modelControl = await ModelControlService.create(sql, masterKey);
  const gitea = GiteaClient.fromEnv();
  const adminSystem = new AdminSystemService(sql, gitea, objectStore);
  const workerControl = new WorkerControlService(
    sql,
    required("VOS_GITEA_URL"),
  );
  return async (request) => {
    const url = new URL(request.url);
    const requestedTrace = request.headers.get("x-request-id");
    const trace =
      requestedTrace && /^[A-Za-z0-9._:-]{1,128}$/.test(requestedTrace)
        ? requestedTrace
        : traceId();
    try {
      if (url.pathname === "/api/v1/openapi.json")
        return json(portalOpenApiDocument());
      if (url.pathname.startsWith("/api/v1/"))
        return await api(
          request,
          url,
          repository,
          objectStore,
          gitea,
          webhookSecret,
          oidc,
          modelCredentials,
          modelControl,
          adminSystem,
          workerControl,
          trace,
        );
      return json(
        {
          error: {
            code: "route_not_found",
            message: "API route does not exist",
            trace_id: trace,
          },
        },
        404,
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          trace_id: trace,
          message: error instanceof Error ? error.message : String(error),
          path: url.pathname,
        }),
      );
      const exposed =
        error instanceof Unauthorized || error instanceof ZodError;
      const status =
        error instanceof Unauthorized
          ? error.status
          : error instanceof ZodError
            ? 400
            : 500;
      const message =
        error instanceof Unauthorized
          ? error.message
          : error instanceof ZodError
            ? "请求内容不符合 Portal contract"
            : "请求处理失败，请使用 trace ID 联系管理员。";
      return json(
        {
          error: {
            code: exposed ? "request_rejected" : "internal_error",
            message,
            trace_id: trace,
            ...(error instanceof ZodError
              ? { details: { issues: error.issues } }
              : {}),
          },
        },
        status,
      );
    }
  };
}

class Unauthorized extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type RequestSession = {
  actor: PortalActor;
  token: string;
  kind: "cookie" | "bearer" | "service";
  scopes: string[];
};
async function current(
  request: Request,
  repository: PostgresPortalRepository,
): Promise<RequestSession> {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? cookies(request).vos_session;
  if (!token) throw new Unauthorized(401, "请先登录");
  const authorizationRecord = await repository.authorizationForToken(token);
  if (!authorizationRecord) throw new Unauthorized(401, "会话已失效");
  if (!bearer && authorizationRecord.token_kind !== "web")
    throw new Unauthorized(401, "非 Web token 不能作为 cookie session 使用");
  return {
    actor: authorizationRecord.actor,
    token,
    kind:
      authorizationRecord.token_kind === "service"
        ? "service"
        : bearer
          ? "bearer"
          : "cookie",
    scopes: authorizationRecord.scopes,
  };
}
async function mutationGuard(
  request: Request,
  repository: PostgresPortalRepository,
  session: RequestSession,
): Promise<string> {
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request))
    throw new Unauthorized(403, "跨站请求已拒绝");
  const key = scopedIdempotencyKey(request);
  if (session.kind !== "cookie") return key;
  const csrf = request.headers.get("x-csrf-token");
  if (!csrf || !(await repository.verifyCsrf(session.token, csrf)))
    throw new Unauthorized(403, "CSRF token 无效");
  return key;
}
function unauthenticatedMutationGuard(request: Request): string {
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request))
    throw new Unauthorized(403, "跨站请求已拒绝");
  return scopedIdempotencyKey(request);
}
function scopedIdempotencyKey(request: Request): string {
  const key = request.headers.get("x-idempotency-key");
  if (!key || key.length < 8 || key.length > 128)
    throw new Unauthorized(400, "mutation 必须提供有效的 X-Idempotency-Key");
  const scope = new Bun.CryptoHasher("sha256")
    .update(`${request.method}:${new URL(request.url).pathname}`)
    .digest("hex")
    .slice(0, 16);
  return `${scope}:${key}`;
}
export function enforceServiceScope(
  session: RequestSession,
  route: string,
  method: string,
): void {
  if (session.kind !== "service") return;
  let required: string | undefined;
  if (method === "POST" && route === "/pipelines") required = "pipeline:write";
  else if (
    method === "GET" &&
    (/^\/projects\/[^/]+\/(binding|vos-policy)$/.test(route) ||
      /^\/pipelines\/[^/]+$/.test(route))
  )
    required = "project:read";
  else if (
    (method === "GET" &&
      /^\/pipelines\/[^/]+\/(events|evidence|reproduction)$/.test(route)) ||
    (method === "POST" && /^\/objects\/[^/]+\/download$/.test(route))
  )
    required = "evidence:read";
  if (!required || !session.scopes.includes(required))
    throw new Unauthorized(403, "service token scope 不允许访问该接口");
}

async function api(
  request: Request,
  url: URL,
  repository: PostgresPortalRepository,
  objectStore: S3ObjectStore,
  gitea: GiteaClient,
  webhookSecret: string,
  oidc: OidcService,
  modelCredentials: ModelCredentialService,
  modelControl: ModelControlService,
  adminSystem: AdminSystemService,
  workerControl: WorkerControlService,
  trace: string,
): Promise<Response> {
  const route = url.pathname.slice("/api/v1".length);
  if (route === "/internal/gitea/webhook" && request.method === "POST") {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > 1_048_576)
      throw new Unauthorized(413, "webhook 请求体过大");
    if (
      !verifyGiteaWebhook(
        bytes,
        request.headers.get("x-gitea-signature"),
        webhookSecret,
      )
    )
      throw new Unauthorized(401, "webhook 签名无效");
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const repositoryInfo = payload.repository as
      Record<string, unknown> | undefined;
    const fullName = repositoryInfo?.full_name;
    if (typeof fullName !== "string" || !fullName)
      throw new Unauthorized(400, "webhook 缺少 repository.full_name");
    const delivery = request.headers.get("x-gitea-delivery");
    const eventType = request.headers.get("x-gitea-event");
    if (!delivery || eventType !== "push")
      throw new Unauthorized(400, "仅接受带 delivery ID 的 Gitea push 事件");
    const refName = payload.ref;
    const before = payload.before;
    const after = payload.after;
    if (
      typeof refName !== "string" ||
      !/^refs\/(heads|tags)\/[A-Za-z0-9._\/-]{1,240}$/.test(refName) ||
      typeof after !== "string" ||
      !/^[0-9a-f]{40,64}$/.test(after) ||
      (before !== undefined &&
        (typeof before !== "string" || !/^[0-9a-f]{40,64}$/.test(before)))
    )
      throw new Unauthorized(400, "Gitea push ref 或 commit SHA 无效");
    const resolvedAfter = refName.startsWith("refs/tags/")
      ? await gitea.resolvePushCommit(fullName, refName)
      : after;
    const pusher = payload.pusher as Record<string, unknown> | undefined;
    const sender = payload.sender as Record<string, unknown> | undefined;
    const username =
      typeof pusher?.username === "string"
        ? pusher.username
        : typeof sender?.login === "string"
          ? sender.login
          : undefined;
    const accepted = await repository.recordGiteaWebhook(
      {
        delivery_id: delivery,
        event_type: "push",
        repository_full_name: fullName,
        ref_name: refName,
        before_sha: before as string | undefined,
        after_sha: resolvedAfter,
        pusher_username: username,
        payload,
      },
      trace,
    );
    return json({ accepted, duplicate: !accepted }, accepted ? 202 : 200);
  }
  if (route.startsWith("/internal/worker/") && request.method === "POST") {
    const workerId = authenticateWorkerRequest(request);
    if (!workerId)
      throw new Unauthorized(401, "worker control credential 无效");
    if (route === "/internal/worker/lease") {
      const input = WorkerLeaseRequestV1Schema.parse(await body(request));
      if (input.worker_id !== workerId)
        throw new Unauthorized(403, "worker identity 不匹配");
      return json(await workerControl.lease(workerId));
    }
    if (route === "/internal/worker/heartbeat") {
      const input = WorkerHeartbeatV1Schema.parse(await body(request));
      if (input.worker_id !== workerId)
        throw new Unauthorized(403, "worker identity 不匹配");
      return json(await workerControl.heartbeat(input));
    }
    const workerRun = route.match(
      /^\/internal\/worker\/runs\/([^/]+)\/(start|evidence|complete)$/,
    );
    if (!workerRun) throw new Unauthorized(404, "worker control route 不存在");
    const runId = decodeURIComponent(workerRun[1]);
    if (workerRun[2] === "start") {
      const input = WorkerRunStartV1Schema.parse(await body(request));
      if (input.worker_id !== workerId)
        throw new Unauthorized(403, "worker identity 不匹配");
      return json(await workerControl.start(runId, input));
    }
    if (workerRun[2] === "evidence") {
      const input = WorkerEvidenceReportV1Schema.parse(await body(request));
      if (input.worker_id !== workerId)
        throw new Unauthorized(403, "worker identity 不匹配");
      for (const object of input.objects) {
        if (object.uri !== objectStore.uri(object.key))
          throw new Unauthorized(400, "worker object URI 与对象键不匹配");
        await objectStore.verifyMetadata(
          object.key,
          object.sha256,
          object.size_bytes,
          object.content_type,
        );
      }
      return json(await workerControl.reportEvidence(runId, input));
    }
    const input = WorkerRunCompleteV1Schema.parse(await body(request));
    if (input.worker_id !== workerId)
      throw new Unauthorized(403, "worker identity 不匹配");
    return json(await workerControl.complete(runId, input));
  }
  if (route === "/auth/login" && request.method === "POST") {
    const key = unauthenticatedMutationGuard(request);
    const input = await body(request);
    const result = await repository.authenticate(
      {
        username: text(input.username, "username"),
        password: text(input.password, "password"),
      },
      key,
    );
    return sessionResponse(
      result.actor,
      sessionCookies(result.token, result.csrf),
    );
  }
  if (route === "/auth/oidc/providers" && request.method === "GET")
    return json(await oidc.providers());
  if (route === "/auth/oauth/providers" && request.method === "GET")
    return json(await oidc.oauthProviders());
  const oidcStart = route.match(/^\/auth\/oidc\/([^/]+)\/start$/);
  if (oidcStart && request.method === "GET") {
    const providerId = decodeURIComponent(oidcStart[1]);
    const callback = `${publicOrigin(request)}/api/v1/auth/oidc/${encodeURIComponent(providerId)}/callback`;
    const authorization = await oidc.start(
      providerId,
      callback,
      url.searchParams.get("return_to") ?? "/workspace",
    );
    return redirect(authorization.toString());
  }
  const oidcCallback = route.match(/^\/auth\/oidc\/([^/]+)\/callback$/);
  if (oidcCallback && request.method === "GET") {
    const providerId = decodeURIComponent(oidcCallback[1]);
    const externalUrl = new URL(
      `${publicOrigin(request)}${url.pathname}${url.search}`,
    );
    const result = await oidc.callback(providerId, externalUrl);
    return redirect(
      result.return_to,
      sessionCookies(result.token, result.csrf),
    );
  }
  const oauthStart = route.match(/^\/auth\/oauth\/([^/]+)\/start$/);
  if (oauthStart && request.method === "GET") {
    const providerId = decodeURIComponent(oauthStart[1]);
    const callback = `${publicOrigin(request)}/api/v1/auth/oauth/${encodeURIComponent(providerId)}/callback`;
    const authorization = await oidc.startOAuth(
      providerId,
      callback,
      url.searchParams.get("return_to") ?? "/workspace",
    );
    return redirect(authorization.toString());
  }
  const oauthCallback = route.match(/^\/auth\/oauth\/([^/]+)\/callback$/);
  if (oauthCallback && request.method === "GET") {
    const providerId = decodeURIComponent(oauthCallback[1]);
    const externalUrl = new URL(
      `${publicOrigin(request)}${url.pathname}${url.search}`,
    );
    const result = await oidc.callbackOAuth(providerId, externalUrl);
    return redirect(
      result.return_to,
      sessionCookies(result.token, result.csrf),
    );
  }
  if (route === "/auth/device/code" && request.method === "POST") {
    const key = unauthenticatedMutationGuard(request);
    const input = await body(request);
    const clientName = text(input.client_name, "client_name");
    const created = await repository.createDeviceAuthorization(
      clientName,
      key,
      await requestHash({ client_name: clientName }),
    );
    return json(
      {
        ...created,
        verification_uri: new URL(
          created.verification_uri,
          publicOrigin(request),
        ).toString(),
      },
      201,
    );
  }
  if (route === "/auth/device/token" && request.method === "POST") {
    const input = await body(request);
    const exchanged = await repository.exchangeDeviceCode(
      text(input.device_code, "device_code"),
    );
    return json(
      exchanged,
      exchanged.status === "approved"
        ? 200
        : exchanged.status === "authorization_pending"
          ? 428
          : 400,
    );
  }
  const session = await current(request, repository);
  enforceServiceScope(session, route, request.method);
  if (route === "/auth/me" && request.method === "GET")
    return json(session.actor);
  if (route === "/auth/logout" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const result = await repository.revoke(
      session.actor,
      session.token,
      "user logged out",
      trace,
      key,
      await requestHash({ operation: "logout" }),
    );
    return json(result, 200, {
      "set-cookie": "vos_session=; Path=/; HttpOnly; Max-Age=0",
    });
  }
  if (route === "/auth/revoke" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    return json(
      await repository.revoke(
        session.actor,
        session.token,
        "user revoked current token",
        trace,
        key,
        await requestHash({ operation: "revoke" }),
      ),
    );
  }
  if (route === "/auth/service-tokens" && request.method === "GET") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可查看 service token");
    return json(await repository.serviceTokens(session.actor));
  }
  if (route === "/auth/service-tokens" && request.method === "POST") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可创建 service token");
    const key = await mutationGuard(request, repository, session);
    const input = ServiceTokenCreateV1Schema.parse(await body(request));
    return json(
      await repository.createServiceToken(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const revokeServiceToken = route.match(
    /^\/auth\/service-tokens\/([^/]+)\/revoke$/,
  );
  if (revokeServiceToken && request.method === "POST") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可撤销 service token");
    const key = await mutationGuard(request, repository, session);
    const input = await body(request);
    const tokenId = decodeURIComponent(revokeServiceToken[1]);
    const reason = text(input.reason, "reason");
    return json(
      await repository.revokeServiceToken(
        session.actor,
        tokenId,
        reason,
        trace,
        key,
        await requestHash({ token_id: tokenId, reason }),
      ),
    );
  }
  if (route === "/auth/device/approve" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = await body(request);
    const userCode = text(input.user_code, "user_code");
    return json(
      await repository.approveDevice(
        session.actor,
        userCode,
        trace,
        key,
        await requestHash({ user_code: userCode }),
      ),
    );
  }
  if (route === "/admin/oidc/providers" && request.method === "GET") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可查看 OIDC 配置");
    return json(await oidc.providers(true));
  }
  if (route === "/admin/oidc/providers" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = OidcProviderInputV1Schema.parse(await body(request));
    return json(
      await oidc.saveProvider(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/admin/oauth/providers" && request.method === "GET") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可查看 OAuth 配置");
    return json(await oidc.oauthProviders(true));
  }
  if (route === "/admin/oauth/providers" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = OAuthProviderInputV1Schema.parse(await body(request));
    return json(
      await oidc.saveOAuthProvider(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/admin/model-providers" && request.method === "GET") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可查看模型 Provider");
    return json(await modelControl.providers(session.actor));
  }
  if (route === "/admin/model-providers" && request.method === "PUT") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可配置模型 Provider");
    const key = await mutationGuard(request, repository, session);
    const input = ModelProviderInputV1Schema.parse(await body(request));
    return json(
      await modelControl.saveProvider(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/admin/model-quotas" && request.method === "GET") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可查看模型额度");
    return json(await modelControl.quotas(session.actor));
  }
  if (route === "/admin/model-quotas" && request.method === "PUT") {
    if (session.actor.role !== "admin")
      throw new Unauthorized(403, "仅管理员可配置模型额度");
    const key = await mutationGuard(request, repository, session);
    const input = ModelQuotaPolicyInputV1Schema.parse(await body(request));
    return json(
      await modelControl.saveQuota(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/admin/system/status" && request.method === "GET")
    return json(await adminSystem.status(session.actor));
  if (route === "/admin/retention" && request.method === "GET")
    return json(await adminSystem.retention(session.actor));
  if (route === "/admin/retention" && request.method === "PUT") {
    const key = await mutationGuard(request, repository, session);
    const input = RetentionPolicyUpdateV1Schema.parse(await body(request));
    return json(
      await adminSystem.updateRetention(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/contexts" && request.method === "GET")
    return json(await repository.contexts(session.actor));
  if (route === "/dashboard" && request.method === "GET")
    return json(
      await repository.dashboard(
        session.actor,
        url.searchParams.get("project_id") ?? undefined,
      ),
    );
  const notification = route.match(/^\/notifications\/([^/]+)$/);
  if (notification && request.method === "PATCH") {
    const key = await mutationGuard(request, repository, session);
    const input = NotificationReadV1Schema.parse(await body(request));
    const notificationId = decodeURIComponent(notification[1]);
    if (input.notification_id !== notificationId)
      throw new Unauthorized(400, "通知路径与请求体不一致");
    return json(
      await repository.setNotificationRead(
        session.actor,
        notificationId,
        input.read,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/courses/import/dry-run" && request.method === "POST")
    return json(
      await repository.dryRunCourseManifest(session.actor, await body(request)),
    );
  if (route === "/courses/import" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = CourseManifestImportV1Schema.parse(await body(request));
    return json(
      await repository.importCourseManifest(
        session.actor,
        input.manifest,
        input.reason,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const courseVersions = route.match(/^\/courses\/([^/]+)\/versions$/);
  if (courseVersions && request.method === "GET")
    return json(
      await repository.courseManifestVersions(
        session.actor,
        decodeURIComponent(courseVersions[1]),
      ),
    );
  const courseOperations = route.match(/^\/courses\/([^/]+)\/operations$/);
  if (courseOperations && request.method === "GET")
    return json(
      await repository.courseOperations(
        session.actor,
        decodeURIComponent(courseOperations[1]),
      ),
    );
  const coursePublish = route.match(/^\/courses\/([^/]+)\/publish$/);
  if (coursePublish && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = CourseManifestPublishV1Schema.parse(await body(request));
    return json(
      await repository.publishCourseManifest(
        session.actor,
        decodeURIComponent(coursePublish[1]),
        input.manifest_version,
        input.reason,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  const courseRollback = route.match(/^\/courses\/([^/]+)\/rollback$/);
  if (courseRollback && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = CourseManifestRollbackV1Schema.parse(await body(request));
    return json(
      await repository.rollbackCourseManifest(
        session.actor,
        decodeURIComponent(courseRollback[1]),
        input.target_manifest_version,
        input.reason,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  const courseState = route.match(/^\/courses\/([^/]+)\/state$/);
  if (courseState && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = await body(request);
    const target = text(input.target, "target") as CourseState;
    const reason = text(input.reason, "reason");
    return json({
      status: await repository.transitionCourseState(
        session.actor,
        decodeURIComponent(courseState[1]),
        target,
        reason,
        trace,
        key,
        await requestHash({ target, reason }),
      ),
    });
  }
  if (route === "/enrollment/csv" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = EnrollmentCsvImportV1Schema.parse(await body(request));
    return json(
      await repository.importEnrollmentCsv(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/enrollment/invites/redeem" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = EnrollmentInviteRedeemV1Schema.parse(await body(request));
    return json(
      await repository.redeemEnrollmentInvite(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/enrollment/invites" && request.method === "GET")
    return json(
      await repository.enrollmentInvites(
        session.actor,
        text(url.searchParams.get("course_id"), "course_id"),
      ),
    );
  if (route === "/enrollment/invites" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = EnrollmentInviteCreateV1Schema.parse(await body(request));
    return json(
      await repository.createEnrollmentInvite(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const courseGroups = route.match(/^\/courses\/([^/]+)\/groups$/);
  if (courseGroups && request.method === "GET")
    return json(
      await repository.courseGroups(
        session.actor,
        decodeURIComponent(courseGroups[1]),
      ),
    );
  if (courseGroups && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const courseId = decodeURIComponent(courseGroups[1]);
    const input = CourseGroupMutationV1Schema.parse(await body(request));
    return json(
      await repository.createCourseGroup(
        session.actor,
        courseId,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const courseGroup = route.match(/^\/courses\/([^/]+)\/groups\/([^/]+)$/);
  if (courseGroup && request.method === "PUT") {
    const key = await mutationGuard(request, repository, session);
    const courseId = decodeURIComponent(courseGroup[1]);
    const groupId = decodeURIComponent(courseGroup[2]);
    const input = CourseGroupMutationV1Schema.parse(await body(request));
    return json(
      await repository.updateCourseGroup(
        session.actor,
        courseId,
        groupId,
        input,
        trace,
        key,
        await requestHash({ ...input, group_id: groupId }),
      ),
    );
  }
  if (route === "/projects/provisioning/options" && request.method === "GET")
    return json(await repository.projectProvisionOptions(session.actor));
  if (route === "/projects" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = ProjectProvisionRequestV1Schema.parse(await body(request));
    const options = await repository.projectProvisionOptions(session.actor);
    if (!options.experiments.some((item) => item.id === input.experiment_id))
      throw new Unauthorized(403, "实验版本不存在或无课程管理权限");
    return json(
      await repository.createProject(
        session.actor,
        input,
        key,
        await requestHash(input),
        trace,
      ),
      202,
    );
  }
  const provisioning = route.match(/^\/projects\/([^/]+)\/provisioning$/);
  if (provisioning && request.method === "GET") {
    const projectId = decodeURIComponent(provisioning[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    return json(await repository.projectProvisioning(session.actor, projectId));
  }
  const retryProvision = route.match(/^\/projects\/([^/]+)\/provision\/retry$/);
  if (retryProvision && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const projectId = decodeURIComponent(retryProvision[1]);
    await repository.assertProjectAccess(session.actor, projectId, "teacher");
    const input = await body(request);
    const reason = text(input.reason, "reason");
    return json(
      await repository.retryProjectProvisioning(
        session.actor,
        projectId,
        reason,
        trace,
        key,
        await requestHash({ reason }),
      ),
      202,
    );
  }
  const binding = route.match(/^\/projects\/([^/]+)\/binding$/);
  if (binding && request.method === "GET") {
    const projectId = decodeURIComponent(binding[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    return json(await repository.projectBinding(session.actor, projectId));
  }
  const designSubmissions = route.match(
    /^\/projects\/([^/]+)\/design-submissions$/,
  );
  if (designSubmissions && request.method === "GET") {
    const projectId = decodeURIComponent(designSubmissions[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    return json(await repository.designSubmissions(session.actor, projectId));
  }
  if (designSubmissions && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const projectId = decodeURIComponent(designSubmissions[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    const input = DesignSubmissionInputV1Schema.parse({
      ...(await body(request)),
      project_id: projectId,
    });
    return json(
      await repository.submitDesign(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const designReview = route.match(/^\/design-submissions\/([^/]+)\/review$/);
  if (designReview && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const submissionId = decodeURIComponent(designReview[1]);
    const input = DesignReviewInputV1Schema.parse({
      ...(await body(request)),
      submission_id: submissionId,
    });
    await repository.assertDesignReviewAccess(
      session.actor,
      submissionId,
      input.target_status === "frozen" ? "teacher" : "staff",
    );
    return json(
      await repository.reviewDesign(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  const policy = route.match(/^\/projects\/([^/]+)\/vos-policy$/);
  if (policy && request.method === "GET") {
    const projectId = decodeURIComponent(policy[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    return json(await repository.projectPolicy(session.actor, projectId));
  }
  const objects = route.match(/^\/projects\/([^/]+)\/objects\/manifest$/);
  if (objects && request.method === "GET") {
    const projectId = decodeURIComponent(objects[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    return json(await repository.objectManifest(session.actor, projectId));
  }
  const createObject = route.match(/^\/projects\/([^/]+)\/objects\/uploads$/);
  if (createObject && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const projectId = decodeURIComponent(createObject[1]);
    await repository.assertProjectAccess(session.actor, projectId, "read");
    const input = ObjectUploadRequestV1Schema.parse(await body(request));
    const hash = await requestHash({ ...input, project_id: projectId });
    const objectId = `object-${crypto.randomUUID()}`;
    const objectKey = `projects/${projectId}/${input.run_id ? `runs/${input.run_id}` : "uploads"}/${objectId}`;
    const registered = await repository.registerObject(
      session.actor,
      {
        project_id: projectId,
        run_id: input.run_id,
        object_id: objectId,
        object_key: objectKey,
        uri: objectStore.uri(objectKey),
        sha256: input.sha256,
        size_bytes: input.size_bytes,
        content_type: input.content_type,
        visibility: input.visibility,
        label: input.label,
        lineage: input.lineage,
      },
      trace,
      key,
      hash,
    );
    const upload = await objectStore.presignPut(
      registered.object_key,
      input.sha256,
      input.content_type,
    );
    return json({ object_id: registered.object_id, upload }, 201);
  }
  const completeObject = route.match(/^\/objects\/([^/]+)\/complete$/);
  if (completeObject && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const objectId = decodeURIComponent(completeObject[1]);
    await repository.assertObjectAccess(session.actor, objectId);
    const hash = await requestHash({ object_id: objectId });
    const cached = await repository.cachedMutation<{
      ok: true;
      object_id: string;
    }>(session.actor, key, hash);
    if (cached) return json(cached);
    const pending = await repository.pendingObject(session.actor, objectId);
    await objectStore.verifyMetadata(
      pending.object_key,
      pending.sha256,
      pending.size_bytes,
      pending.content_type,
    );
    return json(
      await repository.completeObject(
        session.actor,
        objectId,
        trace,
        key,
        hash,
      ),
    );
  }
  const downloadObject = route.match(/^\/objects\/([^/]+)\/download$/);
  if (downloadObject && request.method === "POST") {
    await mutationGuard(request, repository, session);
    const objectId = decodeURIComponent(downloadObject[1]);
    await repository.assertObjectAccess(session.actor, objectId);
    const object = await repository.objectForDownload(session.actor, objectId);
    return json(await objectStore.presignGet(object.object_key, object.sha256));
  }
  const evidence = route.match(/^\/pipelines\/([^/]+)\/evidence$/);
  if (evidence && request.method === "GET") {
    const runId = decodeURIComponent(evidence[1]);
    await repository.assertRunAccess(session.actor, runId, "read");
    return json(await repository.evidence(session.actor, runId));
  }
  const assessment = route.match(/^\/submissions\/([^/]+)$/);
  if (assessment && request.method === "GET")
    return json(
      await repository.assessmentSubmission(
        session.actor,
        decodeURIComponent(assessment[1]),
      ),
    );
  const assessmentReview = route.match(/^\/submissions\/([^/]+)\/review$/);
  if (assessmentReview && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const submissionId = decodeURIComponent(assessmentReview[1]);
    const input = AssessmentReviewV1Schema.parse({
      ...(await body(request)),
      submission_id: submissionId,
    });
    return json(
      await repository.reviewAssessmentSubmission(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
    );
  }
  if (route === "/submissions" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = AssessmentSubmissionRequestV1Schema.parse(
      await body(request),
    );
    return json(
      await repository.createAssessmentSubmission(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      202,
    );
  }
  const reproduction = route.match(/^\/pipelines\/([^/]+)\/reproduction$/);
  if (reproduction && request.method === "GET") {
    const runId = decodeURIComponent(reproduction[1]);
    await repository.assertRunAccess(session.actor, runId, "read");
    return json(await repository.reproduction(session.actor, runId));
  }
  const pipeline = route.match(/^\/pipelines\/([^/]+)$/);
  if (pipeline && request.method === "GET") {
    const runId = decodeURIComponent(pipeline[1]);
    await repository.assertRunAccess(session.actor, runId, "read");
    return json(await repository.pipeline(session.actor, runId));
  }
  const events = route.match(/^\/pipelines\/([^/]+)\/events$/);
  if (events && request.method === "GET") {
    const runId = decodeURIComponent(events[1]);
    await repository.assertRunAccess(session.actor, runId, "read");
    return pipelineEventStream(
      request,
      repository,
      session.actor,
      runId,
      Number(url.searchParams.get("after") ?? -1),
    );
  }
  const cancel = route.match(/^\/pipelines\/([^/]+)\/cancel$/);
  if (cancel && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const runId = decodeURIComponent(cancel[1]);
    await repository.assertRunAccess(session.actor, runId, "read");
    const input = await body(request);
    const reason = text(input.reason, "reason");
    return json(
      await repository.cancelPipeline(
        session.actor,
        runId,
        reason,
        trace,
        key,
        await requestHash({ run_id: runId, reason }),
      ),
      202,
    );
  }
  if (route === "/pipelines" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = PipelineRequestV1Schema.parse(await body(request));
    await repository.assertProjectAccess(
      session.actor,
      input.project_id,
      input.scope === "public" && !input.retry_of ? "read" : "staff",
    );
    return json(
      await repository.trigger(
        session.actor,
        input,
        key,
        await requestHash(input),
        trace,
      ),
      202,
    );
  }
  if (route === "/reviews" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const review = ReviewActionV1Schema.parse(await body(request));
    await repository.review(
      session.actor,
      review,
      trace,
      key,
      await requestHash(review),
    );
    return json({ ok: true });
  }
  if (route === "/grades/calculate" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = ScoreCalculationV1Schema.parse(await body(request));
    return json(
      await repository.calculateScore(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  if (route === "/grades/adjust" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = ScoreAdjustmentInputV1Schema.parse(await body(request));
    return json(
      await repository.adjustScore(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  if (route === "/grades/transition" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = ScoreTransitionV1Schema.parse(await body(request));
    return json(
      await repository.transitionScore(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  if (route === "/appeals" && request.method === "GET")
    return json(
      await repository.appeals(
        session.actor,
        text(url.searchParams.get("project_id"), "project_id"),
      ),
    );
  if (route === "/appeals" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = AppealSubmitV1Schema.parse(await body(request));
    return json(
      await repository.submitAppeal(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const appealTransition = route.match(/^\/appeals\/([^/]+)\/transition$/);
  if (appealTransition && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const parsed = AppealTransitionV1Schema.parse({
      ...(await body(request)),
      appeal_id: decodeURIComponent(appealTransition[1]),
    });
    return json(
      await repository.transitionAppeal(
        session.actor,
        parsed,
        trace,
        key,
        await requestHash(parsed),
      ),
      201,
    );
  }
  if (route === "/ai/qa" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = await body(request);
    const parsed = {
      content: text(input.content, "content"),
      project_id: text(input.project_id, "project_id"),
    };
    return json(
      await repository.ask(
        session.actor,
        parsed,
        trace,
        key,
        await requestHash(parsed),
      ),
      202,
    );
  }
  const qaEvents = route.match(/^\/ai\/qa\/([^/]+)\/events$/);
  if (qaEvents && request.method === "GET") {
    const afterCount = Number(url.searchParams.get("after_count") ?? "0");
    if (!Number.isInteger(afterCount) || afterCount < 0)
      throw new Unauthorized(400, "after_count 必须是非负整数");
    return qaEventStream(
      request,
      repository,
      session.actor,
      decodeURIComponent(qaEvents[1]),
      afterCount,
    );
  }
  const qaThread = route.match(/^\/ai\/qa\/([^/]+)$/);
  if (qaThread && request.method === "GET")
    return json(
      await repository.qaThread(session.actor, decodeURIComponent(qaThread[1])),
    );
  if (route === "/ai/audits" && request.method === "GET")
    return json(await repository.agentAudits(session.actor));
  if (route === "/ai/credentials" && request.method === "GET")
    return json(await modelCredentials.list(session.actor));
  if (route === "/ai/credentials" && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = ModelCredentialInputV1Schema.parse(await body(request));
    return json(
      await modelCredentials.save(
        session.actor,
        input,
        trace,
        key,
        await requestHash(input),
      ),
      201,
    );
  }
  const revokeCredential = route.match(/^\/ai\/credentials\/([^/]+)\/revoke$/);
  if (revokeCredential && request.method === "POST") {
    const key = await mutationGuard(request, repository, session);
    const input = await body(request);
    const reason = text(input.reason, "reason");
    const credentialId = decodeURIComponent(revokeCredential[1]);
    return json(
      await modelCredentials.revoke(
        session.actor,
        credentialId,
        reason,
        trace,
        key,
        await requestHash({ credential_id: credentialId, reason }),
      ),
    );
  }
  throw new Unauthorized(404, "接口不存在");
}
function pipelineEventStream(
  request: Request,
  repository: PostgresPortalRepository,
  actor: PortalActor,
  runId: string,
  initialAfter: number,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let after = Number.isFinite(initialAfter) ? initialAfter : -1;
      try {
        while (!cancelled && !request.signal.aborted) {
          const events = await repository.pipelineEvents(actor, runId, after);
          for (const event of events) {
            after = event.sequence;
            controller.enqueue(
              encoder.encode(
                `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          }
          const summary = await repository.pipeline(actor, runId);
          if (
            ["passed", "failed", "cancelled", "timed_out"].includes(
              summary.status,
            )
          ) {
            controller.close();
            return;
          }
          if (!events.length)
            controller.enqueue(encoder.encode(`: keepalive\n\n`));
          await Bun.sleep(1000);
        }
        controller.close();
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "pipeline_event_stream_failed",
            run_id: runId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
function qaEventStream(
  request: Request,
  repository: PostgresPortalRepository,
  actor: PortalActor,
  threadId: string,
  afterCount: number,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let count = afterCount;
      try {
        while (!cancelled && !request.signal.aborted) {
          const thread = await repository.qaThread(actor, threadId);
          if (thread.messages.length !== count) {
            count = thread.messages.length;
            controller.enqueue(
              encoder.encode(
                `event: thread\ndata: ${JSON.stringify(thread)}\n\n`,
              ),
            );
          }
          if (
            thread.messages.length > afterCount &&
            thread.messages.at(-1)?.role === "assistant"
          ) {
            controller.close();
            return;
          }
          if (thread.messages.length === count)
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          await Bun.sleep(1000);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
