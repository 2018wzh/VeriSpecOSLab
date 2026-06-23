export type RunStatus = "ok" | "failed" | "timed_out";

export interface RunCommandResult {
  status: RunStatus;
  output: string;
  readyDetected: boolean;
  durationMs: number;
  serialPath?: string;
  stderrPath?: string;
  smokeResultPath?: string;
  resultPath?: string;
  profileId?: string;
  caseId?: string;
  profiles?: string[];
  cases?: string[];
}

export interface RunStdinAfter {
  pattern: string;
  text: string;
}

export function resolveRunTimeoutMs(
  timeoutMs: number | undefined,
  timeoutSecs: number | undefined,
  fallbackSecs: number,
): number {
  if (timeoutMs !== undefined) return timeoutMs;
  if (timeoutSecs !== undefined) return timeoutSecs * 1000;
  return fallbackSecs * 1000;
}

export function escapeRunShellArg(value: string): string {
  if (/\s/.test(value)) return `"${value.replace(/"/g, "\\\"")}"`;
  return value;
}

export function safeRunArtifactName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_.-]/g, "-");
}
