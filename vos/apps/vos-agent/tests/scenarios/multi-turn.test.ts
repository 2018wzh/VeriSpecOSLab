// End-to-end scenario: multi-turn agent loop.
// Two reads in sequence: model reads README.md → learns the data file's
// name → reads that file → answers the value. Verifies that intermediate
// tool results flow back into the conversation correctly.

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

describe("scenario: multi-turn agent loop", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDir("multi-turn-");
  });
  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("derives expiry by reading two files in sequence", async () => {
    const mainFile = "main.py";
    const extraStem = "chemical";
    const extraFile = `${extraStem}.py`;
    const expiry = 19;

    writeFixture(
      tmp,
      "README.md",
      [
        "This is a simple python project.",
        `- The starting point of this project is app/${mainFile}.`,
        `- The file app/${extraFile} contains chemical properties.`,
      ].join("\n"),
    );
    writeFixture(
      tmp,
      `app/${extraFile}`,
      `chemical_expiry_period = ${expiry}  # months`,
    );
    writeFixture(
      tmp,
      `app/${mainFile}`,
      `from ${extraStem} import chemical_expiry_period\n`,
    );

    const chat = new CallbackChatClient((_req, i) => {
      if (i === 0) {
        return toolCallResponse([
          { name: "Read", args: { file_path: "README.md" }, id: "r1" },
        ]);
      }
      if (i === 1) {
        return toolCallResponse([
          { name: "Read", args: { file_path: `app/${extraFile}` }, id: "r2" },
        ]);
      }
      return textResponse(String(expiry));
    });

    const registry = createBuiltinToolRegistry({ rootDir: tmp });
    const result = await runAgent({
      model: TEST_MODEL,
      chat,
      registry,
      prompt:
        "Find the chemical expiry period in months from README.md. Respond with only a number.",
    });

    expect(result.content).toBe(String(expiry));
    expect(result.iterations).toBe(3);
  });
});
