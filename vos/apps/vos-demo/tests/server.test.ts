import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createDemoHandler } from "../app/server.ts";
import type { DemoReplRunner } from "../app/server.ts";

describe("vos-demo server", () => {
  test("requires an access code and restores the session", async () => {
    const handler = createDemoHandler({
      projectRoot: fixtureProject(),
      accessCodes: ["open-sesame"],
      replRunner: okReplRunner(),
      dbPath: ":memory:",
    });

    expect((await handler(req("/api/demo/session"))).status).toBe(401);
    expect((await handler(req("/api/demo/login", { method: "POST", body: { accessCode: "bad" } }))).status).toBe(401);

    const login = await handler(req("/api/demo/login", { method: "POST", body: { accessCode: "open-sesame" } }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("vos_demo_session=");

    const session = await handler(req("/api/demo/session", { headers: { cookie } }));
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ ok: true, projectRoot: expect.any(String) });
  });

  test("runs ask and replays public events over SSE", async () => {
    const seen: string[] = [];
    let capturedTask = "";
    let capturedContext: unknown;
    const handler = createDemoHandler({
      projectRoot: fixtureProject(),
      accessCodes: ["code"],
      dbPath: ":memory:",
      replRunner: async (request) => {
        seen.push(request.taskKind ?? "");
        capturedTask = request.task;
        capturedContext = request.context;
        await request.onEvent?.({ type: "assistant.message", content: "waiting" } as never);
        return {
          content: null,
          threadId: request.threadId ?? "thread-ask",
          events: [],
          agentProfile: {} as never,
          model: "fake",
          prompt: "fake",
          structuredOutput: {
            answer: "Keep ownership explicit.",
            citations: [{ title: "memory spec", source_id: "spec/memory.yaml" }],
            suggested_next_steps: ["run public verify"],
          },
        };
      },
    });
    const cookie = await loginCookie(handler);
    const created = await handler(req("/api/demo/ask", {
      method: "POST",
      headers: { cookie },
      body: { question: "How should I design kalloc?", scope: "memory" },
    }));

    expect(created.status).toBe(202);
    const body = await created.json() as { id: string };
    const result = await waitForRun(handler, cookie, body.id) as { answer: { answer: string }; threadId: string };
    expect(seen).toEqual(["knowledgebase_qa"]);
    expect(capturedTask).toContain("VOS public demo full-flow Ask turn");
    expect(capturedTask).toContain("project context");
    expect(capturedTask).toContain("citations");
    expect(capturedTask).toContain("suggested next steps");
    expect(capturedTask).toContain("teaching objective");
    expect(capturedContext).toMatchObject({
      mode: "ask_repl",
      demo_flow: expect.any(Object),
    });
    expect(result.answer.answer).toBe("Keep ownership explicit.");
    expect(result.threadId).toBe("thread-ask");

    const events = await (await handler(req(`/api/demo/runs/${body.id}/events`, { headers: { cookie } }))).text();
    expect(events).toContain("event: progress");
    expect(events).toContain("waiting");
  });

  test("runs debug and serves only recorded visualization artifacts", async () => {
    const projectRoot = fixtureProject();
    mkdirSync(path.join(projectRoot, ".vos", "runs", "run-debug"), { recursive: true });
    mkdirSync(path.join(projectRoot, ".vos", "runs", "run-debug", "artifacts"), { recursive: true });
    writeFileSync(path.join(projectRoot, ".vos", "runs", "run-debug", "artifacts", "qemu.log"), "panic: allocator invariant failed\n".repeat(200));
    writeFileSync(path.join(projectRoot, ".vos", "runs", "run-debug", "artifacts", "kernel.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(path.join(projectRoot, ".vos", "runs", "run-debug", "manifest.json"), JSON.stringify({
      run_id: "run-debug",
      command: ["verify", "public"],
      status: "failed",
      started_at: "2026-06-29T00:00:00.000Z",
      finished_at: "2026-06-29T00:00:01.000Z",
      artifacts: [
        { kind: "log", path: ".vos/runs/run-debug/artifacts/qemu.log" },
        { kind: "binary", path: ".vos/runs/run-debug/artifacts/kernel.bin" },
        { kind: "escape", path: "../secret.txt" },
      ],
      evidence_refs: [],
    }));
    let capturedTask = "";
    let capturedContext: unknown;

    const handler = createDemoHandler({
      projectRoot,
      accessCodes: ["code"],
      dbPath: ":memory:",
      replRunner: async (request) => {
        capturedTask = request.task;
        capturedContext = request.context;
        return {
          content: null,
          threadId: "thread-debug",
          events: [],
          agentProfile: {} as never,
          model: "fake",
          prompt: "fake",
          structuredOutput: {
            summary: "Allocator failed.",
            evidence_chain: [],
            next_diagnostic_commands: [],
            visualization_html: "<!doctype html><html><body><script>const states=[];</script></body></html>",
          },
        };
      },
    });
    const cookie = await loginCookie(handler);
    const created = await handler(req("/api/demo/debug", {
      method: "POST",
      headers: { cookie },
      body: { runId: "run-debug" },
    }));
    expect(created.status).toBe(202);
    const body = await created.json() as { id: string };
    const run = await waitForRun(handler, cookie, body.id) as { visualizations: Array<{ id: string }> };
    expect(capturedTask).toContain("VOS public demo full-flow Debug turn");
    expect(capturedTask).toContain("failure overview");
    expect(capturedTask).toContain("visualization_html");
    expect(capturedTask).toContain("teaching objective");
    expect(capturedContext).toMatchObject({
      mode: "debug_repl",
      target_run_id: "run-debug",
      artifact_excerpts: [
        expect.objectContaining({
          path: ".vos/runs/run-debug/artifacts/qemu.log",
          text: expect.stringContaining("panic: allocator invariant failed"),
          truncated: true,
        }),
      ],
    });
    expect(JSON.stringify(capturedContext)).not.toContain("kernel.bin");
    expect(JSON.stringify(capturedContext)).not.toContain("secret");
    expect(run.visualizations).toHaveLength(1);

    const page = await handler(req(`/api/demo/visualizations/${run.visualizations[0].id}`, { headers: { cookie } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("https:");
    expect(await page.text()).toContain("states=[]");

    expect((await handler(req("/api/demo/visualizations/../../package.json", { headers: { cookie } }))).status).toBe(404);
  });
});

function fixtureProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vos-demo-"));
  mkdirSync(path.join(root, ".vos", "runs"), { recursive: true });
  writeFileSync(path.join(root, ".vos", "project.yaml"), "project_id: local-project\nspec_root: spec\ncurrent_stage: boot\n");
  writeFileSync(path.join(root, ".vos", "policy.yaml"), "allowed_commands:\n  - agent ask\n  - agent debug\nallowed_paths:\n  - spec\nvisibility_scope: public\n");
  mkdirSync(path.join(root, "spec"), { recursive: true });
  return root;
}

function okReplRunner(): DemoReplRunner {
  return async () => ({
    content: null,
    threadId: "thread-ok",
    events: [],
    agentProfile: {} as never,
    model: "fake",
    prompt: "fake",
    structuredOutput: {},
  });
}

async function loginCookie(handler: ReturnType<typeof createDemoHandler>): Promise<string> {
  const response = await handler(req("/api/demo/login", {
    method: "POST",
    body: { accessCode: "code" },
  }));
  return response.headers.get("set-cookie") ?? "";
}

async function waitForRun(
  handler: ReturnType<typeof createDemoHandler>,
  cookie: string,
  id: string,
): Promise<unknown> {
  for (let i = 0; i < 20; i++) {
    const value = await (await handler(req(`/api/demo/runs/${id}`, { headers: { cookie } }))).json() as { status?: string };
    if (value.status && value.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("run did not finish");
}

function req(
  pathName: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return new Request(`http://demo.test${pathName}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}
