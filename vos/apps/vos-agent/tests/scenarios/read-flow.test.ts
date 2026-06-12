// End-to-end scenario: a single Read tool call.
// Creates a fixture file and verifies the agent returns the raw contents
// when the (scripted) LLM issues one Read.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { runAgent } from "../../app/agent/loop.ts";
import { createBuiltinToolRegistry } from "../../app/tools/builtin.ts";
import {
  CallbackChatClient,
  TEST_MODEL,
  textResponse,
  toolCallResponse,
} from "../helpers/stub-chat.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("scenario: single read", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir("read-flow-");
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  test.each([
    "print('Hello, World!')",
    "print('Hello, program!')",
    "print('Hello there!')",
  ])("returns exact contents of fixture (%s)", async (fileContents) => {
    const fileName = "apple.py";
    writeFixture(tmp, fileName, fileContents);

    const chat = new CallbackChatClient((_req, i) => {
      if (i === 0) {
        return toolCallResponse([
          { name: "Read", args: { file_path: fileName }, id: "c0" },
        ]);
      }
      // The model echoes the tool result back as its final answer.
      const last = _req.messages[_req.messages.length - 1] as {
        role: string;
        content: string;
      };
      return textResponse(last.content);
    });

    const registry = createBuiltinToolRegistry({ rootDir: tmp });
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt: `What is the content of \`${fileName}\`?`,
    });

    expect(result.content).toBe(fileContents);
  });
});
