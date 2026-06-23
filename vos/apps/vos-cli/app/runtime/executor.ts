import { spawn, spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
    let stdinFifo: { dir: string; path: string; readyPath: string; fd: number } | undefined;
    const needsStdin = opts.stdin !== undefined || opts.stdinAfter !== undefined;
    try {
      if (needsStdin) {
        stdinFifo = createStdinFifo();
      }
    } catch (error) {
      reject(error);
      return;
    }
    const command = stdinFifo
      ? ["sh", "-c", "exec 3< \"$VOS_STDIN_FIFO\"; : > \"$VOS_STDIN_READY\"; exec \"$@\" <&3", "vos-stdin", ...opts.command]
      : opts.command;
    const env = stdinFifo
      ? { ...process.env, ...opts.env, VOS_STDIN_FIFO: stdinFifo.path, VOS_STDIN_READY: stdinFifo.readyPath }
      : opts.env ? { ...process.env, ...opts.env } : process.env;
    let timedOut = false;
    const proc = spawn(command[0], command.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    const outChunks: string[] = [];
    const errChunks: string[] = [];
    let stoppedByCondition = false;
    let delayedStdinWritten = opts.stdinAfter === undefined;
    let settled = false;

    const cleanupStdinFifo = () => {
      if (!stdinFifo) return;
      try {
        closeSync(stdinFifo.fd);
      } catch {
        // already closed
      }
      rmSync(stdinFifo.dir, { recursive: true, force: true });
      stdinFifo = undefined;
    };

    const writeChildStdin = (text: string) => {
      if (stdinFifo) {
        if (!existsSync(stdinFifo.readyPath)) {
          setTimeout(() => {
            if (!settled) writeChildStdin(text);
          }, 1);
          return;
        }
        writeSync(stdinFifo.fd, text);
        cleanupStdinFifo();
      } else {
        proc.stdin?.write(text, () => {
          proc.stdin?.end();
        });
      }
    };

    const onData = (buffer: Buffer, target: string[]) => {
      const text = buffer.toString();
      target.push(text);
      const output = {
        stdout: outChunks.join(""),
        stderr: errChunks.join(""),
      };
      if (!delayedStdinWritten && opts.stdinAfter && new RegExp(opts.stdinAfter.pattern).test(`${output.stdout}${output.stderr}`)) {
        delayedStdinWritten = true;
        writeChildStdin(opts.stdinAfter.text);
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

    proc.stdin?.on("error", () => {});
    if (opts.stdin !== undefined) {
      writeChildStdin(opts.stdin);
    } else if (!opts.stdinAfter) {
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
      cleanupStdinFifo();
      opts.signal?.removeEventListener("abort", abortProcess);
      reject(error);
    });

    proc.on("close", (code, signal) => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      cleanupStdinFifo();
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

function createStdinFifo(): { dir: string; path: string; readyPath: string; fd: number } {
  const dir = mkdtempSync(path.join(tmpdir(), "vos-stdin-"));
  const fifoPath = path.join(dir, "stdin");
  const readyPath = path.join(dir, "ready");
  const result = spawnSync("mkfifo", [fifoPath]);
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`failed to create stdin FIFO: ${result.stderr.toString().trim()}`);
  }
  return {
    dir,
    path: fifoPath,
    readyPath,
    fd: openSync(fifoPath, constants.O_RDWR | constants.O_NONBLOCK),
  };
}
