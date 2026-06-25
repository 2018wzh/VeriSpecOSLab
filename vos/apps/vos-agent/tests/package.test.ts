import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../package.json";
import {
  resolveAgentTaskProfile,
  runAgentTask,
  runControlledTuiAgentTask,
  runInteractiveAgentTask,
  startControlledTuiAgentTask,
  startAgentHttpServer,
  startReadonlyAgentDisplay,
} from "vos-agent/headless";
import { CallbackChatClient, textResponse, toolCallResponse } from "./helpers/stub-chat.ts";

const tmpRoots: string[] = [];
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(testDir);
const workspaceRoot = dirname(dirname(packageRoot));

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("package metadata", () => {
  test("brands the package as vos-agent", () => {
    expect(packageJson.name).toBe("vos-agent");
  });

  test("exposes only the vos-agent binary", () => {
    expect(packageJson.bin).toEqual({ "vos-agent": "./app/main.ts" });
  });

  test("exposes headless package APIs for vos-cli package integration", () => {
    expect(packageJson.exports).toMatchObject({
      ".": "./app/main.ts",
      "./headless": "./app/headless.ts",
    });
    expect(typeof resolveAgentTaskProfile).toBe("function");
    expect(typeof runAgentTask).toBe("function");
    expect(typeof runControlledTuiAgentTask).toBe("function");
    expect(typeof startControlledTuiAgentTask).toBe("function");
    expect(typeof runInteractiveAgentTask).toBe("function");
    expect(typeof startReadonlyAgentDisplay).toBe("function");
    expect(typeof startAgentHttpServer).toBe("function");
  });

  test("starts a readonly agent display for progress and events", () => {
    const projectRoot = makeProject();
    const output = new PassThrough() as PassThrough & {
      columns: number;
      rows: number;
    };
    output.columns = 80;
    output.rows = 14;
    const readOutput = capture(output);

    const display = startReadonlyAgentDisplay({
      projectRoot,
      title: "agent plan -i",
      output,
    });
    display.progress({ stage: "agent plan", status: "running", message: "waiting for agent" });
    display.command("internal flow visible");
    display.close();

    const text = readOutput();
    expect(text).toContain("\x1b[?1049h");
    expect(stripAnsi(text)).toContain("internal flow visible");
    output.destroy();
  });

  test("starts a controlled display-only TUI task without accepting user prompts", async () => {
    const projectRoot = makeProject();
    const input = new PassThrough() as PassThrough & {
      setRawMode(enabled: boolean): typeof input;
    };
    const output = new PassThrough() as PassThrough & {
      columns: number;
      rows: number;
    };
    const rawModeValues: boolean[] = [];
    const readOutput = capture(output);
    output.columns = 80;
    output.rows = 14;
    input.setRawMode = (enabled: boolean) => {
      rawModeValues.push(enabled);
      return input;
    };
    let streamingHookSeen = false;
    const chat = new CallbackChatClient(async (request, callIndex) => {
      streamingHookSeen = request.onEvent !== undefined;
      await delay(1);
      await request.onEvent?.({ type: "text.delta", delta: "kb " });
      await request.onEvent?.({ type: "text.delta", delta: "answer" });
      if (callIndex === 0) {
        return toolCallResponse([{
          name: "StructuredOutput",
          args: {
            answer: "kb answer",
            design_goal_alignment: [],
            citations: [],
            suggested_next_steps: [],
            allowed_snippets: [],
          },
        }]);
      }
      return textResponse("kb answer");
    });

    const handle = startControlledTuiAgentTask({
      projectRoot,
      task: "Explain page tables from the course notes",
      chat,
      input,
      output,
      env: {
        OPENAI_API_KEY: "test-key",
        SMART_MODEL: "openai:gpt-test",
      },
    });
    input.write("/quit\rhello\r");
    const result = await handle.result;

    expect(result.content).toBe("kb answer");
    expect(result.agentProfile.promptId).toBe("knowledgebase.v1");
    expect(chat.requests).toHaveLength(2);
    expect(streamingHookSeen).toBe(true);
    expect(rawModeValues).toEqual([true, false]);
    const text = readOutput();
    const visibleText = stripAnsi(text);
    expect(text).toContain("\x1b[?1049h");
    expect(visibleText).toContain("Explain page tables from the course notes");
    expect(visibleText).toMatch(/kb\s*answer/);
    expect(visibleText).not.toContain("╭");
    input.destroy();
    output.destroy();
  });

  test("starts package HTTP server with explicit host and ephemeral port", () => {
    const projectRoot = makeProject();
    const result = startAgentHttpServer({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      env: {
        OPENAI_API_KEY: "test-key",
        SMART_MODEL: "openai:gpt-test",
      },
    });

    try {
      expect(result.host).toBe("127.0.0.1");
      expect(result.port).toBeGreaterThan(0);
      expect(result.url).toBe(`http://127.0.0.1:${result.port}`);
    } finally {
      result.server.stop(true);
    }
  });

  test("uses env host fallback and defaults for package HTTP server", () => {
    const projectRoot = makeProject();
    const result = startAgentHttpServer({
      projectRoot,
      port: 0,
      env: {
        OPENAI_API_KEY: "test-key",
        SMART_MODEL: "openai:gpt-test",
        VOS_AGENT_HOST: "127.0.0.1",
      },
    });

    try {
      expect(result.host).toBe("127.0.0.1");
      expect(result.port).toBeGreaterThan(0);
      expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      result.server.stop(true);
    }
  });

  test("build script emits a single vos-agent release binary", () => {
    expect(packageJson.scripts.build).toBe(
      "bun build --compile ./app/main.ts --outfile dist/vos-agent",
    );
  });

  test("vos-agent binary entry has a Bun shebang and executable bit", () => {
    const entry = join(packageRoot, "app", "main.ts");
    expect(readFileSync(entry, "utf8").startsWith("#!/usr/bin/env bun")).toBe(true);
    expect(statSync(entry).mode & 0o111).not.toBe(0);
  });

  test("root bun workspace lockfile includes vos-agent", () => {
    const lockfile = readFileSync(join(workspaceRoot, "bun.lock"), "utf8");
    expect(lockfile).toContain('"apps/vos-agent"');
    expect(lockfile).toContain('"name": "vos-agent"');
  });
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-agent-package-"));
  tmpRoots.push(root);
  return root;
}

function capture(stream: PassThrough): () => string {
  const chunks: Buffer[] = [];
  stream.on("data", (chunk) => {
    chunks.push(Buffer.from(chunk));
  });
  return () => Buffer.concat(chunks).toString("utf8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}
