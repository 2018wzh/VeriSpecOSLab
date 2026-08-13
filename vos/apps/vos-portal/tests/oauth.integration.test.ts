import { expect, test } from "bun:test";
import postgres from "postgres";
import { OAuthProviderInputV1Schema } from "vos-core/portal-contracts";
import { OidcService } from "../server/oidc.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration(
  "OAuth 2.0 authorization code + PKCE uses UserInfo and never exposes provider secrets",
  async () => {
    const sql = postgres(databaseUrl!, { max: 4, prepare: false });
    const prefix = `oauth-${crypto.randomUUID()}`;
    const admin = `${prefix}-admin`;
    const issuer = `https://${prefix}.example.test`;
    const authorizationEndpoint = `${issuer}/authorize`;
    const tokenEndpoint = `${issuer}/token`;
    const userinfoEndpoint = `${issuer}/userinfo`;
    const clientId = "portal-oauth-test";
    const clientSecret = `secret-${crypto.randomUUID()}`;
    let tokenRequestBody = "";
    let service: OidcService | undefined;
    try {
      await sql`
        insert into users(id,username,display_name,role,status)
        values(${admin},${admin},'OAuth Admin','admin','active')
      `;
      const masterKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
      );
      service = await OidcService.create(sql, masterKey, {
        fetch: async (input, options) => {
          const url = String(
            typeof input === "string" || input instanceof URL ? input : input.url,
          );
          if (url === tokenEndpoint) {
            tokenRequestBody = String(options?.body ?? "");
            return Response.json({ access_token: "oauth-access-token", token_type: "Bearer", expires_in: 300 });
          }
          if (url === userinfoEndpoint)
            return Response.json({ id: "oauth-subject", username: "oauth.student", name: "OAuth Student", role: "student" });
          throw new Error(`unexpected OAuth request: ${url}`);
        },
      });
      const input = OAuthProviderInputV1Schema.parse({
        version: "oauth-provider-input.v1",
        id: prefix,
        name: "Integration OAuth",
        issuer,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        userinfo_endpoint: userinfoEndpoint,
        client_id: clientId,
        client_secret: clientSecret,
        scopes: ["profile"],
        subject_claim: "id",
        username_claim: "username",
        display_name_claim: "name",
        role_claim: "role",
        role_mappings: {},
        default_role: "student",
        enabled: true,
        reason: "integration OAuth provider test",
      });
      const summary = await service.saveOAuthProvider(
        { id: admin, username: admin, display_name: "OAuth Admin", role: "admin" },
        input,
        `trace-${crypto.randomUUID()}`,
        `${prefix}-save-key`,
        `${prefix}-save-hash`,
      );
      expect(summary.secret_configured).toBe(true);
      expect(JSON.stringify(summary)).not.toContain(clientSecret);
      const callbackUrl = new URL(
        "https://portal.example.test/api/v1/auth/oauth/callback",
      );
      const authorization = await service.startOAuth(
        prefix,
        callbackUrl.toString(),
        "/workspace",
      );
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      const callback = new URL(callbackUrl);
      callback.searchParams.set(
        "state",
        authorization.searchParams.get("state") ?? "",
      );
      callback.searchParams.set("code", "oauth-code");
      const loggedIn = await service.callbackOAuth(prefix, callback);
      expect(loggedIn.actor.username).toBe("oauth.student");
      expect(loggedIn.actor.role).toBe("student");
      expect(loggedIn.return_to).toBe("/workspace");
      expect(tokenRequestBody).toContain("code_verifier=");
      expect(tokenRequestBody).toContain("grant_type=authorization_code");
      expect(tokenRequestBody).toContain("client_secret=");
      await expect(service.callbackOAuth(prefix, callback)).rejects.toThrow(
        "already consumed",
      );
    } finally {
      await sql`delete from oidc_authorizations where provider_id=${prefix}`;
      await sql`delete from sessions where user_id in (select id from users where oidc_issuer=${issuer})`;
      await sql`delete from audit_events where actor_id=${admin} or actor_id in (select id from users where oidc_issuer=${issuer})`;
      await sql`delete from users where oidc_issuer=${issuer}`;
      await sql`delete from oidc_providers where id=${prefix}`;
      await sql`delete from users where id=${admin}`;
      await sql.end({ timeout: 5 });
    }
  },
  30_000,
);
