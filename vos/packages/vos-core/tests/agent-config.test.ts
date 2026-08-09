import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAgentConfig } from "../src/main.ts";
import { EvidenceWriter } from "../src/evidence/index.ts";
import { buildAgentEnv } from "../src/agent/runner.ts";
import { checkAgentConfig } from "../src/agent/config.ts";
import type { AgentConfigCommand } from "../src/types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeProject(): string {
  const root = join(tmpdir(), `vos-agent-config-${crypto.randomUUID()}`);
  mkdirSync(join(root, ".vos"), { recursive: true });
  roots.push(root);
  return root;
}

async function runConfig(
  projectRoot: string,
  partial: Partial<Omit<AgentConfigCommand, "kind">>,
) {
  const command: AgentConfigCommand = {
    kind: "agent_config",
    show: false,
    reset: false,
    check: false,
    ...partial,
  };
  const evidence = await EvidenceWriter.create({
    projectRoot,
    evidenceDir: ".vos",
    command: ["agent", "config"],
    args: ["agent", "config"],
  });
  return executeAgentConfig(command, {
    projectRoot,
    global: { projectRoot, json: true, verbose: false, progress: "never" },
    evidence,
  });
}

describe("vos agent config", () => {
  test("writes an agent provider without forcing KB embeddings", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".env"), "DEEPSEEK_API_KEY=test-only\n");

    const result = await runConfig(root, {
      provider: "deepseek",
      model: "deepseek-chat",
      authEnv: "DEEPSEEK_API_KEY",
    });

    expect(result.status).toBe("passed");
    const config = readFileSync(join(root, ".vos", "config.toml"), "utf8");
    expect(config).toContain('[agent]\nprovider = "deepseek"');
    expect(config).toContain('base_url = "https://api.deepseek.com/v1"');
    expect(config).not.toContain("[kb.embedding]");
    expect(config).not.toContain("test-only");
  });

  test("adds an explicitly requested embedding provider", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");

    const result = await runConfig(root, {
      provider: "openai",
      model: "gpt-5",
      authEnv: "OPENAI_API_KEY",
      configureEmbedding: true,
    });

    expect(result.status).toBe("passed");
    const config = readFileSync(join(root, ".vos", "config.toml"), "utf8");
    expect(config).toContain("[kb.embedding]");
    expect(config).toContain('model = "text-embedding-3-small"');
  });

  test("requires a separate embedding section when the project has KB sources", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=test-only\n");
    await runConfig(root, { provider: "openai", model: "gpt-5", authEnv: "OPENAI_API_KEY" });

    const checks = checkAgentConfig(root, { OPENAI_API_KEY: "test-only" }, { requireEmbedding: true });

    expect(checks.find((check) => check.name === "agent")?.ok).toBe(true);
    expect(checks.find((check) => check.name === "kb-embedding")).toMatchObject({ ok: false, message: "not configured" });
  });

  test("saves configuration but reports a missing credential", async () => {
    const root = makeProject();
    const result = await runConfig(root, {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      authEnv: "ANTHROPIC_API_KEY",
    });

    expect(result.status).toBe("validation_failed");
    expect(result.details.missing).toEqual(["agent"]);
    expect(readFileSync(join(root, ".vos", "config.toml"), "utf8")).toContain("ANTHROPIC_API_KEY");
  });

  test("show reports credential presence without exposing its value", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=private-value\n");
    await runConfig(root, { provider: "openai", model: "gpt-5", authEnv: "OPENAI_API_KEY" });

    const result = await runConfig(root, { show: true });

    expect(result.status).toBe("passed");
    expect(result.details.agent).toMatchObject({
      provider: "openai",
      auth_env: "OPENAI_API_KEY",
      credential_present: true,
    });
    expect(JSON.stringify(result.details)).not.toContain("private-value");
  });

  test("check validates the referenced environment variable", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".vos", "config.toml"), [
      "[agent]",
      'provider = "openai"',
      'model = "gpt-5"',
      "[agent.auth]",
      'env = "OPENAI_API_KEY"',
      "",
    ].join("\n"));

    expect((await runConfig(root, { check: true })).status).toBe("validation_failed");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=available\n");
    expect((await runConfig(root, { check: true })).status).toBe("passed");
  });

  test("reset removes only the owned TOML sections", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".vos", "config.toml"), [
      'spec_root = "spec"',
      "",
      "[agent]",
      'provider = "ollama"',
      'model = "qwen3"',
      'base_url = "http://localhost:11434/api"',
      "",
      "[kb.embedding]",
      'provider = "openai"',
      'model = "text-embedding-3-small"',
      "[kb.embedding.auth]",
      'env = "OPENAI_API_KEY"',
      "",
    ].join("\n"));

    const result = await runConfig(root, { reset: true });

    expect(result.status).toBe("passed");
    expect(result.details.removed).toEqual({ agent: true, embedding: true });
    expect(readFileSync(join(root, ".vos", "config.toml"), "utf8")).toBe('spec_root = "spec"\n');
  });

  test("malformed TOML fails in show, reset, and agent runtime", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".vos", "config.toml"), "[agent\nprovider = \"openai\"\n");

    await expect(runConfig(root, { show: true })).rejects.toThrow("invalid TOML in .vos/config.toml");
    await expect(runConfig(root, { reset: true })).rejects.toThrow("invalid TOML in .vos/config.toml");
    expect(() => buildAgentEnv({ projectRoot: root, env: {} })).toThrow("invalid TOML in .vos/config.toml");
  });

  test("strict parsing rejects unknown agent fields", async () => {
    const root = makeProject();
    writeFileSync(join(root, ".vos", "config.toml"), [
      "[agent]",
      'provider = "ollama"',
      'model = "qwen3"',
      "silent_fallback = true",
      "",
    ].join("\n"));

    await expect(runConfig(root, { show: true })).rejects.toThrow("unknown field");
  });
});
