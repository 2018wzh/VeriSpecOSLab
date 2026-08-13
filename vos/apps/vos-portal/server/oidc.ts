import type { Sql } from "postgres";
import * as client from "openid-client";
import type {
  OAuthProviderInputV1,
  OAuthProviderSummaryV1,
  OidcProviderInputV1,
  OidcProviderSummaryV1,
  PortalActor,
} from "vos-core/portal-contracts";
import {
  OAuthProviderInputV1Schema,
  OAuthProviderSummaryV1Schema,
  OidcProviderInputV1Schema,
  OidcProviderSummaryV1Schema,
} from "vos-core/portal-contracts";
import { EnvelopeEncryption } from "../storage/envelope.ts";

type Row = Record<string, unknown>;
type OidcFetch = NonNullable<
  client.DiscoveryRequestOptions[typeof client.customFetch]
>;
type ProviderInput = OidcProviderInputV1 | OAuthProviderInputV1;
type ProviderSummary = OidcProviderSummaryV1 | OAuthProviderSummaryV1;

async function hash(value: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function identifier(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function bytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  throw new Error("encrypted OAuth value is not binary");
}

function claim(
  claims: Record<string, unknown>,
  name: string,
  fallback?: string,
): string {
  const value = claims[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (fallback !== undefined) return fallback;
  throw new Error(`identity claim ${name} is required`);
}

function httpsEndpoint(value: unknown, name: string): string {
  if (typeof value !== "string")
    throw new Error(`OAuth provider ${name} is not configured`);
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error(`OAuth provider ${name} must use HTTPS`);
  return url.toString();
}

function validatedReturnTo(value: string): string {
  if (!/^\/[a-zA-Z0-9/_-]*$/.test(value))
    throw new Error("OAuth return_to must be a local absolute path");
  return value;
}

function validatedRedirectUri(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error("OAuth redirect_uri must use HTTPS");
  return url.toString();
}

function isOAuthProvider(row: Row): boolean {
  return row.authorization_endpoint !== null && row.authorization_endpoint !== undefined;
}

export async function consumeOidcAuthorization(
  sql: Sql,
  providerId: string,
  state: string,
): Promise<Row> {
  const rows = await sql.begin(
    async (tx) =>
      await tx`
        update oidc_authorizations
        set consumed_at=now()
        where state_hash=${await hash(state)}
          and provider_id=${providerId}
          and consumed_at is null
          and expires_at>now()
        returning *
      `,
  );
  const authorization = rows[0] as Row | undefined;
  if (!authorization)
    throw new Error("OAuth state is invalid, expired, or already consumed");
  return authorization;
}

export class OidcService {
  private constructor(
    private readonly sql: Sql,
    private readonly envelope: EnvelopeEncryption,
    private readonly fetchImpl?: OidcFetch,
  ) {}

  static async create(
    sql: Sql,
    masterKey: string,
    options: { fetch?: OidcFetch } = {},
  ): Promise<OidcService> {
    return new OidcService(
      sql,
      await EnvelopeEncryption.fromBase64Url(masterKey),
      options.fetch,
    );
  }

  private async discoverOidc(
    provider: Row,
    secret: string,
  ): Promise<client.Configuration> {
    return client.discovery(
      new URL(String(provider.issuer)),
      String(provider.client_id),
      secret,
      undefined,
      this.fetchImpl ? { [client.customFetch]: this.fetchImpl } : undefined,
    );
  }

  private oauthConfiguration(
    provider: Row,
    secret: string,
  ): client.Configuration {
    const metadata = {
      issuer: httpsEndpoint(provider.issuer, "issuer"),
      authorization_endpoint: httpsEndpoint(
        provider.authorization_endpoint,
        "authorization_endpoint",
      ),
      token_endpoint: httpsEndpoint(provider.token_endpoint, "token_endpoint"),
      userinfo_endpoint: httpsEndpoint(
        provider.userinfo_endpoint,
        "userinfo_endpoint",
      ),
    } as client.ServerMetadata;
    const configuration = new client.Configuration(
      metadata,
      String(provider.client_id),
      secret,
    );
    if (this.fetchImpl) configuration[client.customFetch] = this.fetchImpl;
    return configuration;
  }

  async saveProvider(
    current: PortalActor,
    raw: OidcProviderInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<OidcProviderSummaryV1> {
    const input = OidcProviderInputV1Schema.parse(raw);
    return this.saveConfiguredProvider(
      current,
      input,
      traceId,
      idempotencyKey,
      requestHash,
      "oidc",
    ) as Promise<OidcProviderSummaryV1>;
  }

  async saveOAuthProvider(
    current: PortalActor,
    raw: OAuthProviderInputV1,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<OAuthProviderSummaryV1> {
    const input = OAuthProviderInputV1Schema.parse(raw);
    return this.saveConfiguredProvider(
      current,
      input,
      traceId,
      idempotencyKey,
      requestHash,
      "oauth",
    ) as Promise<OAuthProviderSummaryV1>;
  }

  private async saveConfiguredProvider(
    current: PortalActor,
    input: ProviderInput,
    traceId: string,
    idempotencyKey: string,
    requestHash: string,
    protocol: "oidc" | "oauth",
  ): Promise<ProviderSummary> {
    if (current.role !== "admin") throw new Error("admin access required");
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${current.id}:${idempotencyKey}`}))`;
      const existing = await tx`
        select request_hash,response
        from idempotency_keys
        where actor_id=${current.id} and key=${idempotencyKey} and expires_at>now()
      `;
      if (existing[0]) {
        if (existing[0].request_hash !== requestHash)
          throw new Error("幂等键已被不同请求使用");
        return protocol === "oauth"
          ? OAuthProviderSummaryV1Schema.parse(existing[0].response)
          : OidcProviderSummaryV1Schema.parse(existing[0].response);
      }
      const sealed = await this.envelope.seal(
        input.client_secret,
        `oidc-provider:${input.id}`,
      );
      const isOauth = protocol === "oauth";
      const oauthInput = isOauth ? (input as OAuthProviderInputV1) : undefined;
      const rows = await tx`
        insert into oidc_providers(
          id,name,issuer,authorization_endpoint,token_endpoint,userinfo_endpoint,
          subject_claim,client_id,client_secret_cipher,client_secret_iv,scopes,
          username_claim,display_name_claim,role_claim,role_mappings,default_role,enabled
        ) values(
          ${input.id},${input.name},${input.issuer},
          ${oauthInput?.authorization_endpoint ?? null},
          ${oauthInput?.token_endpoint ?? null},
          ${oauthInput?.userinfo_endpoint ?? null},
          ${oauthInput?.subject_claim ?? null},
          ${input.client_id},${sealed.cipher},${sealed.iv},${input.scopes},
          ${input.username_claim},${input.display_name_claim},${input.role_claim ?? null},
          ${tx.json(input.role_mappings)},${input.default_role},${input.enabled}
        )
        on conflict(id) do update set
          name=excluded.name,
          issuer=excluded.issuer,
          authorization_endpoint=excluded.authorization_endpoint,
          token_endpoint=excluded.token_endpoint,
          userinfo_endpoint=excluded.userinfo_endpoint,
          subject_claim=excluded.subject_claim,
          client_id=excluded.client_id,
          client_secret_cipher=excluded.client_secret_cipher,
          client_secret_iv=excluded.client_secret_iv,
          scopes=excluded.scopes,
          username_claim=excluded.username_claim,
          display_name_claim=excluded.display_name_claim,
          role_claim=excluded.role_claim,
          role_mappings=excluded.role_mappings,
          default_role=excluded.default_role,
          enabled=excluded.enabled,
          version=oidc_providers.version+1,
          updated_at=now()
        returning *
      `;
      const row = rows[0] as Row;
      await tx`
        insert into audit_events(
          id,actor_id,action,resource_type,resource_id,reason,trace_id,payload
        ) values(
          ${identifier("audit")},${current.id},
          ${isOauth ? "oauth.provider.upsert" : "oidc.provider.upsert"},
          'auth_provider',${input.id},${input.reason},${traceId},
          ${tx.json({
            issuer: input.issuer,
            client_id: input.client_id,
            protocol,
            enabled: input.enabled,
          })}
        )
      `;
      const response = isOauth
        ? this.oauthSummary(row)
        : this.oidcSummary(row);
      await tx`
        insert into idempotency_keys(
          actor_id,key,request_hash,status_code,response,expires_at
        ) values(
          ${current.id},${idempotencyKey},${requestHash},200,
          ${tx.json(response)},now()+interval '24 hours'
        )
      `;
      return response;
    });
  }

  async providers(includeDisabled = false): Promise<OidcProviderSummaryV1[]> {
    const rows = includeDisabled
      ? await this.sql`select * from oidc_providers where authorization_endpoint is null order by name`
      : await this.sql`select * from oidc_providers where authorization_endpoint is null and enabled=true order by name`;
    return rows.map((row) => this.oidcSummary(row as Row));
  }

  async oauthProviders(
    includeDisabled = false,
  ): Promise<OAuthProviderSummaryV1[]> {
    const rows = includeDisabled
      ? await this.sql`select * from oidc_providers where authorization_endpoint is not null order by name`
      : await this.sql`select * from oidc_providers where authorization_endpoint is not null and enabled=true order by name`;
    return rows.map((row) => this.oauthSummary(row as Row));
  }

  async start(
    providerId: string,
    redirectUri: string,
    returnTo: string,
  ): Promise<URL> {
    return this.startAuthorization(providerId, redirectUri, validatedReturnTo(returnTo), "oidc");
  }

  async startOAuth(
    providerId: string,
    redirectUri: string,
    returnTo: string,
  ): Promise<URL> {
    return this.startAuthorization(providerId, validatedRedirectUri(redirectUri), validatedReturnTo(returnTo), "oauth");
  }

  private async startAuthorization(
    providerId: string,
    redirectUri: string,
    returnTo: string,
    protocol: "oidc" | "oauth",
  ): Promise<URL> {
    const providerRows = protocol === "oauth"
      ? await this.sql`select * from oidc_providers where id=${providerId} and authorization_endpoint is not null and enabled=true`
      : await this.sql`select * from oidc_providers where id=${providerId} and authorization_endpoint is null and enabled=true`;
    const provider = providerRows[0] as Row | undefined;
    if (!provider) throw new Error("OAuth provider is unavailable");
    const secret = await this.envelope.open(
      bytes(provider.client_secret_cipher),
      bytes(provider.client_secret_iv),
      `oidc-provider:${providerId}`,
    );
    const config = protocol === "oauth"
      ? this.oauthConfiguration(provider, secret)
      : await this.discoverOidc(provider, secret);
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const flow = await this.envelope.seal(
      JSON.stringify({
        code_verifier: codeVerifier,
        ...(protocol === "oidc" ? { nonce: client.randomNonce() } : {}),
      }),
      `oidc-flow:${providerId}`,
    );
    const flowId = identifier(`${protocol}-flow`);
    await this.sql.begin(async (tx) => {
      await tx`
        insert into oidc_authorizations(
          id,provider_id,state_hash,flow_cipher,flow_iv,return_to,expires_at
        ) values(
          ${flowId},${providerId},${await hash(state)},${flow.cipher},${flow.iv},
          ${returnTo},now()+interval '10 minutes'
        )
      `;
      await tx`
        insert into audit_events(
          id,actor_id,action,resource_type,resource_id,reason,trace_id,payload
        ) values(
          ${identifier("audit")},null,
          ${protocol === "oauth" ? "auth.oauth.start" : "auth.oidc.start"},
          'authorization',${flowId},'authorization code flow initiated',
          ${identifier("trace")},${tx.json({ provider_id: providerId, protocol })}
        )
      `;
    });
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      scope: (provider.scopes as string[]).join(" "),
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    };
    if (protocol === "oidc") {
      const flowData = JSON.parse(
        await this.envelope.open(
          bytes(flow.cipher),
          bytes(flow.iv),
          `oidc-flow:${providerId}`,
        ),
      ) as { nonce: string };
      parameters.nonce = flowData.nonce;
    }
    return client.buildAuthorizationUrl(config, parameters);
  }

  async callback(
    providerId: string,
    currentUrl: URL,
  ): Promise<{ actor: PortalActor; token: string; csrf: string; return_to: string }> {
    return this.completeAuthorization(providerId, currentUrl, "oidc");
  }

  async callbackOAuth(
    providerId: string,
    currentUrl: URL,
  ): Promise<{ actor: PortalActor; token: string; csrf: string; return_to: string }> {
    return this.completeAuthorization(providerId, currentUrl, "oauth");
  }

  private async completeAuthorization(
    providerId: string,
    currentUrl: URL,
    protocol: "oidc" | "oauth",
  ): Promise<{ actor: PortalActor; token: string; csrf: string; return_to: string }> {
    const state = currentUrl.searchParams.get("state");
    if (!state) throw new Error("OAuth callback is missing state");
    const authorization = await consumeOidcAuthorization(
      this.sql,
      providerId,
      state,
    );
    const callbackState = currentUrl.searchParams.get("state");
    if (callbackState !== state) throw new Error("OAuth callback state mismatch");
    const providerRows = protocol === "oauth"
      ? await this.sql`select * from oidc_providers where id=${providerId} and authorization_endpoint is not null and enabled=true`
      : await this.sql`select * from oidc_providers where id=${providerId} and authorization_endpoint is null and enabled=true`;
    const provider = providerRows[0] as Row | undefined;
    if (!provider) throw new Error("OAuth provider is unavailable");
    const secret = await this.envelope.open(
      bytes(provider.client_secret_cipher),
      bytes(provider.client_secret_iv),
      `oidc-provider:${providerId}`,
    );
    const flow = JSON.parse(
      await this.envelope.open(
        bytes(authorization.flow_cipher),
        bytes(authorization.flow_iv),
        `oidc-flow:${providerId}`,
      ),
    ) as { code_verifier?: unknown; nonce?: unknown };
    if (typeof flow.code_verifier !== "string")
      throw new Error("OAuth flow secret is invalid");
    if (protocol === "oidc" && typeof flow.nonce !== "string")
      throw new Error("OIDC flow nonce is invalid");
    const config = protocol === "oauth"
      ? this.oauthConfiguration(provider, secret)
      : await this.discoverOidc(provider, secret);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: flow.code_verifier,
      expectedState: state,
      ...(protocol === "oidc"
        ? { expectedNonce: String(flow.nonce), idTokenExpected: true }
        : { idTokenExpected: false }),
    });
    let claims: Record<string, unknown>;
    if (protocol === "oidc") {
      const idTokenClaims = tokens.claims();
      if (!idTokenClaims) throw new Error("OIDC provider returned no ID Token claims");
      claims = idTokenClaims as Record<string, unknown>;
    } else {
      if (!tokens.access_token) throw new Error("OAuth provider returned no access token");
      claims = await this.fetchOAuthClaims(provider, tokens.access_token);
    }
    const session = await this.completeLogin(provider, claims, protocol);
    return { ...session, return_to: String(authorization.return_to) };
  }

  private async fetchOAuthClaims(
    provider: Row,
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const endpoint = httpsEndpoint(provider.userinfo_endpoint, "userinfo_endpoint");
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };
    const response = this.fetchImpl
      ? await this.fetchImpl(endpoint, {
          body: undefined,
          headers,
          method: "GET",
          redirect: "manual",
        })
      : await fetch(endpoint, { headers, redirect: "error" });
    if (!response.ok) throw new Error(`OAuth userinfo request failed (${response.status})`);
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("OAuth userinfo response must be a JSON object");
    return value as Record<string, unknown>;
  }

  private async completeLogin(
    provider: Row,
    claims: Record<string, unknown>,
    protocol: "oidc" | "oauth",
  ): Promise<{ actor: PortalActor; token: string; csrf: string }> {
    const issuer = String(provider.issuer);
    const subject = claim(
      claims,
      protocol === "oauth" ? String(provider.subject_claim) : "sub",
    );
    let username = claim(
      claims,
      String(provider.username_claim),
      subject,
    ).slice(0, 200);
    const displayName = claim(
      claims,
      String(provider.display_name_claim),
      username,
    ).slice(0, 200);
    const roleMappings = OidcProviderSummaryV1Schema.shape.role_mappings.parse(
      provider.role_mappings,
    );
    const externalRole = provider.role_claim
      ? claim(claims, String(provider.role_claim), "")
      : "";
    const role = roleMappings[externalRole] ?? OidcProviderSummaryV1Schema.shape.default_role.parse(provider.default_role);
    return this.sql.begin(async (tx) => {
      let users = await tx`
        select * from users
        where oidc_issuer=${issuer} and oidc_subject=${subject}
        for update
      `;
      let row = users[0] as Row | undefined;
      if (!row) {
        const conflict = await tx`
          select 1 from users
          where lower(username)=lower(${username}) and deleted_at is null
        `;
        if (conflict.length)
          username = `${username.slice(0, 180)}-${(await hash(`${issuer}:${subject}`)).slice(0, 8)}`;
        users = await tx`
          insert into users(
            id,username,display_name,role,oidc_issuer,oidc_subject,status
          ) values(
            ${identifier("user")},${username},${displayName},${role},
            ${issuer},${subject},'active'
          ) returning *
        `;
        row = users[0] as Row;
      } else {
        const updated = await tx`
          update users
          set display_name=${displayName},role=${role},status='active',
              version=version+1,updated_at=now()
          where id=${String(row.id)}
          returning *
        `;
        row = updated[0] as Row;
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      const csrf = crypto.randomUUID();
      await tx`
        insert into sessions(
          id,user_id,token_hash,csrf_hash,expires_at,token_kind,scopes
        ) values(
          ${identifier("session")},${String(row.id)},${await hash(token)},
          ${await hash(csrf)},now()+interval '12 hours','web',${tx.json([])}
        )
      `;
      await tx`
        insert into audit_events(
          id,actor_id,action,resource_type,resource_id,reason,trace_id,payload
        ) values(
          ${identifier("audit")},${String(row.id)},
          ${protocol === "oauth" ? "auth.oauth.login" : "auth.oidc.login"},
          'user',${String(row.id)},'OAuth authorization code login',
          ${`trace-${crypto.randomUUID()}`},
          ${tx.json({ issuer, subject, provider_id: String(provider.id), protocol })}
        )
      `;
      return {
        actor: {
          id: String(row.id),
          username: String(row.username),
          display_name: String(row.display_name),
          role,
        },
        token,
        csrf,
      };
    });
  }

  private oidcSummary(row: Row): OidcProviderSummaryV1 {
    return OidcProviderSummaryV1Schema.parse({
      version: "oidc-provider-summary.v1",
      id: String(row.id),
      name: String(row.name),
      issuer: String(row.issuer),
      client_id: String(row.client_id),
      scopes: row.scopes,
      username_claim: String(row.username_claim),
      display_name_claim: String(row.display_name_claim),
      role_claim: row.role_claim ? String(row.role_claim) : undefined,
      role_mappings: row.role_mappings,
      default_role: row.default_role,
      enabled: Boolean(row.enabled),
      secret_configured: true,
      updated_at: new Date(String(row.updated_at)).toISOString(),
    });
  }

  private oauthSummary(row: Row): OAuthProviderSummaryV1 {
    if (!isOAuthProvider(row)) throw new Error("OAuth provider endpoints are missing");
    return OAuthProviderSummaryV1Schema.parse({
      version: "oauth-provider-summary.v1",
      id: String(row.id),
      name: String(row.name),
      issuer: String(row.issuer),
      authorization_endpoint: String(row.authorization_endpoint),
      token_endpoint: String(row.token_endpoint),
      userinfo_endpoint: String(row.userinfo_endpoint),
      client_id: String(row.client_id),
      scopes: row.scopes,
      subject_claim: String(row.subject_claim),
      username_claim: String(row.username_claim),
      display_name_claim: String(row.display_name_claim),
      role_claim: row.role_claim ? String(row.role_claim) : undefined,
      role_mappings: row.role_mappings,
      default_role: row.default_role,
      enabled: Boolean(row.enabled),
      secret_configured: true,
      updated_at: new Date(String(row.updated_at)).toISOString(),
    });
  }
}
