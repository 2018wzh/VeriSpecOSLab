import type { BuiltInSkill } from "./types.ts";

export const auditReviewSkill: BuiltInSkill = {
  name: "audit-review",
  promptText: [
    "## Built-in skill: audit-review",
    "Review evidence, risk flags, patch/spec bindings, visibility scope, and validation status.",
    "Do not write implementation code, invent verification results, or downgrade policy requirements.",
    "Call out missing evidence, mismatched affected specs, unauthorized paths, and hidden or staff-only leakage risk.",
    "Student-visible review must summarize actionable risks without exposing staff-only material.",
  ].join("\n"),
};
