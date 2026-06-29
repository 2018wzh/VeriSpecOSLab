import { describe, expect, test } from "bun:test";
import { DemoApiError, createDemoApiClient } from "./api.ts";

describe("vos-demo web api client", () => {
  test("creates ask and debug runs with thread state", async () => {
    const calls: Array<{ path: string; body?: unknown }> = [];
    const client = createDemoApiClient(async (path, init) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return json({ id: path.includes("ask") ? "ask-run" : "debug-run", status: "running" }, 202);
    });

    expect(await client.ask({ question: "why failed?", scope: "memory", threadId: "ask-thread" }))
      .toEqual({ id: "ask-run", status: "running" });
    expect(await client.debug({ runId: "run-a", message: "explain", threadId: "debug-thread" }))
      .toEqual({ id: "debug-run", status: "running" });
    expect(await client.debug({ runId: "", message: "default debug" }))
      .toEqual({ id: "debug-run", status: "running" });
    expect(calls).toEqual([
      { path: "/api/demo/ask", body: { question: "why failed?", scope: "memory", threadId: "ask-thread" } },
      { path: "/api/demo/debug", body: { runId: "run-a", message: "explain", threadId: "debug-thread" } },
      { path: "/api/demo/debug", body: { message: "default debug" } },
    ]);
  });

  test("throws typed errors for failed api responses", async () => {
    const client = createDemoApiClient(async () => json({ error: "not_authenticated" }, 401));

    await expect(client.session()).rejects.toBeInstanceOf(DemoApiError);
    await expect(client.session()).rejects.toMatchObject({ message: "not_authenticated", status: 401 });
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
