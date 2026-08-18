import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const mediaRoot = resolve(import.meta.dir, "..");
const transcriptRoot = join(mediaRoot, "transcripts");
const evidenceRoot = join(mediaRoot, "evidence");
const args = process.argv.slice(2);
const selected = selectedSlides(option(args, "--only"));
const glendaRoot = selected.has("p08") || selected.has("p10")
  ? resolve(repoRoot, requiredOption(args, "--glenda-root"))
  : repoRoot;
const debugReport = selected.has("p09")
  ? resolve(repoRoot, requiredOption(args, "--debug-report"))
  : undefined;
const agentRunId = selected.has("p08")
  ? requiredOption(args, "--agent-run-id")
  : undefined;
mkdirSync(transcriptRoot, { recursive: true });
mkdirSync(evidenceRoot, { recursive: true });

if (selected.has("p08")) collectKnowledgeEvidence();
if (selected.has("p09")) collectDebugEvidence();
if (selected.has("p10")) collectBoardEvidence();
if (selected.has("p11")) await collectPortalReplayEvidence();
console.log(`wrote ${[...selected].join(",")} to ${relative(repoRoot, transcriptRoot)} (${new Date().toISOString()})`);

function collectKnowledgeEvidence(): void {
  if (!agentRunId || !/^\d{15}-[a-z0-9]+$/.test(agentRunId))
    throw new Error("--agent-run-id must be a VOS run ID");
  const result = json(readFileSync(join(glendaRoot, ".vos", "agent-ask.json"), "utf8"));
  const question = string(result.question, "agent ask question");
  const answer = object(result.answer, "agent ask answer");
  const citations = array(answer.citations, "agent ask citations");
  if (citations.length === 0) throw new Error("real agent ask result has no citations");
  const sources = citations.slice(0, 4).map((item) =>
    string(object(item, "citation").source_id, "citation source_id"),
  );
  const events = readFileSync(
    join(glendaRoot, ".vos", "runs", agentRunId, "events.jsonl"),
    "utf8",
  ).trim().split(/\r?\n/).map((line) => json(line));
  const finished = events.findLast((event) => event.type === "run_finished");
  const finishedPayload = object(finished?.payload, "agent run finished payload");
  if (finishedPayload.status !== "passed")
    throw new Error(`agent run ${agentRunId} is not passed`);
  const models = new Set(events.flatMap((event) => {
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const wrapper = payload as Record<string, unknown>;
    const eventValue = wrapper.event;
    if (!eventValue || typeof eventValue !== "object" || Array.isArray(eventValue)) return [];
    const modelEvent = eventValue as Record<string, unknown>;
    return modelEvent.type === "model.request" && typeof modelEvent.model === "string"
      ? [modelEvent.model]
      : [];
  }));
  if (models.size !== 1) throw new Error(`agent run ${agentRunId} has ambiguous model identity`);
  const model = [...models][0];
  const completedAt = string(finished.ts, "agent run completion time");
  writeFileSync(join(evidenceRoot, "p08-agent-run.json"), `${JSON.stringify({
    version: "final-defense-agent-run.v1",
    run_id: agentRunId,
    status: "passed",
    provider: "openai-compatible",
    model,
    completed_at: completedAt,
    structured_result: "accepted",
    citation_count: citations.length,
    citation_source_ids: citations.map((item) => string(object(item, "citation").source_id, "citation source_id")),
    fixture_used: false,
  }, null, 2)}\n`, "utf8");
  writeTranscript("p08-kb-citation.txt", [
    "P8  KNOWLEDGE SOURCES / AI HALLUCINATION",
    "EVIDENCE: REAL ACCEPTED AGENT ASK",
    "",
    "$ vos agent ask  # committed Lab 10 design review",
    `run: ${agentRunId}`,
    `model: ${model}  status: passed  fixture: no`,
    `question: ${compact(question, 94)}`,
    `structured citations: ${citations.length}`,
    ...sources.map((source, index) => `citation[${index + 1}]: ${source}`),
    "",
    `answer: ${compact(string(answer.answer, "agent answer"), 138)}`,
    "Boundary: citations make claims inspectable; students still judge them.",
  ]);
}

function collectDebugEvidence(): void {
  if (!debugReport) throw new Error("--debug-report is required for p09");
  const report = json(readFileSync(debugReport, "utf8"));
  if (string(report.diagnosis_status, "diagnosis_status") !== "localized") {
    throw new Error("p09 requires a localized debug_output.v2 report");
  }
  const failureClass = string(report.failure_class, "failure_class");
  if (failureClass === "build_error") throw new Error("p09 must demonstrate a runtime failure, not a build error");
  const observations = array(report.observations, "debug observations").map((value) => object(value, "debug observation"));
  const tcg = observations.find((value) => string(value.source, "observation source") === "tcg");
  const gdb = observations.find((value) => string(value.source, "observation source") === "gdb");
  if (!tcg || !gdb) throw new Error("p09 requires both TCG discovery and typed GDB confirmation");
  const conclusion = object(report.conclusion, "debug conclusion");
  const conclusionIds = array(conclusion.observation_ids, "conclusion observation_ids").map((value) => string(value, "conclusion observation id"));
  for (const observation of [tcg, gdb]) {
    if (!conclusionIds.includes(string(observation.id, "observation id"))) {
      throw new Error("p09 conclusion must cite both TCG and GDB observations");
    }
  }
  const hypotheses = array(report.hypotheses, "debug hypotheses");
  const causalChain = array(report.causal_chain, "debug causal_chain");
  if (hypotheses.length === 0 || causalChain.length === 0) throw new Error("p09 requires a hypothesis and causal chain");
  const visualization = string(report.visualization_html, "visualization_html").trim().toLowerCase();
  if (!(visualization.startsWith("<!doctype html") || visualization.startsWith("<html"))) {
    throw new Error("p09 requires a complete visualization_html document");
  }
  const next = array(report.next_commands, "next commands")
    .map((value) => string(value, "next diagnostic command"))
    .join(" ");
  writeTranscript("p09-kernel-debug.txt", [
    "P9  RUNTIME PAGE-FAULT LOCALIZATION",
    "EVIDENCE: DEBUG_OUTPUT.V2 + BOUNDED QEMU OBSERVATIONS",
    "",
    `failure_class: ${failureClass}`,
    `summary: ${compact(string(report.summary, "debug summary"), 150)}`,
    "",
    `TCG  ${string(tcg.id, "TCG observation id")}: ${compact(string(tcg.statement, "TCG statement"), 112)}`,
    `GDB  ${string(gdb.id, "GDB observation id")}: ${compact(string(gdb.statement, "GDB statement"), 112)}`,
    `ROOT CAUSE: ${string(conclusion.root_cause, "root cause")}`,
    `NEXT: ${next}`,
    "Boundary: instrumentation is last-resort and detached; diagnosis is not verify.",
  ]);
}

function collectBoardEvidence(): void {
  const qemu = readFileSync(
    join(glendaRoot, "verification", "orangepi-prime-qemu-simulation-report.md"),
    "utf8",
  );
  const serial = readFileSync(
    join(glendaRoot, "verification", "orangepi-prime-serial.log"),
    "utf8",
  );
  const qemuMarkers = [
    "h5-firmware-chain-trace",
    "h5-mmu-trace",
    "h5-uart-clock-trace",
    "h5-timer-irq-trace",
    "h5-smp-ipi-trace",
    "h5-mmc-data-trace",
    "h5-lab1-8-regression-trace",
  ];
  const boardMarkers = [
    "H5_DTB_OK cores=4 memory_mib=2048",
    "H5_SMP_OK cores=4 mask=0x0f",
    "H5_IPI_OK mask=0x0f",
    "H5_TIMER_IRQ_OK ticks=10",
    "H5_MMC_DATA_OK",
    "H5_LAB1_8_WORKLOAD_OK phases=10 mode=el0",
    "GLENDA_H5_BOOT_OK",
  ];
  for (const marker of qemuMarkers)
    if (!qemu.includes(marker)) throw new Error(`H5 QEMU evidence is missing ${marker}`);
  for (const marker of boardMarkers)
    if (!serial.includes(marker)) throw new Error(`Orange Pi Prime evidence is missing ${marker}`);
  writeTranscript("p10-qemu-port.txt", [
    "P11  QEMU MODEL TO PHYSICAL BOARD",
    "EVIDENCE: REAL H5 QEMU + REAL ORANGE PI PRIME",
    "",
    "$ vos agent qemu execute  # approved candidate, isolated worktree",
    ...qemuMarkers.slice(0, 5).map((marker) => `${marker}: OK`),
    "QEMU result: qemu_only; board gate remains separate",
    "",
    "$ vos run hardware  # physical Orange Pi Prime serial evidence",
    ...boardMarkers,
    "Boundary: QEMU predicts device semantics; only the board closes hardware.",
  ]);
}

async function collectPortalReplayEvidence(): Promise<void> {
  const base = requiredEnv("VOS_PORTAL_URL").replace(/\/$/, "");
  const token = process.env.VOS_PORTAL_TOKEN?.trim() || await login(base);
  const xv6Project = requiredOption(args, "--xv6-project-id");
  const glendaProject = requiredOption(args, "--glenda-project-id");
  const xv6SubmissionId = requiredOption(args, "--xv6-submission-id");
  const glendaSubmissionId = requiredOption(args, "--glenda-submission-id");
  const xv6 = await portalGet(base, token, `/dashboard?project_id=${encodeURIComponent(xv6Project)}`);
  const glenda = await portalGet(base, token, `/dashboard?project_id=${encodeURIComponent(glendaProject)}`);
  const xv6ProjectData = object(xv6.project, "xv6 dashboard project");
  const glendaProjectData = object(glenda.project, "glenda dashboard project");
  const xv6Stage = object(xv6ProjectData.current_stage, "xv6 current stage");
  const glendaStage = object(glendaProjectData.current_stage, "glenda current stage");
  const xv6Submission = await completedSubmission(base, token, xv6SubmissionId);
  const glendaSubmission = await completedSubmission(base, token, glendaSubmissionId);
  const xv6Run = await portalGet(base, token, `/pipelines/${encodeURIComponent(string(xv6Submission.run_id, "xv6 submission run_id"))}`);
  const glendaRun = await portalGet(base, token, `/pipelines/${encodeURIComponent(string(glendaSubmission.run_id, "glenda submission run_id"))}`);
  for (const [label, run] of [["xv6", xv6Run], ["glenda", glendaRun]] as const) {
    if (run.status !== "passed" || run.stage_key !== "lab10")
      throw new Error(`${label} authoritative run is not a passed Lab 10 run`);
  }
  const xv6Commit = string(xv6Run.commit_sha, "xv6 commit_sha");
  const glendaCommit = string(glendaRun.commit_sha, "glenda commit_sha");
  const xv6Restore = restoreCommit(
    string(xv6ProjectData.repo_url, "xv6 repository URL"),
    xv6Commit,
  );
  const glendaRestore = restoreCommit(
    string(glendaProjectData.repo_url, "glenda repository URL"),
    glendaCommit,
  );
  writeTranscript("p11-commit-replay.txt", [
    "P12  COMMIT-BOUND PORTAL RECORD AND REPLAY",
    "EVIDENCE: REAL CONNECTED XV6 + GLENDA CLOSURE",
    "",
    "$ vos portal status <authoritative-run> --watch",
    `xv6:    stage=${string(xv6Stage.key, "xv6 stage")} authoritative=passed`,
    `         commit=${xv6Commit.slice(0, 12)} run=${string(xv6Run.id, "xv6 run id")}`,
    `         checks=${number(xv6Run.passed, "xv6 passed")}/${number(xv6Run.total, "xv6 total")} result=${string(xv6Run.status, "xv6 run status")}`,
    `glenda: stage=${string(glendaStage.key, "glenda stage")} authoritative=passed`,
    `         commit=${glendaCommit.slice(0, 12)} run=${string(glendaRun.id, "glenda run id")}`,
    `         checks=${number(glendaRun.passed, "glenda passed")}/${number(glendaRun.total, "glenda total")} result=${string(glendaRun.status, "glenda run status")}`,
    "",
    `$ git checkout --detach ${xv6Commit.slice(0, 12)}  # Portal xv6 repository`,
    `restored=${xv6Restore.commit.slice(0, 12)} tracked_files=${xv6Restore.files}`,
    `$ git checkout --detach ${glendaCommit.slice(0, 12)}  # Portal Glenda repository`,
    `restored=${glendaRestore.commit.slice(0, 12)} tracked_files=${glendaRestore.files}`,
    "",
    "Portal retains public run, authoritative run, artifacts, review and failures.",
    "Boundary: Git restores tracked state; Portal restores the evidence timeline.",
  ]);
}

function restoreCommit(repoUrl: string, commit: string): { commit: string; files: number } {
  const root = mkdtempSync(join(tmpdir(), "vos-defense-replay-"));
  const checkout = join(root, "checkout");
  const username = process.env.VOS_GITEA_USERNAME ?? "student";
  const password = process.env.VOS_GITEA_PASSWORD ?? requiredEnv("VOS_GITEA_TOKEN");
  const authorization = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  const env = {
    ...process.env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.sslVerify",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_KEY_1: "http.extraHeader",
    GIT_CONFIG_VALUE_1: `Authorization: Basic ${authorization}`,
  };
  try {
    git(["clone", "--no-checkout", "--quiet", repoUrl, checkout], root, env);
    git(["fetch", "--quiet", "origin", commit], checkout, env);
    git(["checkout", "--detach", "--quiet", commit], checkout, env);
    const restored = git(["rev-parse", "HEAD"], checkout, env).trim();
    if (restored !== commit) throw new Error("restored Git commit does not match Portal");
    const files = git(["ls-tree", "-r", "--name-only", "HEAD"], checkout, env)
      .split(/\r?\n/)
      .filter(Boolean).length;
    if (files === 0) throw new Error("restored Git commit contains no tracked files");
    return { commit: restored, files };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function git(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args[0]} failed: ${sanitize(result.stderr.toString())}`);
  return result.stdout.toString();
}

async function completedSubmission(base: string, token: string, id: string): Promise<Record<string, unknown>> {
  const submission = await portalGet(base, token, `/submissions/${encodeURIComponent(id)}`);
  if (submission.status !== "complete")
    throw new Error(`Portal submission ${id} is ${String(submission.status)}, expected complete`);
  return submission;
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      username: requiredEnv("VOS_PORTAL_USERNAME"),
      password: requiredEnv("VOS_PORTAL_PASSWORD"),
    }),
  });
  if (!response.ok) throw new Error(`Portal login failed with HTTP ${response.status}`);
  const cookies = response.headers.getSetCookie().join("; ");
  const match = cookies.match(/(?:^|;\s*)vos_session=([^;]+)/);
  if (!match) throw new Error("Portal login did not return vos_session");
  return decodeURIComponent(match[1]);
}

async function portalGet(base: string, token: string, route: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}/api/v1${route}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Portal ${route} failed with HTTP ${response.status}`);
  return object(await response.json(), `Portal ${route}`);
}

function option(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function selectedSlides(value: string | undefined): Set<string> {
  const supported = new Set(["p08", "p09", "p10", "p11"]);
  if (!value) return supported;
  const selected = new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
  if (selected.size === 0) throw new Error("--only requires at least one slide ID");
  for (const slide of selected)
    if (!supported.has(slide))
      throw new Error(`unsupported slide ID ${slide}; expected p08,p09,p10,p11`);
  return selected;
}

function requiredOption(values: string[], name: string): string {
  const value = option(values, name);
  if (!value) throw new Error(`${name} <value> is required`);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function json(value: string): Record<string, unknown> {
  return object(JSON.parse(value), "JSON document");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function compact(value: string, width: number): string {
  const normalized = sanitize(value).replace(/\s+/g, " ").trim();
  return normalized.length <= width ? normalized : `${normalized.slice(0, width - 1)}…`;
}

function sanitize(value: string): string {
  return value
    .replaceAll(repoRoot, "<repo>")
    .replaceAll(glendaRoot, "<glenda>")
    .replace(/[A-Z]:\\[^\r\n"']+/gi, "<local-path>")
    .replace(/\/(?:home|Users|mnt\/[a-z])\/[^\s"'<>]*/g, "<local-path>")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "<redacted-email>");
}

function writeTranscript(name: string, lines: string[]): void {
  const content = `${sanitize(lines.join("\n")).replace(/[ \t]+$/gm, "")}\n`;
  if (content.includes(repoRoot) || content.includes(glendaRoot))
    throw new Error(`${name} contains an absolute path`);
  writeFileSync(join(transcriptRoot, name), content, "utf8");
}
