import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadProjectSkills } from "../../app/context/skills.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("project skills", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("vos-skills-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("loads SKILL.md frontmatter from .agents/skills", () => {
    const path = writeFixture(tmp, ".agents/skills/code-review/SKILL.md", [
      "---",
      "name: code-review",
      "description: Review code for correctness and risk.",
      "---",
      "# Code review",
      "Use this when reviewing code.",
    ].join("\n"));

    expect(loadProjectSkills({ rootDir: tmp })).toEqual([{
      name: "code-review",
      description: "Review code for correctness and risk.",
      path,
    }]);
  });

  test("loads CRLF SKILL.md frontmatter", () => {
    const path = writeFixture(tmp, ".agents/skills/windows/SKILL.md", [
      "---",
      "name: windows-skill",
      "description: Works with CRLF frontmatter.",
      "---",
      "# Windows skill",
    ].join("\r\n"));

    expect(loadProjectSkills({ rootDir: tmp })).toEqual([{
      name: "windows-skill",
      description: "Works with CRLF frontmatter.",
      path,
    }]);
  });

  test("uses the skill directory name as a fallback name", () => {
    writeFixture(tmp, ".agents/skills/finder/SKILL.md", [
      "---",
      "description: Find code by behavior.",
      "---",
      "# Finder",
    ].join("\n"));

    expect(loadProjectSkills({ rootDir: tmp }).map((skill) => skill.name)).toEqual(["finder"]);
  });

  test("rejects invalid frontmatter clearly", () => {
    writeFixture(tmp, ".agents/skills/bad/SKILL.md", [
      "---",
      "name:",
      "description: Bad skill.",
      "---",
    ].join("\n"));

    expect(() => loadProjectSkills({ rootDir: tmp })).toThrow(
      /skills.bad.name must be a non-empty string/,
    );
  });

  test("returns no skills when the skills directory is missing", () => {
    expect(loadProjectSkills({ rootDir: join(tmp, "missing") })).toEqual([]);
  });
});
