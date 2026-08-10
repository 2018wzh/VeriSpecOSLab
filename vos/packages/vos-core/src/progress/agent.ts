import { fileURLToPath } from "node:url";
import path from "node:path";
import type { McpServerConfig } from "vos-agent/headless";
import type { ProgressUpdate } from "./types.ts";

export const PROGRESS_MCP_SERVER_NAME = "vos-progress";
export const PROGRESS_MCP_TOOL_NAME = "mcp__vos-progress__report_progress";
export const SUBMIT_RESULT_MCP_TOOL_NAME = "mcp__vos-progress__submit_result";

export function createProgressMcpServerConfig(projectRoot: string): McpServerConfig {
  const mainPath = fileURLToPath(new URL("./mcp-entry.ts", import.meta.url));
  const executable = path.basename(process.execPath).toLowerCase().replace(/\.exe$/, "");
  const bunLike = executable === "bun" || executable.startsWith("bun-");
  return {
    name: PROGRESS_MCP_SERVER_NAME,
    command: process.execPath,
    args: bunLike ? [mainPath, "internal", "progress-mcp"] : ["internal", "progress-mcp"],
    cwd: projectRoot,
  };
}

export function appendAgentProgressInstructions(prompt: string, resultSchemaId?: string): string {
  const resultContract = resultSchemaId ? resultSubmissionContract(resultSchemaId) : "";
  return [
    prompt,
    "",
    "VOS CLI MCP hard protocol:",
    `- You MUST call ${PROGRESS_MCP_TOOL_NAME} at the start, after understanding context, before and after each major phase, before and after validation work, and immediately before final submission.`,
    "- Keep message concise, single-line, and safe for a terminal status line.",
    "- Do not call the progress tool for every small action.",
    resultSchemaId
      ? `- You MUST submit the final result by calling ${SUBMIT_RESULT_MCP_TOOL_NAME} with schema_id "${resultSchemaId}".`
      : "",
    resultContract,
    resultSchemaId
      ? "- If submit_result returns an error, fix the same schema payload and call submit_result again."
      : "",
    resultSchemaId
      ? "- Final assistant text is ignored by vos-cli; only an accepted submit_result payload is read."
      : "- The progress report is auxiliary and must not replace the requested final JSON output.",
  ].join("\n");
}

function resultSubmissionContract(schemaId: string): string {
  if (schemaId === "student_implementation_result.v1") {
    return "- The result object must contain status plus test_targets and hidden_tests. Only status passed is accepted: failed, blocked, or partial is returned as a tool error so you can continue repairing in the same thread. Propose at least one public, contract, fixed-seed fuzz, and bounded trace target. Every fuzz seed and hidden-test seed must be a JSON integer, not a quoted string. Keep paths relative; use {hidden_test} in hidden-test args for the generated private file path.";
  }
  if (schemaId === "knowledgebase_answer.v1") {
    return "- The result object must contain answer, design_goal_alignment, citations, suggested_next_steps, and allowed_snippets arrays. Each citation must be exactly {source_id, title, object_ref?, chunk_id?}; use only source IDs and titles actually shown by the knowledge tools, and submit an empty citations array when no source was used.";
  }
  return "";
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
    if (name === PROGRESS_MCP_TOOL_NAME || name === SUBMIT_RESULT_MCP_TOOL_NAME) return undefined;
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
