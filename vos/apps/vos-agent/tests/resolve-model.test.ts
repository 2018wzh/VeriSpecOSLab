import { describe, expect, test } from "bun:test";
import {
  DEFAULT_DEEP_MODEL,
  DEFAULT_RUSH_MODEL,
  DEFAULT_SMART_MODEL,
  loadConfig,
} from "../app/config.ts";
import {
  resolveActiveModel,
  resolveActiveModelSettings,
  shouldUseStoredThreadModel,
} from "../app/resolve-model.ts";

const ANTH_CFG = loadConfig({ ANTHROPIC_API_KEY: "x" });

describe("resolveActiveModel", () => {
  test("falls back to the default mode's model", () => {
    const model = resolveActiveModel(ANTH_CFG, {});
    expect(model).toBe(DEFAULT_SMART_MODEL);
  });

  test("respects --mode (CLI)", () => {
    const model = resolveActiveModel(ANTH_CFG, { mode: "deep" });
    expect(model).toBe(DEFAULT_DEEP_MODEL);
  });

  test("respects --model (CLI) and bypasses mode resolution", () => {
    const model = resolveActiveModel(ANTH_CFG, {
      mode: "deep", // would normally give DEFAULT_DEEP_MODEL
      model: "claude-opus-4-5",
    });
    expect(model).toBe("claude-opus-4-5");
  });

  test("returns mode reasoning effort and omits it for raw model overrides", () => {
    expect(resolveActiveModelSettings(ANTH_CFG, { mode: "rush" })).toEqual({
      model: DEFAULT_RUSH_MODEL,
      mode: "rush",
      reasoningEffort: "medium",
    });
    expect(resolveActiveModelSettings(ANTH_CFG, {
      mode: "rush",
      model: "sonnet4.6",
    })).toEqual({ model: "sonnet4.6" });
  });

  test("returns the configured default mode name when settings change it", () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: "x" }, { defaultMode: "rush" });
    expect(resolveActiveModelSettings(cfg, {})).toEqual({
      model: DEFAULT_RUSH_MODEL,
      mode: "rush",
      reasoningEffort: "medium",
    });
  });

  test("throws for an unknown mode", () => {
    expect(() =>
      resolveActiveModel(ANTH_CFG, { mode: "ultra" }),
    ).toThrow(/unknown mode "ultra"/);
  });

  test("uses stored thread model for resumed execute or piped interactive turns", () => {
    expect(shouldUseStoredThreadModel({
      kind: "execute",
      threadId: "T-1",
    })).toBe(true);
    expect(shouldUseStoredThreadModel({
      kind: "interactive",
      threadId: "T-1",
    })).toBe(true);
    expect(shouldUseStoredThreadModel({
      kind: "interactive",
      threadId: "T-1",
      mode: "smart",
    })).toBe(false);
    expect(shouldUseStoredThreadModel({
      kind: "threads-list",
    })).toBe(false);
  });
});
