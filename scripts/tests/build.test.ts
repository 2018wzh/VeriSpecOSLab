import { describe, expect, test } from "bun:test";
import { resolveBuildSettings, resolveCommandVersion } from "../build.ts";

function slash(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("root release build settings", () => {
  test("uses platform-native default output names", () => {
    expect(slash(resolveBuildSettings({}, "linux").outputFile)).toBe("../dist/vos");
    expect(slash(resolveBuildSettings({}, "darwin").outputFile)).toBe("../dist/vos");
    expect(slash(resolveBuildSettings({}, "win32").outputFile)).toBe("../dist/vos.exe");
  });

  test("accepts explicit release output and Bun compile target", () => {
    const settings = resolveBuildSettings({
      VOS_BUILD_OUTFILE: "release/vos-linux-arm64",
      VOS_BUILD_TARGET: "bun-linux-arm64",
    }, "linux");

    expect(slash(settings.outputFile)).toBe("../release/vos-linux-arm64");
    expect(settings.buildArgs).toContain("--target=bun-linux-arm64");
  });

  test("uses release version metadata when provided", () => {
    expect(resolveCommandVersion("abc123", {})).toBe("abc123");
    expect(resolveCommandVersion("abc123", { VOS_COMMAND_VERSION: "0.1.0" })).toBe("0.1.0");
  });
});
