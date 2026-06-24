import type { CommandStatus } from "../types.ts";
import type { ProgressStatus, ProgressUpdate } from "./types.ts";

export interface ProgressLineInput extends ProgressUpdate {
  elapsedMs: number;
  columns: number;
  frame?: string;
  color?: boolean;
}

export function formatProgressLine(input: ProgressLineInput): string {
  const status = input.status ?? "running";
  const frame = input.frame ?? "-";
  const percent = normalizedPercent(input);
  const elapsed = formatElapsed(input.elapsedMs);
  const stage = compact(input.stage || "run");
  const message = compact(input.message || labelForStatus(status));
  const prefix = percent === undefined
    ? frame
    : formatBar(percent, barWidth(input.columns));
  const percentText = percent === undefined || input.columns < 54
    ? ""
    : ` ${String(percent).padStart(3, " ")}%`;
  const lead = prefix ? `${prefix}${percentText} ` : "";
  const base = truncateLine(`${lead}${stage} ${message} ${elapsed}`, input.columns);
  return colorize(base, status, input.color !== false);
}

export function formatCompletionLine(input: {
  status: CommandStatus;
  stage: string;
  elapsedMs: number;
  message?: string;
  columns: number;
  color?: boolean;
}): string {
  const ok = isSuccessStatus(input.status);
  const label = ok ? "OK" : "FAIL";
  const verb = ok ? "completed" : "failed";
  const detail = input.message && !ok ? `: ${compact(input.message)}` : "";
  const line = truncateLine(`${label} ${compact(input.stage || "run")} ${verb} in ${formatElapsed(input.elapsedMs)}${detail}`, input.columns);
  return colorize(line, ok ? "completed" : "failed", input.color !== false);
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function formatBar(percent: number, width: number): string {
  const safeWidth = Math.max(6, width);
  const filled = Math.round((clamp(percent, 0, 100) / 100) * safeWidth);
  return `[${"#".repeat(filled)}${"-".repeat(safeWidth - filled)}]`;
}

export function truncateLine(line: string, columns: number): string {
  const clean = line.replace(/\s+/g, " ").trim();
  const width = Math.max(20, columns);
  if (clean.length <= width) return clean;
  if (width <= 3) return clean.slice(0, width);
  return `${clean.slice(0, width - 3)}...`;
}

export function statusColor(status: ProgressStatus): string {
  if (status === "completed") return "\u001b[32m";
  if (status === "failed") return "\u001b[31m";
  if (status === "blocked") return "\u001b[33m";
  if (status === "starting" || status === "running") return "\u001b[36m";
  return "";
}

function normalizedPercent(input: ProgressUpdate): number | undefined {
  if (typeof input.percent === "number" && Number.isFinite(input.percent)) {
    return Math.round(clamp(input.percent, 0, 100));
  }
  if (
    typeof input.current === "number" &&
    typeof input.total === "number" &&
    Number.isFinite(input.current) &&
    Number.isFinite(input.total) &&
    input.total > 0
  ) {
    return Math.round(clamp((input.current / input.total) * 100, 0, 100));
  }
  return undefined;
}

function barWidth(columns: number): number {
  if (columns < 44) return 8;
  if (columns < 64) return 16;
  if (columns < 96) return 24;
  return 32;
}

function labelForStatus(status: ProgressStatus): string {
  if (status === "starting") return "starting";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function colorize(line: string, status: ProgressStatus, enabled: boolean): string {
  if (!enabled) return line;
  const color = statusColor(status);
  return color ? `${color}${line}\u001b[0m` : line;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isSuccessStatus(status: CommandStatus): boolean {
  return status === "passed" || status === "ok" || status === "planned";
}
