import { describe, expect, test } from "bun:test";
import { parsePatchProposal } from "../src/agent/schemas.ts";

describe("agent schema coercion", () => {
  test("accepts patch arrays and object-form patch payloads", () => {
    const proposal = parsePatchProposal({
      task: "generate xv6 makefile",
      patch: {
        diff: [
          "diff --git a/Makefile b/Makefile",
          "--- /dev/null",
          "+++ b/Makefile",
        ],
      },
      bound_clauses: ["spec/stages/syscall.yaml"],
      changed_paths: ["Makefile"],
      changed_code_files: ["Makefile"],
      output_kind: "unified_diff",
      self_reported_risks: [],
    });

    expect(proposal.patch).toContain("diff --git a/Makefile b/Makefile");
  });

  test("accepts direct patch arrays as newline-joined diffs", () => {
    const proposal = parsePatchProposal({
      task: "generate xv6 makefile",
      patch: [
        "diff --git a/Makefile b/Makefile",
        "--- /dev/null",
        "+++ b/Makefile",
      ],
      bound_clauses: ["spec/stages/syscall.yaml"],
      changed_paths: ["Makefile"],
      changed_code_files: ["Makefile"],
      output_kind: "unified_diff",
      self_reported_risks: [],
    });

    expect(proposal.patch).toContain("+++ b/Makefile");
  });
});
