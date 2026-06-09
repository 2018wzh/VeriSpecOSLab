import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  expandProjectCommand,
  loadProjectCommands,
} from "../../app/terminal/project-commands.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("project commands", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("stars-project-commands-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("returns no commands when the project command directory is missing", () => {
    expect(loadProjectCommands({ workspaceRoot: tmp })).toEqual([]);
  });

  test("loads markdown commands and expands arguments", () => {
    writeFixture(tmp, ".agents/commands/review.md", "Review this:\n\n$ARGUMENTS\n");

    const commands = loadProjectCommands({ workspaceRoot: tmp });
    expect(commands.map((command) => command.name)).toEqual(["review"]);
    expect(expandProjectCommand("/review app/main.ts", commands)).toEqual({
      name: "review",
      prompt: "Review this:\n\napp/main.ts",
    });
  });

  test("appends arguments when the template has no placeholder", () => {
    writeFixture(tmp, ".agents/commands/plan.md", "Make a plan.");
    const commands = loadProjectCommands({ workspaceRoot: tmp });

    expect(expandProjectCommand("/plan build tests", commands)).toEqual({
      name: "plan",
      prompt: "Make a plan.\n\nbuild tests",
    });
  });

  test("returns undefined for missing project commands", () => {
    writeFixture(tmp, ".agents/commands/review.md", "Review $ARGUMENTS");
    const commands = loadProjectCommands({ workspaceRoot: tmp });

    expect(expandProjectCommand("/missing app/main.ts", commands)).toBeUndefined();
  });

  test("rejects invalid command definitions", () => {
    writeFixture(tmp, ".agents/commands/empty.md", "   \n");
    expect(() => loadProjectCommands({ workspaceRoot: tmp })).toThrow(
      /project command "empty" must not be empty/,
    );
  });

  test("rejects invalid command filenames", () => {
    writeFixture(tmp, ".agents/commands/1bad.md", "Bad name");
    expect(() => loadProjectCommands({ workspaceRoot: tmp })).toThrow(
      /invalid project command filename "1bad\.md"/,
    );
  });

  test("rejects commands that conflict with built-in slash commands", () => {
    writeFixture(tmp, ".agents/commands/help.md", "Conflicting command");
    expect(() => loadProjectCommands({ workspaceRoot: tmp })).toThrow(
      /project command "help" conflicts with a built-in command/,
    );
  });
});
