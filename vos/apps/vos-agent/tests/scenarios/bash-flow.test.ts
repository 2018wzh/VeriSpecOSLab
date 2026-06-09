// End-to-end scenario: Bash filesystem manipulation.
// Agent lists files via `ls`, then removes one of them via `rm`.
// Verifies that shell side-effects are observable on disk and that
// unrelated files are not disturbed.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent } from "../../app/agent/loop.ts";
import { createBashTool } from "../../app/tools/bash.ts";
import { ToolRegistry } from "../../app/tools/types.ts";
import {
  CallbackChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

const MAIN_JS = `async function main() {
  const response = await fetch('https://jsonplaceholder.typicode.com/posts/1');
  const data = await response.json();
  console.log(data);
}

main();`;

const README = `# My Project
Uses async js to demonstrate web fetch.
Entry point: app/`;

const README_OLD = `# My project
Uses javascript promise api to demonstrate web fetch.
Entry point: app/`;

describe("scenario: bash filesystem manipulation", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir("bash-flow-");
    writeFixture(tmp, "app/main.js", MAIN_JS);
    writeFixture(tmp, "README.md", README);
    writeFixture(tmp, "README_old.md", README_OLD);
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("removes README_old.md and leaves app/main.js + README.md intact", async () => {
    const chat = new CallbackChatClient((_req, i) => {
      if (i === 0) {
        return toolCallResponse([
          { name: "Bash", args: { command: "ls" }, id: "b1" },
        ]);
      }
      if (i === 1) {
        return toolCallResponse([
          { name: "Bash", args: { command: "rm README_old.md" }, id: "b2" },
        ]);
      }
      return textResponse("Deleted old readme file.");
    });

    const registry = new ToolRegistry([createBashTool({ cwd: tmp })]);
    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "List files using ls and delete the old readme file you find.",
    });

    expect(existsSync(join(tmp, "README_old.md"))).toBe(false);
    expect(readFileSync(join(tmp, "README.md"), "utf8")).toBe(README);
    expect(readFileSync(join(tmp, "app/main.js"), "utf8")).toBe(MAIN_JS);
  });
});
