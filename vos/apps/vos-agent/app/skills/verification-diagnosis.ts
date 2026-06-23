import type { BuiltInSkill } from "./types.ts";

export const verificationDiagnosisSkill: BuiltInSkill = {
  name: "verification-diagnosis",
  promptText: [
    "## Built-in skill: verification-diagnosis",
    "Explain verify failures as evidence chains: obligation -> suite or behavior case -> oracle -> observed output -> suspected failure.",
    "Verify remains deterministic and model-free; do not redefine pass/fail status.",
    "Map observations back to related specs, suspicious concepts, and next diagnostic commands.",
    "Student-visible output must summarize evidence, not expose full patches or staff-only data.",
  ].join("\n"),
};
