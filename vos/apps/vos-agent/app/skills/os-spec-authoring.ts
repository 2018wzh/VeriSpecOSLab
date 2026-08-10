import type { BuiltInSkill } from "./types.ts";

export const osSpecAuthoringSkill: BuiltInSkill = {
  name: "os-spec-authoring",
  promptText: [
    "## Built-in skill: os-spec-authoring",
    "Use the VOS five-family model: DesignSpec -> ModuleSpec with embedded operations -> InterfaceSpec or GoalSpec when needed -> handwritten SpecPatch for cross-module semantic changes.",
    "Treat spec files as the design truth; do not replace missing specs with implementation guesses.",
    "Keep proposals stage-bound and connect every change to validation binding or public evidence.",
    "Prefer clarifying invariants, failure semantics, dependencies, and tests before suggesting code.",
  ].join("\n"),
};
