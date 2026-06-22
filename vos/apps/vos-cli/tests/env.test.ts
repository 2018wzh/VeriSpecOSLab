import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildAgentEnv } from "../app/agent/runner.ts";
import { buildKbEmbeddingConfig } from "../app/kb/embedding.ts";
import { readProjectEnv, withProjectEnv } from "../app/utils/dotenv.ts";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe(".env loading", () => {
  test("reads project-root .env with comments and quoted values", () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".env"), [
      "# project env",
      "DEEPSEEK_API_KEY=test-key",
      "MODEL_NAME=\"deepseek-v4-pro\"",
      "BASE_URL='https://api.deepseek.com/v1'",
      "INLINE_COMMENT=value # comment",
      "",
    ].join("\n"));

    expect(readProjectEnv(projectRoot)).toEqual({
      DEEPSEEK_API_KEY: "test-key",
      MODEL_NAME: "deepseek-v4-pro",
      BASE_URL: "https://api.deepseek.com/v1",
      INLINE_COMMENT: "value",
    });
  });

  test("merges project-root .env into agent bootstrap env", () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "[agent]",
      "provider = \"deepseek\"",
      "model = \"deepseek-v4-pro\"",
      "base_url = \"https://api.deepseek.com/v1\"",
      "",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".env"), [
      "DEEPSEEK_API_KEY=project-key",
      "",
    ].join("\n"));

    const result = buildAgentEnv({
      projectRoot,
      env: {} as NodeJS.ProcessEnv,
    });

    expect(result.env.OPENAI_API_KEY).toBe("project-key");
    expect(result.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(result.env.SMART_MODEL).toBe("deepseek-v4-pro");
  });

  test("temporarily hydrates process env from project-root .env", async () => {
    const projectRoot = makeProject();
    writeFileSync(join(projectRoot, ".env"), "CLI_ENV_TEST=visible\n");
    const previous = process.env.CLI_ENV_TEST;
    delete process.env.CLI_ENV_TEST;

    try {
      await withProjectEnv(projectRoot, async () => {
        expect(process.env.CLI_ENV_TEST).toBe("visible");
      });
      expect(process.env.CLI_ENV_TEST).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.CLI_ENV_TEST;
      } else {
        process.env.CLI_ENV_TEST = previous;
      }
    }
  });

  test("builds KB embedding config from dedicated section before agent fallback", () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "[agent]",
      "provider = \"deepseek\"",
      "model = \"deepseek-chat\"",
      "base_url = \"https://api.deepseek.com/v1\"",
      "",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
      "[kb.embedding]",
      "provider = \"openai-compatible\"",
      "model = \"text-embedding-3-small\"",
      "base_url = \"https://embed.example/v1\"",
      "",
      "[kb.embedding.auth]",
      "env = \"EMBEDDING_API_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".env"), "DEEPSEEK_API_KEY=agent-key\nEMBEDDING_API_KEY=embed-key\n");

    expect(buildKbEmbeddingConfig(projectRoot, {} as NodeJS.ProcessEnv)).toEqual({
      baseUrl: "https://embed.example/v1",
      model: "text-embedding-3-small",
      apiKey: "embed-key",
    });
  });

  test("falls back to OpenAI-compatible agent config for KB embeddings", () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, ".vos"), { recursive: true });
    writeFileSync(join(projectRoot, ".vos", "config.toml"), [
      "[agent]",
      "provider = \"deepseek\"",
      "model = \"deepseek-chat\"",
      "base_url = \"https://api.deepseek.com/v1\"",
      "",
      "[agent.auth]",
      "env = \"DEEPSEEK_API_KEY\"",
      "",
    ].join("\n"));
    writeFileSync(join(projectRoot, ".env"), "DEEPSEEK_API_KEY=agent-key\n");

    expect(buildKbEmbeddingConfig(projectRoot, {} as NodeJS.ProcessEnv)).toEqual({
      baseUrl: "https://api.deepseek.com/v1",
      model: "text-embedding-3-small",
      apiKey: "agent-key",
    });
  });

  test("rejects missing KB embedding provider config", () => {
    const projectRoot = makeProject();
    expect(() => buildKbEmbeddingConfig(projectRoot, {} as NodeJS.ProcessEnv)).toThrow(/kb embedding/i);
  });
});

function makeProject(): string {
  const root = join(tmpdir(), `vos-cli-dotenv-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(root, { recursive: true });
  return root;
}
