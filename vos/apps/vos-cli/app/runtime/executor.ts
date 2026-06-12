import { spawn } from "node:child_process";

export interface ExecutorResult {
  command: string[];
  exitCode: number | null;
  signal?: string;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ExecutorOptions {
  command: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  stdin?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export async function runCommand(opts: ExecutorOptions): Promise<ExecutorResult> {
  const start = Date.now();
  const cwd = opts.cwd;

  return new Promise((resolve, reject) => {
    let timedOut = false;
    const proc = spawn(opts.command[0], opts.command.slice(1), {
      cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    const outChunks: string[] = [];
    const errChunks: string[] = [];

    const onData = (buffer: Buffer, target: string[]) => {
      const text = buffer.toString();
      target.push(text);
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.length === 0) continue;
        if (target === outChunks) {
          opts.onStdoutLine?.(line);
        } else {
          opts.onStderrLine?.(line);
        }
      }
    };

    proc.stdout?.on("data", (chunk) => onData(chunk as Buffer, outChunks));
    proc.stderr?.on("data", (chunk) => onData(chunk as Buffer, errChunks));

    if (opts.stdin !== undefined) {
      proc.stdin?.write(opts.stdin);
      proc.stdin?.end();
    }

    const timer = opts.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;

    proc.on("error", (error) => {
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });

    proc.on("close", (code, signal) => {
      if (timer !== undefined) clearTimeout(timer);
      const durationMs = Date.now() - start;
      resolve({
        command: opts.command,
        exitCode: code,
        signal: signal ?? undefined,
        timedOut,
        stdout: outChunks.join(""),
        stderr: errChunks.join(""),
        durationMs,
      });
    });
  });
}

