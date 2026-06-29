import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_EXCERPT_CHARS = 3000;

export interface DemoArtifactInput {
  kind?: unknown;
  path?: unknown;
}

export interface DemoArtifactExcerpt {
  kind: string;
  path: string;
  text: string;
  truncated: boolean;
}

export function buildAskDemoTask(question: string): string {
  return [
    "VOS public demo full-flow Ask turn.",
    "Answer for an external public demo viewer.",
    "Show the full flow: project context, design goal, evidence/citations, and suggested next steps.",
    "Explicitly name the teaching objective this project flow helps a student learn.",
    "When asked for visual analysis, timelines, boot flow, architecture flow, or evidence navigation, prefer a complete self-contained visualization_html document suitable for iframe sandbox display.",
    "visualization_html must be literal HTML starting with <!doctype html> or <html>; do not return a URL.",
    "Also summarize the same visual narrative in rich markdown tables, ordered lists, and text diagrams in the answer.",
    "Do not claim that you started, hosted, published, or opened a local visualization page.",
    "Do not include localhost, 127.0.0.1, or external visualization links in prose fields.",
    "Use citations and object refs when available; do not expose hidden tests, secrets, or staff-only material.",
    "",
    `User question: ${question}`,
  ].join("\n");
}

export function buildDebugDemoTask(message: string): string {
  return [
    "VOS public demo full-flow Debug turn.",
    "Diagnose the selected run for an external public demo viewer.",
    "Show the full flow: failure overview, evidence chain, timeline, GDB/trace status, student-visible limitations, and next diagnostic commands.",
    "Explicitly name the teaching objective this failed run can help a student learn.",
    "The structured output MUST include a complete self-contained visualization_html document suitable for iframe sandbox display.",
    "Use visualization_html for the primary explanation whenever the user asks for visual analysis, timelines, boot flow, traces, or evidence navigation.",
    "Prefer an interactive, responsive HTML visualization with timeline controls, stage navigation, and readable labels when it helps explain the debug evidence.",
    "visualization_html must be literal HTML starting with <!doctype html> or <html>; do not return a URL.",
    "Do not claim that you started, hosted, published, or opened a local visualization page; the demo server will embed visualization_html itself.",
    "Do not include localhost, 127.0.0.1, or external visualization links in prose fields.",
    "Do not expose hidden tests, secrets, full policy text, or raw staff-only events.",
    "",
    `User debug request: ${message}`,
  ].join("\n");
}

export async function collectDebugArtifactExcerpts(
  projectRoot: string,
  runId: string,
  artifacts: readonly DemoArtifactInput[],
): Promise<DemoArtifactExcerpt[]> {
  const out: DemoArtifactExcerpt[] = [];
  for (const artifact of artifacts) {
    const relativePath = typeof artifact.path === "string" ? artifact.path : "";
    if (!isSafeRunArtifactPath(projectRoot, runId, relativePath)) continue;
    const fullPath = path.resolve(projectRoot, relativePath);
    const buffer = await readFile(fullPath).catch(() => undefined);
    if (!buffer || looksBinary(buffer)) continue;
    const raw = buffer.toString("utf8");
    const redacted = redactSecrets(raw);
    out.push({
      kind: typeof artifact.kind === "string" ? artifact.kind : "artifact",
      path: relativePath.replace(/\\/g, "/"),
      text: redacted.slice(0, MAX_EXCERPT_CHARS),
      truncated: redacted.length > MAX_EXCERPT_CHARS,
    });
  }
  return out;
}

function isSafeRunArtifactPath(projectRoot: string, runId: string, relativePath: string): boolean {
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) return false;
  if (!normalized.startsWith(`.vos/runs/${runId}/artifacts/`)) return false;
  const fullPath = path.resolve(projectRoot, normalized);
  const runRoot = path.resolve(projectRoot, ".vos", "runs", runId);
  return fullPath.startsWith(`${runRoot}${path.sep}`) && existsSync(fullPath);
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  if (sample.includes(0)) return true;
  let control = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) control++;
  }
  return sample.length > 0 && control / sample.length > 0.1;
}

function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer <redacted>")
    .replace(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*=)[^\s]+/gi, "$1<redacted>");
}
