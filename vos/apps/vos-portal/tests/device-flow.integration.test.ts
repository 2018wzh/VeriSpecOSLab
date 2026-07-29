import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresPortalRepository } from "../server/postgres-repository.ts";

const databaseUrl = process.env.PORTAL_TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration("device authorization creation and token exchange are replay-safe and auditable", async () => {
  const sql = postgres(databaseUrl!, { max: 4, prepare: false });
  const prefix = `device-${crypto.randomUUID()}`;
  const userId = `${prefix}-user`;
  const actor = { id: userId, username: userId, display_name: "Device User", role: "student" as const };
  const previousKey = process.env.VOS_PORTAL_MASTER_KEY;
  let userCode: string | undefined;
  process.env.VOS_PORTAL_MASTER_KEY = "device-flow-integration-master-key-at-least-32-bytes";
  try {
    const password="integration-password";const passwordHash=await Bun.password.hash(password,{algorithm:"argon2id"});
    await sql`insert into users(id,username,display_name,role,status,password_hash) values(${userId},${userId},${actor.display_name},'student','active',${passwordHash})`;
    const repository = new PostgresPortalRepository(sql);
    const login=await repository.authenticate({username:userId,password},`${prefix}-login-key`);
    const loginReplay=await repository.authenticate({username:userId,password},`${prefix}-login-key`);
    expect(loginReplay.token).toBe(login.token);
    expect(loginReplay.csrf).toBe(login.csrf);
    expect(Number((await sql`select count(*)::int count from sessions where user_id=${userId}`)[0].count)).toBe(1);
    const first = await repository.createDeviceAuthorization("vos-cli", `${prefix}-create-key`, `${prefix}-create-hash`);
    userCode = first.user_code;
    const replay = await repository.createDeviceAuthorization("vos-cli", `${prefix}-create-key`, `${prefix}-create-hash`);
    expect(replay.device_code).toBe(first.device_code);
    expect(replay.user_code).toBe(first.user_code);
    await expect(repository.createDeviceAuthorization("other-client", `${prefix}-create-key`, `${prefix}-other-hash`)).rejects.toThrow("不同请求");

    expect(await repository.approveDevice(actor, first.user_code, `${prefix}-approve-trace`, `${prefix}-approve-key`, `${prefix}-approve-hash`)).toEqual({ ok: true });
    const issued = await repository.exchangeDeviceCode(first.device_code);
    const exchangedAgain = await repository.exchangeDeviceCode(first.device_code);
    expect(issued.status).toBe("approved");
    expect(exchangedAgain.status).toBe("approved");
    if (issued.status !== "approved" || exchangedAgain.status !== "approved") throw new Error("device exchange did not approve");
    expect(exchangedAgain.access_token).toBe(issued.access_token);
    expect((await repository.authorizationForToken(issued.access_token))?.actor.id).toBe(userId);
    const actions = (await sql`select action from audit_events where actor_id=${userId} or resource_id in (select id from device_authorizations where user_id=${userId}) order by created_at`).map(row => String(row.action));
    expect(actions).toContain("auth.device.create");
    expect(actions).toContain("auth.local.login");
    expect(actions).toContain("auth.device.approve");
    expect(actions).toContain("auth.device.exchange");
  } finally {
    await sql`delete from audit_events where actor_id=${userId} or resource_id in (select id from device_authorizations where user_id=${userId})`;
    await sql`delete from idempotency_keys where actor_id=${userId}`;
    await sql`delete from sessions where user_id=${userId}`;
    await sql`delete from device_authorizations where user_id=${userId} or user_code=${userCode??"__missing__"}`;
    await sql`delete from users where id=${userId}`;
    await sql.end({ timeout: 5 });
    if (previousKey === undefined) delete process.env.VOS_PORTAL_MASTER_KEY;
    else process.env.VOS_PORTAL_MASTER_KEY = previousKey;
  }
}, 30_000);
