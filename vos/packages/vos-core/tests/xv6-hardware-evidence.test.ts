import { describe, expect, test } from "bun:test";
import { validateXv6VisionFive2EvidenceText } from "../src/main.ts";

describe("xv6 VisionFive 2 evidence", () => {
  const complete = [
    "XV6_BOOT_OK",
    "sd: write test ok",
    "hart 2 starting",
    "hart 1 starting",
    "hart 3 starting",
    "usertests starting",
    "ALL TESTS PASSED",
  ].join("\n");

  test("accepts a complete four-hart usertests summary", () => {
    expect(() => validateXv6VisionFive2EvidenceText(complete)).not.toThrow();
  });

  test("fails closed when the authoritative completion marker is absent", () => {
    expect(() =>
      validateXv6VisionFive2EvidenceText(
        complete.replace("ALL TESTS PASSED", "usertests interrupted"),
      ),
    ).toThrow("missing ALL TESTS PASSED");
  });
});
