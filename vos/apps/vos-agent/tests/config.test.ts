import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DEEP_MODEL,
  DEFAULT_MODE,
  DEFAULT_RUSH_MODEL,
  DEFAULT_SMART_MODEL,
  loadConfig,
  resolveMode,
} from "../app/config.ts";

describe("loadConfig", () => {
  test("returns anthropic config when ANTHROPIC_API_KEY is set", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "ak" });
    expect(cfg.anthropic).toEqual({ apiKey: "ak", baseURL: undefined });
    expect(cfg.openai).toBeUndefined();
  });

  test("returns anthropic config when ANTHROPIC_AUTH_TOKEN is set", () => {
    const cfg = loadConfig({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "https://gateway.test",
    });
    expect(cfg.anthropic).toEqual({
      authToken: "token",
      baseURL: "https://gateway.test",
    });
    expect(cfg.openai).toBeUndefined();
  });

  test("prefers ANTHROPIC_API_KEY over ANTHROPIC_AUTH_TOKEN when both are set", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      ANTHROPIC_AUTH_TOKEN: "token",
    });
    expect(cfg.anthropic).toEqual({ apiKey: "ak", baseURL: undefined });
  });

  test("returns openai config when OPENAI_API_KEY is set", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "ok",
      OPENAI_BASE_URL: "https://example.test/v1",
    });
    expect(cfg.openai).toEqual({
      apiKey: "ok",
      baseURL: "https://example.test/v1",
    });
    expect(cfg.anthropic).toBeUndefined();
  });

  test("returns both providers when both keys are set", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      OPENAI_API_KEY: "ok",
    });
    expect(cfg.anthropic).toBeDefined();
    expect(cfg.openai).toBeDefined();
  });

  test("configures provider-neutral chat retries from env", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "ok",
      VOS_LLM_MAX_RETRIES: "3",
      VOS_LLM_RETRY_INITIAL_DELAY_MS: "10",
      VOS_LLM_RETRY_MAX_DELAY_MS: "99",
    });

    expect(cfg.chatRetry).toEqual({
      maxRetries: 3,
      initialDelayMs: 10,
      maxDelayMs: 99,
    });
  });

  test("rejects invalid provider-neutral chat retry env", () => {
    expect(() =>
      loadConfig({
        OPENAI_API_KEY: "ok",
        VOS_LLM_MAX_RETRIES: "-1",
      }),
    ).toThrow(/invalid VOS_LLM_MAX_RETRIES/);
  });

  test("default mode is 'smart' and points at the built-in smart model", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "ak" });
    expect(cfg.defaultMode).toBe(DEFAULT_MODE);
    expect(cfg.modes.smart.model).toBe(DEFAULT_SMART_MODEL);
    expect(cfg.modes.deep.model).toBe(DEFAULT_DEEP_MODEL);
    expect(cfg.modes.rush.model).toBe(DEFAULT_RUSH_MODEL);
    expect(cfg.modes.smart.reasoningEffort).toBeUndefined();
    expect(cfg.modes.deep.reasoningEffort).toBeUndefined();
    expect(cfg.modes.rush.reasoningEffort).toBe("medium");
  });

  test("SMART_MODEL env var overrides the smart mode's model", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.5",
      SMART_MODEL: "claude-sonnet-4-5",
    });
    expect(cfg.modes.smart.model).toBe("claude-sonnet-4-5");
    expect(cfg.modes.deep.model).toBe(DEFAULT_DEEP_MODEL);
  });

  test("DEEP_MODEL env var overrides the deep mode's model", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "ok",
      DEEP_MODEL: "o3",
    });
    expect(cfg.modes.deep.model).toBe("o3");
    expect(cfg.modes.smart.model).toBe(DEFAULT_SMART_MODEL);
  });

  test("RUSH_MODEL env var overrides the rush mode's model", () => {
    const cfg = loadConfig({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.3-codex",
      RUSH_MODEL: "anthropic:gpt-5.4",
    });
    expect(cfg.modes.rush.model).toBe("anthropic:gpt-5.4");
  });

  test("uses Anthropic default model aliases for smart and rush modes", () => {
    const cfg = loadConfig({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.3-codex",
    });

    expect(cfg.modes.smart.model).toBe("anthropic:gpt-5.5");
    expect(cfg.modes.deep.model).toBe(DEFAULT_DEEP_MODEL);
    expect(cfg.modes.rush.model).toBe("anthropic:gpt-5.3-codex");
  });

  test("keeps Anthropic routing prefixes on default model aliases", () => {
    const cfg = loadConfig({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_DEFAULT_OPUS_MODEL: " anthropic/claude-opus-4.6 ",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: " claude-haiku-4.6 ",
    });

    expect(cfg.modes.smart.model).toBe("anthropic/claude-opus-4.6");
    expect(cfg.modes.rush.model).toBe("anthropic:claude-haiku-4.6");
  });

  test("ignores Anthropic default model aliases when Anthropic is not configured", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "ok",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.3-codex",
    });

    expect(cfg.modes.smart.model).toBe(DEFAULT_SMART_MODEL);
    expect(cfg.modes.rush.model).toBe(DEFAULT_RUSH_MODEL);
  });

  test("reasoning effort env vars configure modes without CLI/TUI flags", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      SMART_REASONING_EFFORT: "low",
      DEEP_REASONING_EFFORT: "high",
      RUSH_REASONING_EFFORT: "xhigh",
    });

    expect(cfg.modes.smart.reasoningEffort).toBe("low");
    expect(cfg.modes.deep.reasoningEffort).toBe("high");
    expect(cfg.modes.rush.reasoningEffort).toBe("xhigh");
  });

  test("settings configure default mode, model defaults, and disabled tools", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "ak" }, {
      defaultMode: "rush",
      modes: {
        smart: { model: "settings-smart", reasoningEffort: "low" },
        custom: { model: "settings-custom" },
      },
      disabledTools: ["Bash"],
    });

    expect(cfg.defaultMode).toBe("rush");
    expect(cfg.modes.smart).toEqual({
      model: "settings-smart",
      reasoningEffort: "low",
    });
    expect(cfg.modes.custom).toEqual({ model: "settings-custom" });
    expect(cfg.tools.disabled).toEqual(["Bash"]);
  });

  test("env model and reasoning overrides take precedence over settings", () => {
    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      SMART_MODEL: "env-smart",
      SMART_REASONING_EFFORT: "high",
    }, {
      modes: {
        smart: { model: "settings-smart", reasoningEffort: "low" },
      },
    });

    expect(cfg.modes.smart).toEqual({
      model: "env-smart",
      reasoningEffort: "high",
    });
  });

  test("invalid reasoning effort env vars throw clearly", () => {
    expect(() =>
      loadConfig({
        ANTHROPIC_API_KEY: "ak",
        SMART_REASONING_EFFORT: "huge",
      }),
    ).toThrow(/invalid SMART_REASONING_EFFORT/);
  });

  test("throws when no provider is configured", () => {
    expect(() => loadConfig({})).toThrow(/no provider configured/);
  });

  test("trims provider keys, base URLs, and model overrides", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "  ok  ",
      OPENAI_BASE_URL: "  https://example.test/v1  ",
      SMART_MODEL: "  claude-sonnet-4-5  ",
    });
    expect(cfg.openai).toEqual({
      apiKey: "ok",
      baseURL: "https://example.test/v1",
    });
    expect(cfg.modes.smart.model).toBe("claude-sonnet-4-5");
  });

  test("ignores blank provider keys and model overrides", () => {
    expect(() =>
      loadConfig({ OPENAI_API_KEY: "   ", ANTHROPIC_AUTH_TOKEN: "" }),
    ).toThrow(
      /no provider configured/,
    );

    const cfg = loadConfig({
      ANTHROPIC_API_KEY: "ak",
      SMART_MODEL: "",
      DEEP_MODEL: "   ",
      RUSH_MODEL: "",
      SMART_REASONING_EFFORT: "",
      DEEP_REASONING_EFFORT: "   ",
    });
    expect(cfg.modes.smart.model).toBe(DEFAULT_SMART_MODEL);
    expect(cfg.modes.deep.model).toBe(DEFAULT_DEEP_MODEL);
    expect(cfg.modes.rush.model).toBe(DEFAULT_RUSH_MODEL);
    expect(cfg.modes.smart.reasoningEffort).toBeUndefined();
    expect(cfg.modes.deep.reasoningEffort).toBeUndefined();
    expect(cfg.modes.rush.reasoningEffort).toBe("medium");
  });

  test("supports an Anthropic-compatible gpt-5.5 smart mode", () => {
    const cfg = loadConfig({
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "http://43.130.41.96:3000",
      SMART_MODEL: "anthropic:gpt-5.5",
    });
    expect(cfg.anthropic).toEqual({
      authToken: "token",
      baseURL: "http://43.130.41.96:3000",
    });
    expect(cfg.modes.smart.model).toBe("anthropic:gpt-5.5");
  });
});

describe("resolveMode", () => {
  test("returns the model for a known mode", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "ak" });
    expect(resolveMode(cfg, "smart")).toBe(DEFAULT_SMART_MODEL);
    expect(resolveMode(cfg, "deep")).toBe(DEFAULT_DEEP_MODEL);
    expect(resolveMode(cfg, "rush")).toBe(DEFAULT_RUSH_MODEL);
  });

  test("throws with a list of known modes for unknown names", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "ak" });
    expect(() => resolveMode(cfg, "ultra")).toThrow(/unknown mode "ultra"/);
    expect(() => resolveMode(cfg, "ultra")).toThrow(/deep, rush, smart/);
  });
});
