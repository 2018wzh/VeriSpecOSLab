import type { BuiltInSkill } from "./types.ts";

export const referencePolicySkill: BuiltInSkill = {
  name: "reference-policy",
  promptText: [
    "## Built-in skill: reference-policy",
    "Use course, project, KB, public evidence, and approved web references with citation and source refs.",
    "Do not copy full solutions, full modules, hidden or staff-only material, or unaudited external code.",
    "Prefer short excerpts, paraphrases, design tradeoffs, and source-linked next checks.",
    "If a claim lacks a source ref, mark it as an inference instead of presenting it as evidence.",
  ].join("\n"),
};
