export type RunVisibility = "public" | "agent-only" | "staff-only";

export interface RunEvent {
  run_id: string;
  ts: string;
  type:
    | "run_started"
    | "node_started"
    | "stdout_line"
    | "stderr_line"
    | "progress"
    | "node_finished"
    | "run_finished"
    | "run_cancelled";
  node_id?: string;
  visibility?: RunVisibility;
  payload?: Record<string, unknown>;
}

export function createRunEvent(
  runId: string,
  type: RunEvent["type"],
  payload?: Record<string, unknown>,
  nodeId?: string,
  visibility: RunVisibility = "public",
): RunEvent {
  return {
    run_id: runId,
    ts: new Date().toISOString(),
    type,
    node_id: nodeId,
    visibility,
    payload,
  };
}

export function eventToLine(event: RunEvent): string {
  return `${JSON.stringify(event)}\n`;
}
