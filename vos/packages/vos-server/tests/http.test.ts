import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { BaseCommandResult, RunEvent, VosCommand } from "vos-core";
import { createVosHttpHandler } from "../src/index.ts";

describe("vos-server typed HTTP API", () => {
  test("rejects command RPC routes and creates typed build runs with SSE", async () => {
    const seen: VosCommand[] = [];
    const handler = createVosHttpHandler({
      projectRoot: process.cwd(),
      portalUrl: "http://portal.test",
      projectId: "project-1",
      executeCommand: async (context) => {
        seen.push(context.command);
        const started: RunEvent = {
          run_id: context.runId,
          ts: new Date().toISOString(),
          type: "run_started",
          payload: { command: ["build"] },
        };
        const progress: RunEvent = {
          run_id: context.runId,
          ts: new Date().toISOString(),
          type: "progress",
          visibility: "public",
          payload: { stage: "build", message: "building" },
        };
        const finished: RunEvent = {
          run_id: context.runId,
          ts: new Date().toISOString(),
          type: "run_finished",
          payload: { status: "passed" },
        };
        await context.onEvent?.(started);
        await context.onEvent?.(progress);
        await context.onEvent?.({ ...progress, visibility: "staff-only", payload: { token: context.bearerToken } });
        await context.onEvent?.(finished);
        return result(context.runId, context.command);
      },
    });

    expect((await handler(new Request("http://vos.test/api/v1/commands/runs", { method: "POST" }))).status).toBe(404);
    expect((await handler(new Request("http://vos.test/api/v1/vos/runs", { method: "POST" }))).status).toBe(404);

    const create = await handler(new Request("http://vos.test/api/v1/build/runs", {
      method: "POST",
      headers: {
        "authorization": "Bearer secret-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ dry_run: true, requested_by: "portal" }),
    }));
    expect(create.status).toBe(202);
    const created = await create.json() as { run_id: string; status: string };
    expect(created.run_id).toBeTruthy();

    await waitForTerminal(handler, created.run_id);
    expect(seen).toEqual([{ kind: "build", dryRun: true }]);

    const status = await (await handler(new Request(`http://vos.test/api/v1/runs/${created.run_id}`))).json();
    expect(JSON.stringify(status)).not.toContain("secret-token");

    const stream = await handler(new Request(`http://vos.test/api/v1/runs/${created.run_id}/events`));
    const text = await stream.text();
    expect(text).toContain("event: run_started");
    expect(text).toContain("event: progress");
    expect(text).toContain("event: run_finished");
    expect(text).not.toContain("secret-token");
  });

  test("serves OpenAPI generated from typed endpoints", async () => {
    const handler = createVosHttpHandler({
      projectRoot: process.cwd(),
      portalUrl: "http://portal.test",
      projectId: "project-1",
      executeCommand: async (context) => result(context.runId, context.command),
    });

    const response = await handler(new Request("http://vos.test/api/v1/openapi.json"));
    expect(response.status).toBe(200);
    const spec = await response.json() as { paths: Record<string, unknown> };
    expect(spec.paths["/api/v1/build/runs"]).toBeTruthy();
    expect(spec.paths["/api/v1/runs/{run_id}/events"]).toBeTruthy();
    expect(spec.paths["/api/v1/commands/runs"]).toBeUndefined();
  });

  test("blocks artifact path traversal and serves run artifacts from .vos/runs", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "vos-server-"));
    const runRoot = path.join(projectRoot, ".vos", "runs", "run-artifacts", "artifacts");
    await mkdir(runRoot, { recursive: true });
    await writeFile(path.join(projectRoot, ".vos", "runs", "run-artifacts", "manifest.json"), JSON.stringify({
      run_id: "run-artifacts",
      command: ["build"],
      status: "passed",
      started_at: "2026-06-24T00:00:00.000Z",
      finished_at: "2026-06-24T00:00:01.000Z",
      artifacts: [{ kind: "log", path: ".vos/runs/run-artifacts/artifacts/build.log" }],
      evidence_refs: [],
    }));
    await writeFile(path.join(runRoot, "build.log"), "hello artifact\n");

    const handler = createVosHttpHandler({
      projectRoot,
      portalUrl: "http://portal.test",
      projectId: "project-1",
      executeCommand: async (context) => result(context.runId, context.command),
    });

    expect((await handler(new Request("http://vos.test/api/v1/runs/run-artifacts/artifacts?path=../manifest.json"))).status).toBe(400);
    const ok = await handler(new Request("http://vos.test/api/v1/runs/run-artifacts/artifacts?path=.vos/runs/run-artifacts/artifacts/build.log"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("hello artifact\n");
  });
});

function result(runId: string, command: VosCommand): BaseCommandResult {
  return {
    ok: true,
    run_id: runId,
    command: [command.kind],
    status: "passed",
    artifacts: [],
    evidence_refs: [],
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    message: "ok",
  };
}

async function waitForTerminal(handler: (request: Request) => Promise<Response>, runId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const status = await (await handler(new Request(`http://vos.test/api/v1/runs/${runId}`))).json() as { status: string };
    if (status.status !== "queued" && status.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("run did not finish");
}
