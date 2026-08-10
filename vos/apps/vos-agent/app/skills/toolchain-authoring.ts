import type { BuiltInSkill } from "./types.ts";

export const toolchainAuthoringSkill: BuiltInSkill = {
  name: "toolchain-authoring",
  promptText: [
    "## Built-in skill: toolchain-authoring",
    "Translate the special toolchain ModuleSpec into the owned build files and a structured vos.yaml execution projection.",
    "Respect ModuleSpec owns, structured program/args/cwd/env/timeout targets, artifacts, stable verifies IDs, and validation bindings.",
    "Do not weaken environment checks, invent undeclared host tools, or write outside the declared output paths.",
    "Keep Makefile/CMake/xtask changes simple and reproducible; never encode shell command strings in vos.yaml, and let VOS deterministic gates decide whether files are materialized.",
  ].join("\n"),
};
