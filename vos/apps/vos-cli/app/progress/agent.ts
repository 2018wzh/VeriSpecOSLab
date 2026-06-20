import { fileURLToPath } from "node:url";
import path from "node:path";
import type { McpServerConfig } from "vos-agent/headless";
import type { ProgressUpdate } from "./types.ts";

export const PROGRESS_MCP_SERVER_NAME = "vos-progress";
export const PROGRESS_MCP_TOOL_NAME = "mcp__vos-progress__report_progress";

export function createProgressMcpServerConfig(projectRoot: string): McpServerConfig {
  const mainPath = fileURLToPath(new URL("../main.ts", import.meta.url));
  const executable = path.basename(process.execPath).toLowerCase();
  const bunLike = executable === "bun" || executable.startsWith("bun-");
  return {
    name: PROGRESS_MCP_SERVER_NAME,
    command: process.execPath,
    args: bunLike ? [mainPath, "internal", "progress-mcp"] : ["internal", "progress-mcp"],
    cwd: projectRoot,
  };
}

export function appendAgentProgressInstructions(prompt: string): string {
  return [
    prompt,
    "",
    "VOS CLI progress reporting:",
    `- When the tool ${PROGRESS_MCP_TOOL_NAME} is available, call it at key milestones only.`,
    "- Report start, context understanding, before/after major tool or validation work, and before final output.",
    "- Keep message concise, single-line, and safe for a terminal status line.",
    "- Do not call the progress tool for every small action.",
    "- The progress report is auxiliary and must not replace the requested final JSON output.",
  ].join("\n");
}

export function parseProgressToolArguments(value: unknown): ProgressUpdate | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const raw = parsed as Record<string, unknown>;
    const stage = readString(raw.stage);
    const message = readString(raw.message);
    const status = readString(raw.status);
    if (!stage || !message || !isProgressStatus(status)) return undefined;
    const update: ProgressUpdate = { stage, message, status };
    copyString(raw, update, "phase");
    copyString(raw, update, "step");
    copyNumber(raw, update, "current");
    copyNumber(raw, update, "total");
    copyNumber(raw, update, "percent");
    copyNumber(raw, update, "confidence");
    return update;
  } catch {
    return undefined;
  }
}

export function progressUpdateFromAgentEvent(
  event: Record<string, unknown>,
  fallbackStage: string,
): ProgressUpdate | undefined {
  const type = readString(event.type);
  if (type === "thread.created" || type === "thread.loaded") {
    return { stage: fallbackStage, status: "running", message: "agent started", percent: 5 };
  }
  if (type === "assistant.message") {
    const toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
    if (toolCalls.length > 0) {
      return {
        stage: fallbackStage,
        status: "running",
        message: `agent requested ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`,
      };
    }
    return { stage: fallbackStage, status: "running", message: "agent reasoning" };
  }
  if (type === "tool.call") {
    const name = readString(event.name);
    if (name === PROGRESS_MCP_TOOL_NAME) {
      return parseProgressToolArguments(event.arguments);
    }
    return {
      stage: fallbackStage,
      status: "running",
      message: name ? `running ${shortToolName(name)}` : "running tool",
    };
  }
  if (type === "tool.result") {
    const name = readString(event.name);
    if (name === PROGRESS_MCP_TOOL_NAME) return undefined;
    return {
      stage: fallbackStage,
      status: "running",
      message: name ? `${shortToolName(name)} done` : "tool done",
    };
  }
  if (type === "thread.saved") {
    return { stage: fallbackStage, status: "running", message: "saving thread" };
  }
  if (type === "agent.done" || type === "done") {
    return { stage: fallbackStage, status: "completed", message: "agent finished", percent: 100 };
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shortToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return parts.at(-1) || name;
  }
  return name;
}

function isProgressStatus(value: string | undefined): value is ProgressUpdate["status"] {
  return value === "starting" ||
    value === "running" ||
    value === "blocked" ||
    value === "completed" ||
    value === "failed";
}

function copyString(raw: Record<string, unknown>, out: ProgressUpdate, key: keyof ProgressUpdate): void {
  const value = readString(raw[key]);
  if (!value) return;
  if (key === "phase") out.phase = value;
  if (key === "step") out.step = value;
}

function copyNumber(raw: Record<string, unknown>, out: ProgressUpdate, key: keyof ProgressUpdate): void {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  if (key === "current") out.current = value;
  if (key === "total") out.total = value;
  if (key === "percent") out.percent = value;
  if (key === "confidence") out.confidence = value;
}
