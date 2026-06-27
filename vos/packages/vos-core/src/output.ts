import type { BaseCommandResult } from "./types.ts";
import { prettyPrint } from "./utils/print.ts";

export function renderOutput(result: BaseCommandResult, opts: { verbose?: boolean } = {}): string {
  if (!opts.verbose) {
    const lines = [
      `status: ${result.status}`,
      `message: ${result.message ?? ""}`,
      `run_id: ${result.run_id}`,
    ];
    return prettyPrint(lines);
  }

  const status = result.status;
  const lines = [
    `command: ${result.command.join(" ")}`,
    `run_id: ${result.run_id}`,
    `status: ${status}`,
    `started: ${result.started_at}`,
    `finished: ${result.finished_at}`,
  ];
  if (result.message) lines.push(`message: ${result.message}`);
  if (result.payload) {
    lines.push(`payload.kind: ${String(result.payload.kind ?? "")}`);
  }
  lines.push(`artifacts: ${result.artifacts.length}`);
  if (result.artifacts.length > 0) {
    for (const artifact of result.artifacts) {
      lines.push(`- ${artifact.kind}: ${artifact.path}`);
    }
  }
  lines.push(`evidence_refs: ${result.evidence_refs.length}`);
  if (result.details) {
    lines.push("details:");
    lines.push(JSON.stringify(result.details, null, 2));
  }
  return prettyPrint(lines);
}
