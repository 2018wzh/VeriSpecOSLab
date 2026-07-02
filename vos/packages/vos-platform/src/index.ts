import path from "node:path";

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
): ShellInvocation {
  if (isWindows(platform)) {
    return {
      executable: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
    };
  }
  return { executable: "sh", args: ["-c", command] };
}
