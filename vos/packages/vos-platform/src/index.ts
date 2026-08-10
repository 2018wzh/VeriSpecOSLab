import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface ShellInvocation {
  executable: string;
  args: string[];
}

export function isWindows(platform: string = process.platform): boolean {
  return platform === "win32";
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function relativePosixPath(from: string, to: string): string {
  return toPosixPath(path.relative(from, to));
}

export function shellInvocation(
  command: string,
  platform: string = process.platform,
  bashExecutable?: string,
): ShellInvocation {
  if (isWindows(platform)) {
    return {
      executable: bashExecutable ?? windowsGitBashExecutable(),
      args: ["--noprofile", "--norc", "-c", command],
    };
  }
  return { executable: "bash", args: ["--noprofile", "--norc", "-c", command] };
}

let cachedWindowsGitBash: string | undefined;

function windowsGitBashExecutable(): string {
  if (cachedWindowsGitBash) return cachedWindowsGitBash;
  const git = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  if (git.status === 0) {
    const execPath = git.stdout.trim();
    const candidate = path.resolve(execPath, "..", "..", "..", "bin", "bash.exe");
    if (existsSync(candidate)) {
      cachedWindowsGitBash = candidate;
      return candidate;
    }
  }
  cachedWindowsGitBash = "bash.exe";
  return cachedWindowsGitBash;
}
