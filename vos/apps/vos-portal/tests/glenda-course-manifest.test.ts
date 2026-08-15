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
