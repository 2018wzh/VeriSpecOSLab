import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSettings } from "../app/settings.ts";
import { makeTmpDir, removeTmpDir } from "./helpers/tmp.ts";

describe("loadSettings", () => {
  let tmp: string;
  let stateDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmp = makeTmpDir("vos-agent-settings-");
    stateDir = join(tmp, "state");
    workspaceRoot = join(tmp, "workspace");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(join(workspaceRoot, ".vos", "agent"), { recursive: true });
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("loads and merges user and workspace settings", () => {
    writeFileSync(join(stateDir, "settings.json"), JSON.stringify({
      defaultMode: "rush",
      modes: {
        smart: { model: "user-smart" },
        rush: { reasoningEffort: "low" },
      },
      tools: { disabled: ["Bash"] },
    }), "utf8");
    writeFileSync(join(workspaceRoot, ".vos", "agent", "settings.json"), JSON.stringify({
      defaultMode: "deep",
      modes: {
        smart: { model: "workspace-smart" },
        deep: { model: "workspace-deep" },
      },
      tools: { disabled: ["Write", "Bash"] },
    }), "utf8");

    expect(loadSettings({ stateDir, workspaceRoot })).toEqual({
      defaultMode: "deep",
      modes: {
        smart: { model: "workspace-smart" },
        rush: { reasoningEffort: "low" },
        deep: { model: "workspace-deep" },
      },
      disabledTools: ["Bash", "Write"],
    });
  });

  test("returns empty settings when files are missing", () => {
    expect(loadSettings({ stateDir, workspaceRoot })).toEqual({
      modes: {},
      disabledTools: [],
    });
  });

  test("rejects invalid settings clearly", () => {
    writeFileSync(join(workspaceRoot, ".vos", "agent", "settings.json"), JSON.stringify({
      tools: { disabled: ["Bash", 1] },
    }), "utf8");

    expect(() => loadSettings({ stateDir, workspaceRoot })).toThrow(
      /tools.disabled\[1\] must be a non-empty string/,
    );
  });
});
