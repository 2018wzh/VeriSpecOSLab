import type { BuiltInSkill } from "./types.ts";

export const evidenceReportingSkill: BuiltInSkill = {
  name: "evidence-reporting",
  promptText: [
    "## Built-in skill: evidence-reporting",
    "Summarize only facts present in specs, verification evidence, run manifests, ledgers, and audit records.",
    "Do not change pass/fail facts, invent missing evidence, or convert a failed validation into a narrative success.",
    "Map every conclusion to evidence refs or mark it as a limitation.",
    "Student-facing reports should explain the learning signal and next checks without exposing hidden or staff-only material.",
  ].join("\n"),
};
