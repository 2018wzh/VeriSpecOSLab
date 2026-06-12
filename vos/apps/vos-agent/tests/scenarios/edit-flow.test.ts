import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

describe("scenario: surgical edit", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("edit-flow-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("model can read then patch an existing file without rewriting it", async () => {
    writeFixture(tmp, "src/app.ts", "export const name = \"old\";\nexport const keep = true;\n");
    const chat = new CallbackChatClient((_req, i) => {
      if (i === 0) {
        return toolCallResponse([
          { name: "Read", args: { file_path: "src/app.ts" }, id: "r1" },
        ]);
      }
      if (i === 1) {
        return toolCallResponse([
          {
            name: "Edit",
            args: {
              file_path: "src/app.ts",
              old_str: "export const name = \"old\";",
              new_str: "export const name = \"stars\";",
            },
            id: "e1",
          },
        ]);
      }
      return textResponse("patched");
    });

    await runAgent({
      model: TEST_MODEL,
      chat,
      registry: createBuiltinToolRegistry({ rootDir: tmp }),
      prompt: "Rename old to stars in src/app.ts.",
    });

    expect(readFileSync(join(tmp, "src", "app.ts"), "utf8")).toBe(
      "export const name = \"stars\";\nexport const keep = true;\n",
    );
  });
});
