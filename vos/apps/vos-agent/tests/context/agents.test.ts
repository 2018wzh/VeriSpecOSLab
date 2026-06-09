import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildAgentSystemPrompt,
  loadAgentGuidance,
  toAgentGuidanceRefs,
} from "../../app/context/agents.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("AGENTS.md guidance", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("vos-agent-guidance-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("loads AGENTS.md files from root to start dir in scope order", () => {
    writeFixture(tmp, "AGENTS.md", "root rules");
    writeFixture(tmp, "app/AGENTS.md", "app rules");
    writeFixture(tmp, "app/src/file.ts", "x");

    const files = loadAgentGuidance({
      rootDir: tmp,
      startDir: join(tmp, "app", "src"),
    });

    expect(files.map((f) => f.content)).toEqual(["root rules", "app rules"]);
    expect(files.map((f) => f.scopeDir)).toEqual([tmp, join(tmp, "app")]);
    expect(toAgentGuidanceRefs(files)).toEqual(
      files.map(({ path, scopeDir }) => ({ path, scopeDir })),
    );
  });

  test("builds a VOS system prompt with guidance sections", () => {
    writeFixture(tmp, "AGENTS.md", "root rules\n");
    const files = loadAgentGuidance({ rootDir: tmp, startDir: tmp });
    const prompt = buildAgentSystemPrompt(files);

    expect(prompt).toContain("You are VOS Agent");
    expect(prompt).toContain("Use the Vos tool");
    expect(prompt).toContain(`# AGENTS.md instructions for ${tmp}`);
    expect(prompt).toContain("<INSTRUCTIONS>\nroot rules\n</INSTRUCTIONS>");
  });

  test("returns the base VOS system prompt when no AGENTS files are present", () => {
    expect(loadAgentGuidance({ rootDir: tmp, startDir: tmp })).toEqual([]);
    expect(buildAgentSystemPrompt([])).toContain("You are VOS Agent");
  });

  test("throws when startDir escapes rootDir", () => {
    expect(() =>
      loadAgentGuidance({ rootDir: join(tmp, "root"), startDir: tmp }),
    ).toThrow(/escapes workspace root/);
  });

  test("allows child directories whose names start with dots", () => {
    writeFixture(tmp, "AGENTS.md", "root rules");
    writeFixture(tmp, "..cache/AGENTS.md", "cache rules");

    const files = loadAgentGuidance({
      rootDir: tmp,
      startDir: join(tmp, "..cache"),
    });

    expect(files.map((f) => f.content)).toEqual(["root rules", "cache rules"]);
  });
});
