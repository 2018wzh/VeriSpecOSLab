import ora, { type Ora } from "ora";
import type { CommandStatus, ProgressMode } from "../types.ts";
import { formatCompletionLine, formatProgressLine } from "./format.ts";
import type { CommandProgress, ProgressEnvironment, ProgressUpdate } from "./types.ts";

const FRAMES = ["-", "\\", "|", "/"] as const;

export function createCommandProgress(opts: {
  mode: ProgressMode;
  json: boolean;
  env?: ProgressEnvironment;
  output?: NodeJS.WritableStream;
}): CommandProgress {
  const env = opts.env ?? {
    isTty: process.stderr.isTTY === true,
    ci: process.env.CI,
    noColor: process.env.NO_COLOR,
    columns: process.stderr.columns,
  };
  const enabled = shouldEnableProgress(opts.mode, opts.json, env);
  if (!enabled) return new NoopProgress(opts.mode);
  return new TerminalProgress({
    mode: opts.mode,
    output: opts.output ?? process.stderr,
    columns: env.columns ?? 80,
    color: !env.noColor,
    interactive: env.isTty,
    now: env.now ?? (() => Date.now()),
  });
}

export function shouldEnableProgress(
  mode: ProgressMode,
  json: boolean,
  env: ProgressEnvironment,
): boolean {
  if (json) return false;
  if (mode === "never") return false;
  if (mode === "always") return true;
  return env.isTty && !env.ci;
}

class NoopProgress implements CommandProgress {
  readonly enabled = false;
  constructor(readonly mode: ProgressMode) {}
  start(): void {}
  update(): void {}
  finish(): void {}
}

class TerminalProgress implements CommandProgress {
  readonly enabled = true;
  private readonly spinner: Ora;
  private readonly startedAt: number;
  private updateState: ProgressUpdate = { stage: "run", status: "starting", message: "starting" };
  private frameIndex = 0;
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly opts: {
    mode: ProgressMode;
    output: NodeJS.WritableStream;
    columns: number;
    color: boolean;
    interactive: boolean;
    now: () => number;
  }) {
    this.startedAt = opts.now();
    this.spinner = ora({
      text: "",
      stream: opts.output,
      isEnabled: true,
      spinner: {
        interval: 120,
        frames: [...FRAMES],
      },
      color: false,
      discardStdin: false,
    });
  }

  get mode(): ProgressMode {
    return this.opts.mode;
  }

  start(stage: string, message?: string): void {
    this.updateState = { stage, status: "starting", message: message ?? "starting" };
    if (this.opts.interactive) {
      this.spinner.text = this.line();
      this.spinner.start();
      this.startHeartbeat();
    } else {
      this.opts.output.write(`${this.line()}\n`);
    }
  }

  update(update: ProgressUpdate): void {
    this.updateState = {
      ...this.updateState,
      ...update,
      stage: update.stage || this.updateState.stage,
    };
    if (this.opts.interactive) {
      this.spinner.text = this.line();
      this.startHeartbeat();
    } else {
      this.opts.output.write(`${this.line()}\n`);
    }
  }

  finish(status: CommandStatus, message?: string): void {
    const line = formatCompletionLine({
      status,
      stage: this.updateState.stage,
      elapsedMs: this.opts.now() - this.startedAt,
      message,
      columns: this.opts.columns,
      color: this.opts.color,
    });
    if (this.spinner.isSpinning) {
      this.stopHeartbeat();
      this.spinner.stopAndPersist({ symbol: "", text: line });
    } else {
      this.stopHeartbeat();
      this.opts.output.write(`${line}\n`);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      if (!this.spinner.isSpinning) {
        this.stopHeartbeat();
        return;
      }
      this.spinner.text = this.line();
    }, 1000);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private line(): string {
    const frame = FRAMES[this.frameIndex % FRAMES.length];
    this.frameIndex++;
    return formatProgressLine({
      ...this.updateState,
      elapsedMs: this.opts.now() - this.startedAt,
      columns: this.opts.columns,
      color: this.opts.color,
      frame: this.opts.interactive ? "" : frame,
    });
  }
}
