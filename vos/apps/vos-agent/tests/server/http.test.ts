import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Config } from "../../app/config.ts";
import { serveAgentHttp } from "../../app/server/http.ts";
import { ThreadStore } from "../../app/session/thread-store.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";
import { ScriptedChatClient, textResponse } from "../helpers/stub-chat.ts";

const config: Config = {
  defaultMode: "smart",
  modes: {
    smart: { model: "test-smart" },
    deep: { model: "test-deep", reasoningEffort: "high" },
  },
  tools: { disabled: ["Write"] },
  openai: { apiKey: "test" },
};

describe("vos-agent HTTP server", () => {
  let tmp: string;
  let server: Bun.Server<undefined> | undefined;

  beforeEach(() => {
    tmp = makeTmpDir("vos-agent-http-");
  });

  afterEach(() => {
    server?.stop(true);
    server = undefined;
    removeTmpDir(tmp);
  });

  test("serves health and model metadata", async () => {
    server = startServer(new ScriptedChatClient([]));

    const health = await fetchJson("/health");
    expect(health).toMatchObject({ ok: true, service: "vos-agent" });

    const models = await fetchJson("/v1/models") as {
      data: Array<{ id: string; object: string; owned_by: string; root?: string }>;
    };
    expect(models.data.map((model) => model.id)).toContain("vos-local-agent");
    expect(models.data).toContainEqual({
      id: "vos-deep",
      object: "model",
      owned_by: "vos-agent",
      root: "test-deep",
    });

    const profile = await fetchJson("/api/v1/agent/profile", {
      method: "POST",
      body: { task_kind: "debug" },
    }) as {
      agent_profile: {
        promptId: string;
        skills: string[];
        mcpServers: string[];
        outputSchema: string;
      };
    };
    expect(profile.agent_profile).toMatchObject({
      promptId: "debug-agent.v1",
      skills: ["verification-diagnosis"],
      outputSchema: "debug_output.v1",
    });
    expect(profile.agent_profile.mcpServers).toContain("evidence-store");
  });

  test("serves VOS portal API routes used by vos-web", async () => {
    server = startServer(new ScriptedChatClient([]));

    const login = await fetchJson("/api/v1/auth/login", {
      method: "POST",
      body: { username: "student", password: "student" },
    }) as { token: string; user: { username: string; role: string } };
    expect(login.user).toMatchObject({ username: "student", role: "student" });

    const me = await fetchJson("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${login.token}` },
    }) as { username: string };
    expect(me.username).toBe("student");

    const projects = await fetchJson("/api/v1/projects", {
      headers: { Authorization: `Bearer ${login.token}` },
    }) as Array<{ project: { id: string }; current_stage: { key: string } }>;
    expect(projects).toHaveLength(1);
    expect(projects[0].project.id).toBe("project-demo-student");
    expect(projects[0].current_stage.key).toBe("memory-management");

    const progress = await fetchJson("/api/v1/projects/project-demo-student/progress", {
      headers: { Authorization: `Bearer ${login.token}` },
    }) as { stages: Array<{ stage: { key: string }; passed: boolean }> };
    expect(progress.stages.map((item) => item.stage.key)).toContain("memory-management");
  });

  test("runs a non-streaming OpenAI-compatible chat completion", async () => {
    const chat = new ScriptedChatClient([textResponse("VOS says hello")]);
    server = startServer(chat);

    const response = await fetchJson("/v1/chat/completions", {
      method: "POST",
      body: {
        model: "vos-deep",
        project_id: "project-demo-student",
        messages: [{ role: "user", content: "hello" }],
      },
    }) as {
      model: string;
      thread_id: string;
      choices: Array<{ message: { role: string; content: string } }>;
    };

    expect(response.model).toBe("vos-deep");
    expect(response.thread_id).toStartWith("VOS-");
    expect(response.choices[0].message).toEqual({
      role: "assistant",
      content: "VOS says hello",
    });
    expect(chat.requests[0].model).toBe("test-deep");
    expect(chat.requests[0].reasoningEffort).toBe("high");
    expect(chat.requests[0].tools.map((tool) => tool.function.name)).toContain("Vos");

    const login = await fetchJson("/api/v1/auth/login", {
      method: "POST",
      body: { username: "student", password: "student" },
    }) as { token: string };
    const audit = await fetchJson("/api/v1/projects/project-demo-student/agent-audit", {
      headers: { Authorization: `Bearer ${login.token}` },
    }) as Array<{ session_id: string; response_summary?: string }>;
    expect(audit.some((item) =>
      item.session_id === response.thread_id &&
      item.response_summary?.includes("VOS says hello")
    )).toBe(true);
  });

  test("runs a VOS-native profile-based agent task", async () => {
    const chat = new ScriptedChatClient([
      textResponse(JSON.stringify({
        failure_class: "impl_gap",
        summary: "boot log is missing expected output",
        suspected_clauses: ["boot.console"],
        related_specs: ["spec/boot.yaml"],
        suggested_next_commands: ["build"],
        risk_flags: ["large_patch_proposal"],
      })),
    ]);
    server = startServer(chat);

    const response = await fetchJson("/api/v1/agent/tasks", {
      method: "POST",
      body: {
        task_kind: "debug",
        project_id: "project-demo-student",
        user_id: "student-demo",
        task: "explain this boot failure",
      },
    }) as {
      session_id: string;
      agent_profile: {
        promptId: string;
        skills: string[];
        mcpServers: string[];
        outputSchema: string;
      };
      model: string;
      structured_output?: { failure_class?: string };
    };

    expect(response.session_id).toStartWith("VOS-");
    expect(response.agent_profile).toMatchObject({
      promptId: "debug-agent.v1",
      skills: ["verification-diagnosis"],
      outputSchema: "debug_output.v1",
    });
    expect(Object.keys(response)).not.toContain("role_id");
    expect(Object.keys(response)).not.toContain("runtime_role");
    expect(response.model).toBe("test-smart");
    expect(response.structured_output?.failure_class).toBe("impl_gap");
    expect(chat.requests[0].model).toBe("test-smart");
    expect(String(chat.requests[0].messages[0].content)).toContain("fixed VOS task profile");
    expect(chat.requests[0].tools.map((tool) => tool.function.name).sort()).toEqual([
      "Glob",
      "Grep",
      "Read",
      "Task",
      "TodoRead",
      "Vos",
    ]);

    const login = await fetchJson("/api/v1/auth/login", {
      method: "POST",
      body: { username: "student", password: "student" },
    }) as { token: string };
    const audit = await fetchJson("/api/v1/projects/project-demo-student/agent-audit", {
      headers: { Authorization: `Bearer ${login.token}` },
    }) as Array<{ session_id: string; task_kind: string; risk_flags: string[]; risk_level: string }>;
    const entry = audit.find((item) => item.session_id === response.session_id);
    expect(entry).toMatchObject({
      task_kind: "debug",
      risk_flags: ["large_patch_proposal"],
      risk_level: "high",
    });
  });

  test("rejects streaming requests with a structured error", async () => {
    server = startServer(new ScriptedChatClient([]));

    const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "vos-local-agent",
        stream: true,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("streaming chat completions");
  });

  function startServer(chat: ScriptedChatClient): Bun.Server<undefined> {
    return serveAgentHttp({
      chat,
      config,
      store: new ThreadStore({
        workspaceRoot: tmp,
        stateDir: join(tmp, ".vos-agent"),
      }),
      workspaceRoot: tmp,
      host: "127.0.0.1",
      port: 0,
    });
  }

  async function fetchJson(path: string, init: JsonRequestInit = {}): Promise<unknown> {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      body: init.body === undefined || typeof init.body === "string"
        ? init.body
        : JSON.stringify(init.body),
    });
    expect(response.ok).toBe(true);
    return await response.json();
  }

  function baseUrl(): string {
    if (!server) throw new Error("server not started");
    return `http://${server.hostname}:${server.port}`;
  }
});

type JsonRequestInit = Omit<RequestInit, "body"> & {
  body?: unknown;
};
