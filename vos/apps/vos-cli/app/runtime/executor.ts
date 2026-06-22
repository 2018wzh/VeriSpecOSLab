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
  timeoutGraceMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  stdinAfter?: {
    pattern: string;
    text: string;
  };
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
  stopWhen?: (output: { stdout: string; stderr: string }) => boolean;
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
    let stoppedByCondition = false;
    let delayedStdinWritten = false;
    let settled = false;

    const onData = (buffer: Buffer, target: string[]) => {
      const text = buffer.toString();
      target.push(text);
      const output = {
        stdout: outChunks.join(""),
        stderr: errChunks.join(""),
      };
      if (!delayedStdinWritten && opts.stdinAfter && new RegExp(opts.stdinAfter.pattern).test(`${output.stdout}${output.stderr}`)) {
        delayedStdinWritten = true;
        proc.stdin?.write(opts.stdinAfter.text, () => {
          proc.stdin?.end();
        });
      }
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.length === 0) continue;
        if (target === outChunks) {
          opts.onStdoutLine?.(line);
        } else {
          opts.onStderrLine?.(line);
        }
      }
      if (!stoppedByCondition && opts.stopWhen?.(output)) {
        stoppedByCondition = true;
        proc.kill("SIGTERM");
      }
    };

    proc.stdout?.on("data", (chunk) => onData(chunk as Buffer, outChunks));
    proc.stderr?.on("data", (chunk) => onData(chunk as Buffer, errChunks));

    if (opts.stdinAfter) {
      proc.stdin?.write("");
    } else if (opts.stdin !== undefined) {
      proc.stdin?.write(opts.stdin);
      proc.stdin?.end();
    }

    const killProcess = () => {
      proc.kill("SIGKILL");
    };

    const abortProcess = () => {
      if (settled) return;
      proc.kill("SIGTERM");
      graceTimer = setTimeout(killProcess, opts.timeoutGraceMs ?? 500);
    };

    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = opts.timeoutMs !== undefined
      ? setTimeout(() => {
          timedOut = true;
          if (opts.timeoutGraceMs && outChunks.length === 0 && errChunks.length === 0) {
            graceTimer = setTimeout(killProcess, opts.timeoutGraceMs);
          } else {
            killProcess();
          }
        }, opts.timeoutMs)
      : undefined;

    if (opts.signal?.aborted) {
      abortProcess();
    } else {
      opts.signal?.addEventListener("abort", abortProcess, { once: true });
    }

    proc.on("error", (error) => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      opts.signal?.removeEventListener("abort", abortProcess);
      reject(error);
    });

    proc.on("close", (code, signal) => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      opts.signal?.removeEventListener("abort", abortProcess);
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
