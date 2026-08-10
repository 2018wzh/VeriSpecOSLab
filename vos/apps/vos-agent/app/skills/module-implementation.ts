import type { BuiltInSkill } from "./types.ts";

export const moduleImplementationSkill: BuiltInSkill = {
  name: "module-implementation",
  promptText: [
    "## Built-in skill: module-implementation",
    "Implement only operations and behavior declared inside the committed target ModuleSpec.",
    "Bind code and generated tests to stable Spec IDs, ModuleSpec owns, required validations, and observed evidence.",
    "Do not generate future-stage modules, bypass SpecPatch gates, or widen writable targets.",
    "When constraints are incomplete, stop at the smallest complete Spec-bound implementation and report the missing evidence through the declared result tool.",
  ].join("\n"),
};
