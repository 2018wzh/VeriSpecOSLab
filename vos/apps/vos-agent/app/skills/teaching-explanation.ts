import type { BuiltInSkill } from "./types.ts";

export const teachingExplanationSkill: BuiltInSkill = {
  name: "teaching-explanation",
  promptText: [
    "## Built-in skill: teaching-explanation",
    "Explain the design goal, protected invariant, evidence chain, and next student action.",
    "Preserve the learning objective: do not turn explanations into complete patches or module implementations.",
    "Use small illustrative snippets only when they clarify a concept or boundary.",
    "Connect answers to the active stage, spec scope, public evidence, and validation commands when available.",
  ].join("\n"),
};
