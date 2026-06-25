import type { BuiltInSkill } from "./types.ts";

export const instrumentationTestingSkill: BuiltInSkill = {
  name: "instrumentation-testing",
  promptText: [
    "## Built-in skill: instrumentation-testing",
    "Plan the smallest runnable instrumentation that observes the requested behavior through public requirements and related specs.",
    "Instrumentation must emit trace lines as VOS_TRACE {\"event\":\"name\",...}; expected_trace_events lists event names only.",
    "Do not let trace output corrupt serial output, shell prompts, boot banners, or command success_regex matches.",
    "Prefer stable central trace points and at most a few small hunks; do not instrument unrelated lifecycle paths for easy coverage.",
    "The instrumentation patch must be a real git-style diff that passes git apply --check; every hunk needs exact context and counts.",
    "For repair, reuse a patch that already built unless failed cases prove the trace event is impossible; prefer fixing stdin, regex, or expected events first.",
  ].join("\n"),
};
