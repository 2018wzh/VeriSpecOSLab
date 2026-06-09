// End-to-end scenario: Read then Write.
// Agent reads README.md to determine what to write, then writes the
// required file with exact contents. Verifies tool composition across
// two different tools in a single agent run.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent } from "../../app/agent/loop.ts";
import { createBuiltinToolRegistry } from "../../app/tools/builtin.ts";
import {
  CallbackChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("scenario: read then write", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir("write-flow-");
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("creates the required file with `print(\"Hello world\")`", async () => {
    const mainFile = "main.py";
    writeFixture(
      tmp,
      "README.md",
      [
        "This is a very simple python project.",
        'This should print "Hello world"',
        `This project should contain only one file: app/${mainFile}.`,
      ].join("\n"),
    );
    mkdirSync(join(tmp, "app"), { recursive: true });

    const expected = 'print("Hello world")';
    const chat = new CallbackChatClient((_req, i) => {
      if (i === 0) {
        return toolCallResponse([
          { name: "Read", args: { file_path: "README.md" }, id: "r1" },
        ]);
      }
      if (i === 1) {
        return toolCallResponse([
          {
            name: "Write",
            args: { file_path: `app/${mainFile}`, content: expected },
            id: "w1",
          },
        ]);
      }
      return textResponse("Created the file.");
    });

    const registry = createBuiltinToolRegistry({ rootDir: tmp });
    await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: "Read README.md and create the required file.",
    });

    expect(readFileSync(join(tmp, "app", mainFile), "utf8")).toBe(expected);
  });
});
