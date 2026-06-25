import type { BuiltInSkill } from "./types.ts";

export const operationCodegenSkill: BuiltInSkill = {
  name: "operation-codegen",
  promptText: [
    "## Built-in skill: operation-codegen",
    "Generate only candidate drafts from approved specs and codegen targets.",
    "Bind output to affected specs, allowed paths, required validations, and observed evidence.",
    "Do not generate future-stage modules, bypass SpecPatch gates, or widen writable targets.",
    "When constraints are incomplete, produce the smallest spec-bound draft and name the missing evidence.",
  ].join("\n"),
};
