import { createInterface } from "node:readline/promises";
import { stdin as defaultStdin, stdout as defaultStdout } from "node:process";
import type { ChatClient } from "../agent/loop.ts";
import { resolveMode, resolveModeDefinition, type Config } from "../config.ts";
import { assertThreadCanContinue, runSessionTurn } from "../session/run-turn.ts";
import type { ThreadStore } from "../session/thread-store.ts";
import type { SessionEvent } from "../session/types.ts";
import {
  expandProjectCommand,
  loadProjectCommands,
  projectCommandNames,
} from "./project-commands.ts";
import { parseSlashCommand, slashHelp } from "./slash-commands.ts";
import { transcriptItemsFromMessages } from "./transcript.ts";
import { TerminalRenderer, type WelcomeInput } from "./tui.ts";
import { StarsTuiInteractiveView } from "../tui/interactive-view.ts";
import { StarsTuiPromptInput, type StarsRawInput } from "../tui/prompt-input.ts";
import { TerminalDriver } from "../tui/terminal.ts";
import { disableMouseReporting, enableMouseReporting } from "../tui/ansi.ts";
import type { StarsTranscriptItem, StarsViewSize } from "../tui/stars-view.ts";
import { resolveStarsTuiTheme } from "../tui/theme.ts";

export type InteractiveStatus = WelcomeInput;

export interface InteractiveInput {
  readLine(): Promise<string | undefined>;
}

export interface InteractiveView {
  welcome(input: InteractiveStatus): void | Promise<void>;
  restoreTranscript?(items: readonly StarsTranscriptItem[]): void | Promise<void>;
  prompt?(message: string): void | Promise<void>;
  command(message: string): void | Promise<void>;
  status(input: InteractiveStatus): void | Promise<void>;
  error(message: string): void | Promise<void>;
  onSessionEvent(event: SessionEvent): void | Promise<void>;
}

export interface InteractiveErrorOutput {
  write(message: string): void;
}

interface InteractiveSessionOptions {
  chat: ChatClient;
  config: Config;
  store: ThreadStore;
  workspaceRoot: string;
  startDir?: string;
  mode?: string;
  model?: string;
  threadId?: string;
}

export interface RunInteractiveOptions extends InteractiveSessionOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
  debugLabels?: boolean;
  welcomeAnimation?: boolean;
}

export interface RunInteractiveControllerOptions extends InteractiveSessionOptions {
  input: InteractiveInput;
  view: InteractiveView;
  streamAssistant?: boolean;
}

class InteractiveViewError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "InteractiveViewError";
  }
}

/**
 * Starts the interactive REPL. Real TTYs get the raw-mode TUI; piped input,
 * tests, and terminals without raw-mode support keep the readline fallback.
 */
export async function runInteractive(opts: RunInteractiveOptions): Promise<void> {
  const input = opts.input ?? defaultStdin;
  const output = opts.output ?? defaultStdout;
  const error = opts.error ?? process.stderr;
  const welcomeAnimation = opts.welcomeAnimation ?? output === defaultStdout;
  if (streamIsTerminal(input) && streamIsTerminal(output) && canUseRawInput(input)) {
    await runInteractiveTui({ ...opts, input, output, welcomeAnimation });
    return;
  }

  const rl = createInterface({ input, output, terminal: streamIsTerminal(output) });
  const renderer = new TerminalRenderer({ output, debugLabels: opts.debugLabels });
  rl.setPrompt("vos-agent> ");
  const lines = rl[Symbol.asyncIterator]();

  try {
    await runInteractiveController({
      chat: opts.chat,
      config: opts.config,
      store: opts.store,
      workspaceRoot: opts.workspaceRoot,
      startDir: opts.startDir,
      mode: opts.mode,
      model: opts.model,
      threadId: opts.threadId,
      input: {
        readLine: () => readLine(lines, rl),
      },
      view: createLineModeView(renderer, error),
    });
  } finally {
    rl.close();
  }
}

async function runInteractiveTui(
  opts: RunInteractiveOptions & { input: StarsRawInput; output: TuiOutputStream },
): Promise<void> {
  const driver = new TerminalDriver(opts.output);
  const view = new StarsTuiInteractiveView({
    presenter: driver,
    size: () => terminalSize(opts.output),
    debugLabels: opts.debugLabels,
    theme: resolveStarsTuiTheme(),
    welcomeAnimation: opts.welcomeAnimation,
  });
  const promptInput = new StarsTuiPromptInput({ input: opts.input, view });
  const onResize = (): void => view.refresh();
  let resizeAttached = false;
  let mouseReportingEnabled = false;
  let primaryError: unknown;

  driver.start();
  try {
    opts.output.write(enableMouseReporting());
    mouseReportingEnabled = true;
    if (opts.output.on) {
      opts.output.on("resize", onResize);
      resizeAttached = true;
    }
    promptInput.start();
    await runInteractiveController({
      chat: opts.chat,
      config: opts.config,
      store: opts.store,
      workspaceRoot: opts.workspaceRoot,
      startDir: opts.startDir,
      mode: opts.mode,
      model: opts.model,
      threadId: opts.threadId,
      input: promptInput,
      view,
      streamAssistant: true,
    });
  } catch (e) {
    primaryError = e;
    throw e;
  } finally {
    // Restore input mode before leaving the alternate screen. If the main turn
    // already failed, preserve that primary failure and treat cleanup as best
    // effort; otherwise surface cleanup failures because they leave the user's
    // terminal in a bad state.
    let cleanupError: unknown;
    if (resizeAttached) {
      cleanupError = captureCleanupError(cleanupError, () => opts.output.off?.("resize", onResize));
    }
    cleanupError = captureCleanupError(cleanupError, () => view.close());
    cleanupError = captureCleanupError(cleanupError, () => promptInput.close());
    if (mouseReportingEnabled) {
      cleanupError = captureCleanupError(cleanupError, () => opts.output.write(disableMouseReporting()));
    }
    cleanupError = captureCleanupError(cleanupError, () => driver.close());
    if (primaryError === undefined && cleanupError !== undefined) {
      throw cleanupError;
    }
  }
}

function createLineModeView(
  renderer: TerminalRenderer,
  error: InteractiveErrorOutput,
): InteractiveView {
  return {
    welcome: (input) => renderer.welcome(input),
    command: (message) => renderer.command(message),
    status: (input) => renderer.status(input),
    error(message): void {
      error.write(`vos-agent: ${message}\n`);
    },
    onSessionEvent: (event) => renderer.onSessionEvent(event),
  };
}

export async function runInteractiveController(
  opts: RunInteractiveControllerOptions,
): Promise<void> {
  let threadId = opts.threadId;
  let modePinned = Boolean(opts.mode);
  const initialThread = threadId ? opts.store.load(threadId) : undefined;
  if (initialThread) {
    assertThreadCanContinue(initialThread, opts.workspaceRoot);
  }
  let currentThreadModel = initialThread?.model;
  let currentThreadMode = initialThread?.mode;
  let mode = opts.mode ?? currentThreadMode ?? opts.config.defaultMode;
  let useStoredThreadModel = Boolean(opts.threadId && !opts.model && !modePinned);
  const projectCommands = loadProjectCommands({ workspaceRoot: opts.workspaceRoot });
  const projectNames = projectCommandNames(projectCommands);
  const view = opts.view;

  const currentStatus = (): InteractiveStatus => ({
    threadId,
    mode: opts.model ? undefined : useStoredThreadModel ? currentThreadMode : mode,
    model: opts.model ?? (useStoredThreadModel ? currentThreadModel : undefined),
    cwd: opts.startDir ?? opts.workspaceRoot,
    disabledTools: opts.config.tools.disabled,
  });

  if (initialThread) {
    await render(() => view.restoreTranscript?.(transcriptItemsFromMessages(initialThread.messages)));
  }
  await render(() => view.welcome(currentStatus()));

  while (true) {
    const line = await opts.input.readLine();
    if (line === undefined) break;
    if (!line.trim()) continue;

    const command = parseSlashCommand(line);
    try {
      if (command.kind === "quit") break;
      if (command.kind === "help") {
        await render(() => view.command(slashHelp(projectNames)));
        continue;
      }
      if (command.kind === "new") {
        threadId = undefined;
        currentThreadModel = undefined;
        currentThreadMode = undefined;
        useStoredThreadModel = false;
        mode = opts.mode ?? opts.config.defaultMode;
        modePinned = Boolean(opts.mode);
        await render(() => view.command("new thread"));
        await render(() => view.status(currentStatus()));
        continue;
      }
      if (command.kind === "thread-show") {
        await render(() => view.command(`thread: ${threadId ?? "no active thread"}`));
        continue;
      }
      if (command.kind === "thread-switch") {
        const nextThread = opts.store.load(command.threadId);
        assertThreadCanContinue(
          nextThread,
          opts.workspaceRoot,
        );
        threadId = command.threadId;
        currentThreadModel = nextThread.model;
        currentThreadMode = nextThread.mode;
        useStoredThreadModel = !opts.model && !modePinned;
        if (useStoredThreadModel) {
          mode = currentThreadMode ?? opts.config.defaultMode;
        }
        await render(() => view.restoreTranscript?.(transcriptItemsFromMessages(nextThread.messages)));
        await render(() => view.command(`thread: ${threadId}`));
        await render(() => view.status(currentStatus()));
        continue;
      }
      if (command.kind === "mode-show") {
        await render(() => view.command(opts.model ? `mode: raw model (${opts.model})` : `mode: ${mode}`));
        continue;
      }
      if (command.kind === "mode-set") {
        if (opts.model) {
          await render(() => view.error("cannot switch mode while --model is pinned"));
          continue;
        }
        resolveMode(opts.config, command.mode);
        mode = command.mode;
        modePinned = true;
        useStoredThreadModel = false;
        await render(() => view.command(`mode: ${mode}`));
        await render(() => view.status(currentStatus()));
        continue;
      }
      if (command.kind === "todos") {
        const todos = threadId ? opts.store.load(threadId).todos : [];
        await render(() => view.command(JSON.stringify(todos, null, 2)));
        continue;
      }
      if (command.kind === "error") {
        const projectCommand = expandProjectCommand(line, projectCommands);
        if (!projectCommand) {
          await render(() => view.error(command.message));
          continue;
        }
        await render(() => view.command(`project command: /${projectCommand.name}`));
        const result = await runPrompt(projectCommand.prompt);
        threadId = result.thread.id;
        currentThreadModel = result.thread.model;
        currentThreadMode = result.thread.mode;
        mode = result.thread.mode ?? mode;
        useStoredThreadModel = Boolean(threadId && !opts.model && !modePinned);
        continue;
      }

      const turnPrompt = command.prompt;
      const result = await runPrompt(turnPrompt);
      threadId = result.thread.id;
      currentThreadModel = result.thread.model;
      currentThreadMode = result.thread.mode;
      mode = result.thread.mode ?? mode;
      useStoredThreadModel = Boolean(threadId && !opts.model && !modePinned);
    } catch (e) {
      if (e instanceof InteractiveViewError) {
        throw e.cause;
      }
      const message = e instanceof Error ? e.message : String(e);
      await render(() => view.error(message));
    }
  }

  async function render(action: () => void | Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      // Rendering/presentation failures are infrastructure errors. Do not turn
      // them into recoverable slash-command errors, because continuing could
      // leave the TUI and terminal mode out of sync.
      throw new InteractiveViewError(e);
    }
  }

  async function runPrompt(prompt: string) {
    await render(() => view.prompt?.(prompt));
    const modeDef = useStoredThreadModel || opts.model
      ? undefined
      : resolveModeDefinition(opts.config, mode);
    const model = useStoredThreadModel
      ? undefined
      : opts.model ?? modeDef?.model;
    const result = await runSessionTurn({
      chat: opts.chat,
      store: opts.store,
      workspaceRoot: opts.workspaceRoot,
      startDir: opts.startDir ?? opts.workspaceRoot,
      threadId,
      prompt,
      model,
      reasoningEffort: useStoredThreadModel || opts.model
        ? undefined
        : modeDef?.reasoningEffort,
      disabledTools: opts.config.tools.disabled,
      permissionRules: opts.config.tools.permissions,
      mode: useStoredThreadModel || opts.model ? undefined : mode,
      streamAssistant: opts.streamAssistant ?? false,
      onEvent: async (event) => {
        await render(() => view.onSessionEvent(event));
      },
    });
    return result;
  }
}

type TuiOutputStream = NodeJS.WritableStream & {
  columns?: number;
  rows?: number;
  on?: (event: "resize", listener: () => void) => unknown;
  off?: (event: "resize", listener: () => void) => unknown;
};

function streamIsTerminal(stream: NodeJS.ReadableStream | NodeJS.WritableStream): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true;
}

function canUseRawInput(stream: NodeJS.ReadableStream): stream is NodeJS.ReadableStream & StarsRawInput {
  return typeof (stream as { setRawMode?: unknown }).setRawMode === "function";
}

function terminalSize(output: TuiOutputStream): StarsViewSize {
  return {
    width: positiveIntegerOrDefault(output.columns, 80),
    height: positiveIntegerOrDefault(output.rows, 24),
  };
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function captureCleanupError(current: unknown, action: () => void): unknown {
  try {
    action();
  } catch (e) {
    return current ?? e;
  }

  return current;
}

async function readLine(
  lines: AsyncIterator<string>,
  rl: Pick<ReturnType<typeof createInterface>, "prompt">,
): Promise<string | undefined> {
  rl.prompt();
  const next = await lines.next();
  return next.done ? undefined : next.value;
}
