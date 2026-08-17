import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import { HttpPortalClient } from "vos-core";
import { CourseManifestV1Schema } from "vos-core/portal-contracts";
import { parse } from "yaml";

const portalUrl = required("VOS_PORTAL_URL").replace(/\/$/, "");
const projectId = required("VOS_PORTAL_PROJECT_ID");
const source = path.resolve(
  process.env.VOS_XV6_SPEC_ROOT ??
    path.join(import.meta.dirname, "../../../../examples/xv6-spec"),
);
const sourceRef = process.env.VOS_XV6_STUDENT_REF ?? "course/lab9-complete";
const expectedStage = process.env.VOS_XV6_STUDENT_STAGE ?? "lab9";
const courseManifest = CourseManifestV1Schema.parse(
  parse(
    await readFile(
      path.join(import.meta.dirname, "../../../../courses/xv6-spec/course.yaml"),
      "utf8",
    ),
  ),
);
const stages = (process.env.VOS_XV6_STUDENT_ALL === "1" || process.argv.includes("--all"))
  ? courseManifest.stages.filter((stage) => stage.source_ref.endsWith("-complete"))
  : [
      courseManifest.stages.find((stage) => stage.key === expectedStage) ??
        ({ key: expectedStage, source_ref: sourceRef } as (typeof courseManifest.stages)[number]),
    ];
if (stages.length === 0) throw new Error("xv6 course manifest has no complete stages");
const giteaOrigin = process.env.VOS_GITEA_PUBLIC_ORIGIN?.replace(/\/$/, "");
if (!giteaOrigin)
  throw new Error("VOS_GITEA_PUBLIC_ORIGIN is required for the student CLI simulation");

const workspace = await mkdtemp(path.join(os.tmpdir(), "vos-xv6-student-cli-"));
const authStore = path.join(workspace, "auth.json");
const client = new HttpPortalClient();

try {
  const suppliedToken = process.env.VOS_PORTAL_TOKEN?.trim();
  const webSession = suppliedToken
    ? { token: suppliedToken, cookies: "", csrf: "" }
    : await webLogin(portalUrl);
  const token = webSession.token;
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
  let authenticated = false;
  const results: Array<Record<string, string | number>> = [];
  const firstBinding = await client.getProjectBinding(portalUrl, token, projectId);
  const startIndex = stages.findIndex((stage) => stage.key === firstBinding.current_stage.key);
  if (startIndex < 0)
    throw new Error(
      `project ${projectId} current stage ${firstBinding.current_stage.key} is outside the requested xv6 replay range`,
    );
  for (const stage of stages.slice(startIndex)) {
    const binding = await client.getProjectBinding(portalUrl, token, projectId);
    if (binding.current_stage.key !== stage.key)
      throw new Error(
        `project ${projectId} is at ${binding.current_stage.key}, expected ${stage.key}`,
      );
    const stageCheckout = path.join(workspace, stage.key);
    let pushedBranch: string | undefined;
    let remote: string | undefined;
    let worktreeAdded = false;
    try {
      git(source, ["worktree", "add", "--detach", stageCheckout, stage.source_ref]);
      worktreeAdded = true;
      if (!authenticated) {
        if (process.env.VOS_PORTAL_TOKEN?.trim())
          await runCli(cli, stageCheckout, env, ["portal", "login", portalUrl]);
        else
          await runCliDeviceLogin(cli, stageCheckout, env, portalUrl, webSession);
        authenticated = true;
      }
      await runCli(cli, stageCheckout, env, ["portal", "whoami", portalUrl]);
      await runCli(cli, stageCheckout, env, ["portal", "bind", portalUrl, projectId]);

      git(stageCheckout, ["add", ".gitignore", ".vos/project.yaml"]);
      git(stageCheckout, ["commit", "-m", `[course][portal] Bind xv6 ${stage.key} project`]);
      pushedBranch = `vos-student-${stage.key}-${crypto.randomUUID().slice(0, 8)}`;
      remote = publicRepositoryUrl(binding.repo_url);
      git(stageCheckout, ["remote", "set-url", "portal", remote]);
      await push(stageCheckout, pushedBranch, env);
      // Gitea's signed webhook is asynchronous; retry only the explicit ledger race.
      await Bun.sleep(1_500);

      const publicRun = await runWithLedgerRetry(cli, stageCheckout, env, [
        "portal", "run", "--stage", stage.key, "--watch",
      ]);
      const publicRunId = findRunId(publicRun);
      const evidence = await runCli(cli, stageCheckout, env, [
        "portal", "evidence", publicRunId, "--out", `.vos/student-public-evidence/${stage.key}`,
      ]);
      const submission = await runCli(cli, stageCheckout, env, [
        "portal", "submit", "--stage", stage.key,
      ]);
      const submissionValue = parseJson(submission.stdout) as Record<string, unknown>;
      const submissionDetails = submissionValue.details as Record<string, unknown>;
      const submissionRecord = submissionDetails.submission as Record<string, unknown>;
      const submissionId = String(submissionRecord.id ?? "");
      const submissionRunId = String(submissionRecord.run_id ?? "");
      if (!submissionId || !submissionRunId)
        throw new Error("CLI submission response did not contain submission and run ids");
      await uploadRequiredReviewArtifacts(
        cli,
        stageCheckout,
        env,
        submissionRunId,
        stage.key,
        stage.required_review_artifacts,
      );
      const status = await runCli(cli, stageCheckout, env, [
        "portal", "status", submissionRunId, "--watch",
      ]);
      const statusValue = parseJson(status.stdout);
      const terminal = nestedRunStatus(statusValue);
      if (terminal !== "passed")
        throw new Error(`authoritative student CLI run ended with ${terminal}`);
      const evaluated = await submissionStatus(portalUrl, token, submissionId);
      const finalStatus = stage.manual_review_required
        ? await waitForTeacherApproval(portalUrl, token, submissionId, evaluated)
        : evaluated;
      if (finalStatus !== "complete")
        throw new Error(
          `${stage.source_ref} submission ended with ${finalStatus}, expected complete`,
        );
      results.push({
        stage: stage.key,
        source_ref: stage.source_ref,
        public_run_id: publicRunId,
        submission_run_id: submissionRunId,
        evidence_status: String((parseJson(evidence.stdout) as Record<string, unknown>).status ?? "unknown"),
        submission_status: finalStatus,
        pushed_branch: pushedBranch,
      });
    } finally {
      if (pushedBranch && remote)
        await deleteRemoteBranch(remote, pushedBranch);
      if (worktreeAdded)
        git(source, ["worktree", "remove", "--force", stageCheckout]);
    }
  }
  console.log(JSON.stringify({
    flow: ["portal login", "portal whoami", "portal bind", "portal run", "portal evidence", "portal submit", "portal status"],
    project_id: projectId,
    stages: results,
  }));
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

async function uploadRequiredReviewArtifacts(
  cli: string,
  cwd: string,
  env: Record<string, string | undefined>,
  runId: string,
  stage: string,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) return;
  const directory = path.join(cwd, ".vos", "review", stage);
  await mkdir(directory, { recursive: true });
  for (const label of labels) {
    const artifact = await materializeReviewArtifact(cwd, directory, label);
    await runCli(cli, cwd, env, [
      "portal", "artifact", "upload", runId, path.relative(cwd, artifact), "--label", label,
    ]);
  }
}

async function materializeReviewArtifact(
  cwd: string,
  directory: string,
  label: string,
): Promise<string> {
  const variable = `VOS_XV6_ARTIFACT_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
  const override = process.env[variable]?.trim();
  if (override) {
    const target = path.join(directory, `${label}${path.extname(override).slice(0, 16)}`);
    await copyFile(path.resolve(override), target);
    return target;
  }
  if (label === "visionfive2-serial-log") {
    const evidence = path.join(cwd, "hardware", "visionfive2", "evidence");
    const parts = await Promise.all([
      readFile(path.join(evidence, "vf2-four-hart-usertests-part1.log")),
      readFile(path.join(evidence, "vf2-four-hart-usertests-part2-resume.log")),
    ]);
    const target = path.join(directory, `${label}.log`);
    await writeFile(target, Buffer.concat([parts[0], Buffer.from("\n"), parts[1]]));
    return target;
  }
  const defaults: Record<string, string> = {
    "visionfive2-hardware-report": "docs/visionfive2.md",
    "lab10-verification-report": "tests/verification/coverage.md",
  };
  const relative = defaults[label];
  if (!relative) throw new Error(`no xv6 review artifact source is defined for ${label}`);
  const target = path.join(directory, `${label}${path.extname(relative)}`);
  await copyFile(path.join(cwd, relative), target);
  return target;
}

async function submissionStatus(base: string, token: string, submissionId: string): Promise<string> {
  const value = (await request(
    base,
    `/submissions/${encodeURIComponent(submissionId)}`,
    { headers: { authorization: `Bearer ${token}` } },
  ).then((response) => response.json())) as { status?: string };
  return String(value.status ?? "unknown");
}

async function waitForTeacherApproval(
  base: string,
  token: string,
  submissionId: string,
  initial: string,
): Promise<string> {
  if (initial !== "candidate") return initial;
  const timeoutMs = Number(process.env.VOS_XV6_REVIEW_TIMEOUT_MS ?? 1_800_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000)
    throw new Error("VOS_XV6_REVIEW_TIMEOUT_MS must be at least 1000");
  console.error(`submission ${submissionId} is waiting for Portal teacher approval`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(5_000);
    const status = await submissionStatus(base, token, submissionId);
    if (status !== "candidate") return status;
  }
  throw new Error(`submission ${submissionId} remained candidate until the teacher approval timeout`);
}

async function push(
  cwd: string,
  branch: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const username = process.env.VOS_GITEA_USERNAME ?? "student";
  const password = process.env.VOS_GITEA_PASSWORD ?? process.env.VOS_GITEA_TOKEN ?? "student";
  const authorization = Buffer.from(`${username}:${password}`).toString("base64");
  const result = Bun.spawnSync(
    ["git", "push", "portal", `HEAD:refs/heads/${branch}`],
    {
      cwd,
      env: {
        ...env,
        GIT_CONFIG_COUNT: "2",
        GIT_CONFIG_KEY_0: "http.sslVerify",
        GIT_CONFIG_VALUE_0: "false",
        GIT_CONFIG_KEY_1: "http.extraHeader",
        GIT_CONFIG_VALUE_1: `Authorization: Basic ${authorization}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`git push failed: ${redact(result.stderr.toString())}`);
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
  if (response.status === 404) return;
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
