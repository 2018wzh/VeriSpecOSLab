import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { CourseManifestV1Schema } from "vos-core/portal-contracts";

test("Glenda manifest exposes only the Lab 1-10 course model", async () => {
  const root = path.resolve(import.meta.dirname, "../../../..");
  const manifest = CourseManifestV1Schema.parse(
    parse(await readFile(path.join(root, "courses/glenda-spec/course.yaml"), "utf8")),
  );
  expect(manifest.experiment.title).toBe("Glenda Lab 1-10");
  expect(manifest.stages.map((stage) => stage.key)).toEqual(
    Array.from({ length: 10 }, (_, index) => `lab${index + 1}`),
  );
  expect(manifest.stages.map((stage) => stage.source_ref)).toEqual(
    Array.from({ length: 10 }, (_, index) => `course/lab${index + 1}-complete`),
  );
  for (const stage of manifest.stages.slice(0, 8)) {
    expect(stage.required_artifacts).toContain("replay-bundle");
    expect(stage.required_review_artifacts).toEqual([]);
  }
  for (const stage of manifest.stages)
    expect(stage.required_showcase_artifacts).toEqual([`${stage.key}-replay-bundle`]);
  expect(manifest.stages[8].required_review_artifacts).toEqual([
    "h5-simulation-report",
    "orangepi-prime-serial-log",
    "orangepi-prime-hardware-report",
  ]);
  expect(manifest.stages[9].required_review_artifacts).toEqual([
    "lab10-verification-report",
    "lab10-reproducibility-package",
    "orangepi-prime-hardware-report",
  ]);
});

test("Glenda connected replay preserves command, Git and Portal lineage for showcase", async () => {
  const script = await readFile(
    path.resolve(import.meta.dirname, "../scripts/glenda-student-cli-connected.ts"),
    "utf8",
  );
  for (const step of ["spec-lint", "agent-ask", "agent-review", "build", "qemu", "verify", "report"])
    expect(script).toContain(`name: "${step}"`);
  expect(script).toContain('"glenda-replay-bundle.v1"');
  expect(script).toContain('"glenda-showcase-index.v1"');
  expect(script).toContain('"glenda-history-replay-journal.v1"');
  expect(script).toContain("VOS_GLENDA_STUDENT_THROUGH");
  expect(script).toContain("VOS_GLENDA_ALLOW_CANDIDATE_REFS");
  expect(script).toContain("VOS_GLENDA_RESUME_BASE_REF");
  expect(script).toContain("VOS_GLENDA_HISTORY_AUDIT_REQUIRED");
  expect(script).toContain('runGit(process.cwd(), ["--exec-path"]');
  expect(script).toContain('path.join(candidate, "sh.exe")');
  expect(script).toContain('"glenda-history-audit"');
  expect(script).toContain("failed_run_ids");
  expect(script).toContain('"--prepare-history-journal"');
  expect(script).toContain('"--format=%H%x09%P%x09%s"');
  expect(script).toContain("public_run_id: publicRunId");
  expect(script).toContain("submission_run_id: submissionRunId");
  expect(script).toContain("showcase_index_label");
  for (const action of [
    "portal-login",
    "portal-bind",
    "portal-resume",
    "source-repair",
    "portal-history-audit-upload",
    "gitea-push-main",
    "portal-public-run",
    "portal-evidence",
    "portal-submit",
    "portal-authoritative-run",
    "portal-stage-closure",
  ]) expect(script).toContain(`"${action}"`);
  expect(script).toContain("portal_timeline: portalTimeline");
});
