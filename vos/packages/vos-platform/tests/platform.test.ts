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

  test("builds a Windows Bash invocation", () => {
    expect(shellInvocation("printf 1", "win32", "C:\\Git\\bin\\bash.exe")).toEqual({
      executable: "C:\\Git\\bin\\bash.exe",
      args: ["--noprofile", "--norc", "-c", "printf 1"],
    });
  });

  test("builds a POSIX Bash invocation", () => {
    expect(shellInvocation("echo 1", "darwin")).toEqual({
      executable: "bash",
      args: ["--noprofile", "--norc", "-c", "echo 1"],
    });
  });
});
