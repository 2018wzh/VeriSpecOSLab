import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createDemoHandler } from "../app/server.ts";

const runRealLlm = process.env.VOS_DEMO_REAL_LLM === "1";
const realTest = runRealLlm ? test : test.skip;

describe("vos-demo real LLM smoke", () => {
  realTest("runs ask and debug through the public demo API", async () => {
    const projectRoot = path.resolve(
      process.env.VOS_DEMO_REAL_PROJECT_ROOT
        ?? path.join(fileURLToPath(new URL(".", import.meta.url)), "../../../..", "examples/xv6-spec"),
    );
    expect(existsSync(projectRoot)).toBe(true);

    const dbPath = path.join(projectRoot, ".vos", "demo-real-llm.sqlite");
    rmSync(dbPath, { force: true });
    try {
      const handler = createDemoHandler({
        projectRoot,
        accessCodes: ["real-llm"],
        dbPath,
        dailyLimit: 10,
        sessionLimit: 10,
      });
      const cookie = await loginCookie(handler);

      const ask = await handler(req("/api/demo/ask", {
        method: "POST",
        headers: { cookie },
        body: {
          question: "As a teacher demoing this xv6-style project, explain what teaching objective VOS helps students reach when public verification fails.",
          scope: "public demo teaching objective",
        },
      }));
      expect(ask.status).toBe(202);
      const askRun = await waitForRun(handler, cookie, (await ask.json() as { id: string }).id, 300_000) as {
        status: string;
        threadId?: string;
        answer?: { answer?: string; citations?: unknown[]; suggested_next_steps?: unknown[] };
      };
      expect(askRun.status).toBe("passed");
      expect(askRun.answer?.answer?.length ?? 0).toBeGreaterThan(20);
      expect(teachingText(askRun.answer)).toMatch(/teaching objective|teaching goal|student|学生|教学/i);
      expect(teachingText(askRun.answer)).toMatch(/spec|verification|verify|evidence|citation|规范|验证|证据/i);
      expect(Array.isArray(askRun.answer?.citations)).toBe(true);
      expect(Array.isArray(askRun.answer?.suggested_next_steps)).toBe(true);
      expect(askRun.threadId?.length ?? 0).toBeGreaterThan(0);

      const followUp = await handler(req("/api/demo/ask", {
        method: "POST",
        headers: { cookie },
        body: {
          threadId: askRun.threadId,
          question: "Continue the same demo: what should the instructor point to in the UI next?",
          scope: "public demo teaching objective",
        },
      }));
      expect(followUp.status).toBe(202);
      const followUpRun = await waitForRun(handler, cookie, (await followUp.json() as { id: string }).id, 300_000) as {
        status: string;
        threadId?: string;
        answer?: { answer?: string; suggested_next_steps?: unknown[] };
      };
      expect(followUpRun.status).toBe("passed");
      expect(followUpRun.threadId).toBe(askRun.threadId);
      expect(teachingText(followUpRun.answer)).toMatch(/UI|citation|evidence|next|canvas|引用|证据|下一步/i);

      const targets = await (await handler(req("/api/demo/debug-targets", { headers: { cookie } }))).json() as {
        targets: Array<{ runId: string; status: string; command?: string[]; artifactsCount?: number }>;
      };
      const target = targets.targets.find((item) =>
        ["failed", "validation_failed"].includes(item.status)
        && (item.artifactsCount ?? 0) > 0
        && ["build", "verify"].includes(item.command?.[0] ?? "")
      );
      if (!target) throw new Error("no failed build/verify run with artifacts for debug smoke");

      const debug = await handler(req("/api/demo/debug", {
        method: "POST",
        headers: { cookie },
        body: {
          runId: target.runId,
          message: "Use this failure as a public teaching demo. Explain the learning objective, evidence chain, and next classroom action.",
        },
      }));
      expect(debug.status).toBe(202);
      const debugRun = await waitForRun(handler, cookie, (await debug.json() as { id: string }).id, 900_000) as {
        status: string;
        debug?: { summary?: string; evidence_chain?: unknown[]; next_diagnostic_commands?: unknown[]; student_visible_limitations?: unknown[] };
        visualizations?: Array<{ id: string }>;
      };
      expect(debugRun.status).toBe("passed");
      expect(debugRun.debug?.summary?.length ?? 0).toBeGreaterThan(20);
      expect(teachingText(debugRun.debug)).toMatch(/teaching objective|teaching goal|student|学生|教学/i);
      expect(teachingText(debugRun.debug)).toMatch(/evidence|trace|gdb|diagnostic|timeline|证据|调试|诊断/i);
      expect(Array.isArray(debugRun.debug?.evidence_chain)).toBe(true);
      expect(Array.isArray(debugRun.debug?.next_diagnostic_commands)).toBe(true);
      expect(debugRun.visualizations?.length ?? 0).toBeGreaterThan(0);

      const page = await handler(req(`/api/demo/visualizations/${debugRun.visualizations?.[0]?.id}`, { headers: { cookie } }));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<html");
    } finally {
      rmSync(dbPath, { force: true });
    }
  }, 1_200_000);
});

async function loginCookie(handler: ReturnType<typeof createDemoHandler>): Promise<string> {
  const response = await handler(req("/api/demo/login", {
    method: "POST",
    body: { accessCode: "real-llm" },
  }));
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie") ?? "";
}

async function waitForRun(
  handler: ReturnType<typeof createDemoHandler>,
  cookie: string,
  id: string,
  timeoutMs: number,
): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await (await handler(req(`/api/demo/runs/${id}`, { headers: { cookie } }))).json() as { status?: string };
    if (value.status && value.status !== "running") return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`run ${id} did not finish`);
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

function teachingText(value: unknown): string {
  return JSON.stringify(value ?? "");
}
