import { describe, expect, test } from "bun:test";
import {
  isWindows,
  relativePosixPath,
  shellInvocation,
  toPosixPath,
} from "../src/index.ts";

describe("vos-platform", () => {
  test("detects Windows from an injectable platform string", () => {
    expect(isWindows("win32")).toBe(true);
    expect(isWindows("darwin")).toBe(false);
  });

  test("normalizes paths to POSIX separators", () => {
    expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
  });

  test("returns relative paths with POSIX separators", () => {
    expect(toPosixPath(relativePosixPath("a", "a/b/c"))).toBe("b/c");
  });

  test("builds a Windows shell invocation", () => {
    expect(shellInvocation("Write-Output 1", "win32")).toEqual({
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Write-Output 1",
      ],
    });
  });

  test("builds a POSIX shell invocation", () => {
    expect(shellInvocation("echo 1", "darwin")).toEqual({
      executable: "sh",
      args: ["-c", "echo 1"],
    });
  });
});
