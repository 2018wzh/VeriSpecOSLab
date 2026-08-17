import { describe, expect, test } from "bun:test";
import { partitionGlendaCourseChecks } from "../src/main.ts";

describe("Glenda connected course checks", () => {
  const checks = {
    "boot-public": { env: ["PATH"] },
    "h5-firmware-chain-trace": {
      env: ["PATH", "GLENDA_H5_QEMU_COMMAND_JSON"],
    },
    "h5-platform-goal": { env: ["PATH"] },
    "verification-closure-report": { env: ["PATH"] },
    "verification-closure-goal": { env: ["PATH"] },
  };

  test("defers external H5 simulation to required review artifacts in Lab 9", () => {
    expect(
      partitionGlendaCourseChecks(checks, Object.keys(checks), "lab9"),
    ).toEqual({
      executed: ["boot-public"],
      deferred: [
        "h5-firmware-chain-trace",
        "h5-platform-goal",
        "verification-closure-report",
        "verification-closure-goal",
      ],
    });
  });

  test("does not hide external checks outside the hardware review stages", () => {
    expect(
      partitionGlendaCourseChecks(checks, Object.keys(checks), "lab8"),
    ).toEqual({ executed: Object.keys(checks), deferred: [] });
  });
});
