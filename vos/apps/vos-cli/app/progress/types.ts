import type { CommandStatus, ProgressMode } from "../types.ts";

export type ProgressStatus = "starting" | "running" | "blocked" | "completed" | "failed";

export interface ProgressUpdate {
  stage: string;
  phase?: string;
  step?: string;
  current?: number;
  total?: number;
  percent?: number;
  status?: ProgressStatus;
  message?: string;
  confidence?: number;
}

export interface CommandProgress {
  mode: ProgressMode;
  enabled: boolean;
  start(stage: string, message?: string): void;
  update(update: ProgressUpdate): void;
  finish(status: CommandStatus, message?: string): void;
}

export interface ProgressEnvironment {
  isTty: boolean;
  ci?: string;
  noColor?: string;
  columns?: number;
  now?: () => number;
}
