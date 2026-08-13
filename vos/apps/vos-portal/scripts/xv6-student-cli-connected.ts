import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HttpPortalClient } from "vos-core";

const portalUrl = required("VOS_PORTAL_URL").replace(/\/$/, "");
const projectId = required("VOS_PORTAL_PROJECT_ID");
const source = path.resolve(
  process.env.VOS_XV6_SPEC_ROOT ??
    path.join(import.meta.dirname, "../../../../examples/xv6-spec"),
);
const sourceRef = process.env.VOS_XV6_STUDENT_REF ?? "course/lab9-candidate";
const expectedStage = process.env.VOS_XV6_STUDENT_STAGE ?? "lab9";
const giteaOrigin = process.env.VOS_GITEA_PUBLIC_ORIGIN?.replace(/\/$/, "");
if (!giteaOrigin)
  throw new Error("VOS_GITEA_PUBLIC_ORIGIN is required for the student CLI simulation");

const workspace = await mkdtemp(path.join(os.tmpdir(), "vos-xv6-student-cli-"));
const checkout = path.join(workspace, "project");
const authStore = path.join(workspace, "auth.json");
const client = new HttpPortalClient();

try {
  const suppliedToken = process.env.VOS_PORTAL_TOKEN?.trim();
  const webSession = suppliedToken
    ? { token: suppliedToken, cookies: "", csrf: "" }
    : await webLogin(portalUrl);
  const token = webSession.token;
  const binding = await client.getProjectBinding(portalUrl, token, projectId);
  if (binding.current_stage.key !== expectedStage)
    throw new Error(
      `project ${projectId} is at ${binding.current_stage.key}, expected ${expectedStage}`,
    );

  git(source, ["worktree", "add", "--detach", checkout, sourceRef]);
  let pushedBranch: string | undefined;
  let remote: string | undefined;
  try {
    const cli = path.resolve(import.meta.dirname, "../../vos-cli/app/main.ts");
    const env = {
      ...process.env,
      VOS_AUTH_STORE: authStore,
      ...(process.env.VOS_PORTAL_TOKEN ? { VOS_PORTAL_TOKEN: process.env.VOS_PORTAL_TOKEN } : {}),
      GIT_AUTHOR_NAME: "VOS Student",
      GIT_AUTHOR_EMAIL: "student@vos.invalid",
      GIT_COMMITTER_NAME: "VOS Student",
      GIT_COMMITTER_EMAIL: "student@vos.invalid",
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSL_NO_VERIFY: process.env.GIT_SSL_NO_VERIFY ?? "1",
    };

    if (process.env.VOS_PORTAL_TOKEN?.trim())
      await runCli(cli, checkout, env, ["portal", "login", portalUrl]);
    else
      await runCliDeviceLogin(cli, checkout, env, portalUrl, webSession);
    await runCli(cli, checkout, env, ["portal", "whoami", portalUrl]);
    await runCli(cli, checkout, env, ["portal", "bind", portalUrl, projectId]);

    git(checkout, ["add", ".gitignore", ".vos/project.yaml"]);
    git(checkout, ["commit", "-m", "[course][portal] Bind xv6 student project"]);
    pushedBranch = `vos-student-${crypto.randomUUID().slice(0, 8)}`;
    remote = publicRepositoryUrl(binding.repo_url);
    git(checkout, ["remote", "set-url", "portal", remote]);
    await push(checkout, pushedBranch, env);
    // Gitea's signed webhook is asynchronous; give the ledger projector a bounded
    // window before the first remote run, then retry only its explicit lease race.
    await Bun.sleep(1_500);

    const publicRun = await runWithLedgerRetry(cli, checkout, env, [
      "portal",
      "run",
      "--stage",
      expectedStage,
      "--watch",
    ]);
    const publicRunId = findRunId(publicRun);
    const evidence = await runCli(cli, checkout, env, [
      "portal",
      "evidence",
      publicRunId,
      "--out",
      ".vos/student-public-evidence",
    ]);
    const submission = await runCli(cli, checkout, env, [
      "portal",
      "submit",
      "--stage",
      expectedStage,
    ]);
    const submissionValue = parseJson(submission.stdout) as Record<string, unknown>;
    const submissionDetails = submissionValue.details as Record<string, unknown>;
    const submissionRecord = submissionDetails.submission as Record<string, unknown>;
    const submissionId = String(submissionRecord.id ?? "");
    const submissionRunId = String(submissionRecord.run_id ?? "");
    if (!submissionId || !submissionRunId)
      throw new Error("CLI submission response did not contain submission and run ids");
    const status = await runCli(cli, checkout, env, [
      "portal",
      "status",
      submissionRunId,
      "--watch",
    ]);
    const parsedStatus = parseJson(status.stdout);
    const terminal = nestedRunStatus(parsedStatus);
    if (terminal !== "passed")
      throw new Error(`authoritative student CLI run ended with ${terminal}`);
    const finalSubmission = (await request(
      portalUrl,
      `/submissions/${encodeURIComponent(submissionId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    ).then((response) => response.json())) as { status?: string };
    if (finalSubmission.status !== "candidate")
      throw new Error(`candidate course submission ended with ${finalSubmission.status ?? "unknown"}`);

    console.log(JSON.stringify({
      flow: ["portal login", "portal whoami", "portal bind", "portal run", "portal evidence", "portal submit", "portal status"],
      project_id: projectId,
      stage: expectedStage,
      source_ref: sourceRef,
      public_run_id: publicRunId,
      submission_run_id: submissionRunId,
      evidence_status: String((parseJson(evidence.stdout) as Record<string, unknown>).status ?? "unknown"),
      submission_status: finalSubmission.status,
      pushed_branch: pushedBranch,
    }));
  } finally {
    if (pushedBranch && remote)
      await deleteRemoteBranch(remote, pushedBranch);
    git(source, ["worktree", "remove", "--force", checkout]);
  }
} finally {
  await rm(workspace, { recursive: true, force: true });
}

async function runWithLedgerRetry(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
): Promise<CliResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runCli(cli, cwd, env, args, true);
    if (result.exitCode === 0) return result;
    const root = parseJson(result.stdout) as Record<string, unknown>;
    const details = root.details as Record<string, unknown> | undefined;
    const run = details?.run as Record<string, unknown> | undefined;
    const retryable = run?.failure_class === "infra_failure" &&
      String(run.public_message ?? "").includes("commit ledger");
    if (!retryable)
      throw new Error(`vos ${args.join(" ")} failed: ${redact(result.stderr || result.stdout)}`);
    last = result.stderr || result.stdout;
    await Bun.sleep(500);
  }
  throw new Error(`commit ledger did not become visible: ${String(last)}`);
}

async function runCli(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  args: string[],
  allowFailure = false,
): Promise<CliResult> {
  const child = Bun.spawn(
    ["bun", cli, "--project-root", cwd, "--progress", "never", "--json", ...args],
    { cwd, env, stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const code = await child.exited;
  if (code !== 0 && !allowFailure)
    throw new Error(`vos ${args.join(" ")} failed: ${redact(stderr || stdout)}`);
  return { stdout, stderr, exitCode: code };
}

async function push(
  cwd: string,
  branch: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const username = process.env.VOS_GITEA_USERNAME ?? "student";
  const password = process.env.VOS_GITEA_PASSWORD ?? process.env.VOS_GITEA_TOKEN ?? "student";
  const askpass = path.join(cwd, ".vos-askpass.cmd");
  await writeFile(
    askpass,
    `@echo off\r\nif /I not "%~1"=="Password" (echo ${username}) else (echo ${password})\r\n`,
  );
  try {
    const result = Bun.spawnSync(
      ["git", "push", "portal", `HEAD:refs/heads/${branch}`],
      {
        cwd,
        env: { ...env, GIT_ASKPASS: askpass },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (result.exitCode !== 0)
      throw new Error(`git push failed: ${redact(result.stderr.toString())}`);
  } finally {
    await unlink(askpass).catch(() => undefined);
  }
}

function publicRepositoryUrl(repoUrl: string | undefined): string {
  if (!repoUrl) throw new Error("Portal project has no active Gitea repository");
  const parsed = new URL(repoUrl);
  return `${giteaOrigin}${parsed.pathname}`;
}

async function deleteRemoteBranch(remote: string, branch: string): Promise<void> {
  const parsed = new URL(remote);
  const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repository) throw new Error("Gitea repository URL is invalid");
  const response = await fetch(
    `${giteaOrigin}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository.replace(/\.git$/, ""))}/branches/${encodeURIComponent(branch)}`,
    { method: "DELETE", headers: { authorization: `token ${required("VOS_GITEA_TOKEN")}` } },
  );
  if (!response.ok)
    throw new Error(`Gitea test branch cleanup failed with HTTP ${response.status}`);
}

function git(cwd: string, args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${redact(result.stderr.toString())}`);
  return result.stdout.toString();
}

function findRunId(result: CliResult): string {
  const value = parseJson(result.stdout) as Record<string, unknown>;
  const details = value.details as Record<string, unknown> | undefined;
  const run = details?.run as Record<string, unknown> | undefined;
  const runId = String(run?.id ?? details?.run_id ?? "");
  if (!runId) throw new Error("CLI response did not contain a run id");
  return runId;
}

function nestedRunStatus(value: unknown): string {
  const root = value as Record<string, unknown>;
  const details = root.details as Record<string, unknown> | undefined;
  const run = details?.run as Record<string, unknown> | undefined;
  return String(run?.status ?? "unknown");
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error("CLI did not return JSON output");
  }
}

async function webLogin(base: string): Promise<WebSession> {
  const username = process.env.VOS_PORTAL_USERNAME ?? "student";
  const password = process.env.VOS_PORTAL_PASSWORD ?? "student";
  const login = await request(base, "/auth/login", {
    method: "POST",
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ username, password }),
  });
  const cookies = cookieHeader(login.headers);
  const sessionToken = cookieValue(cookies, "vos_session");
  const csrf = cookieValue(cookies, "vos_csrf");
  if (!sessionToken || !csrf) throw new Error("Portal login did not return session cookies");
  return { token: sessionToken, cookies, csrf };
}

async function runCliDeviceLogin(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  base: string,
  webSession: WebSession,
): Promise<void> {
  const loginEnv = { ...env };
  delete loginEnv.VOS_PORTAL_TOKEN;
  const child = Bun.spawn(
    ["bun", cli, "--project-root", cwd, "--progress", "never", "portal", "login", base],
    { cwd, env: loginEnv, stdout: "pipe", stderr: "pipe" },
  );
  const reader = child.stderr.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let userCode: string | undefined;
  const readTask = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += decoder.decode(chunk.value, { stream: true });
      userCode ??= output.match(/enter code ([A-Z0-9-]+)/i)?.[1];
    }
  })();
  const deadline = Date.now() + 15_000;
  while (!userCode && Date.now() < deadline) {
    await Promise.race([readTask, Bun.sleep(100)]);
    userCode ??= output.match(/enter code ([A-Z0-9-]+)/i)?.[1];
  }
  if (!userCode) {
    child.kill();
    throw new Error(`CLI device login did not expose a user code: ${redact(output)}`);
  }
  await request(base, "/auth/device/approve", {
    method: "POST",
    headers: {
      cookie: webSession.cookies,
      "x-csrf-token": webSession.csrf,
      "x-idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({ user_code: userCode }),
  });
  await readTask;
  const stdout = await new Response(child.stdout).text();
  const stderr = output;
  if ((await child.exited) !== 0)
    throw new Error(`vos portal login failed: ${redact(`${stderr}${stdout}`)}`);
}

type WebSession = { token: string; cookies: string; csrf: string };

async function request(base: string, route: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${base}/api/v1${route}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok)
    throw new Error(`Portal ${route} failed with HTTP ${response.status}`);
  return response;
}

function cookieHeader(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const values = typeof getSetCookie === "function"
    ? getSetCookie.call(headers)
    : [headers.get("set-cookie") ?? ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

function cookieValue(header: string, name: string): string | undefined {
  return header.split("; ").find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[^\s]+/gi, "Bearer <redacted>").slice(0, 800);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

type CliResult = { stdout: string; stderr: string; exitCode: number };
