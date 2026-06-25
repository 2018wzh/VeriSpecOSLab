import type { BuiltInSkill } from "./types.ts";

export const toolchainAuthoringSkill: BuiltInSkill = {
  name: "toolchain-authoring",
  promptText: [
    "## Built-in skill: toolchain-authoring",
    "Translate the ToolchainSpec semantic build contract into a minimal draft build system and manifest.",
    "Respect allowed_output_path, required tools, build variants, run cases, artifacts, and validation bindings.",
    "Do not weaken environment checks, invent undeclared host tools, or write outside the declared output paths.",
    "Keep Makefile/CMake/task drafts boring and reproducible; VOS deterministic gates decide whether files are materialized.",
  ].join("\n"),
};
