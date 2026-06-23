import { describe, expect, test } from "bun:test";
import { createTaskTool, taskToolSchema } from "../../app/tools/task.ts";
import { ToolRegistry } from "../../app/tools/types.ts";
import { CallbackChatClient, ScriptedChatClient, TEST_MODEL, textResponse } from "../helpers/stub-chat.ts";

describe("task tool", () => {
  test("schema advertises description and prompt as required", () => {
    expect(taskToolSchema.function.name).toBe("Task");
    const params = taskToolSchema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.description).toBeDefined();
    expect(params.properties.prompt).toBeDefined();
    expect(params.properties.subagent_type).toBeDefined();
    expect(params.required.sort()).toEqual(["description", "prompt"]);
  });

  test("runs a nested agent with a fresh registry", async () => {
    const chat = new ScriptedChatClient([textResponse("subagent result")]);
    const task = createTaskTool({
      chat,
      model: TEST_MODEL,
      registryFactory: () => new ToolRegistry(),
    });

    const result = await task.execute(JSON.stringify({
      description: "inspect docs",
      prompt: "Read the docs and summarize the risk.",
    }));

    expect(result).toBe("subagent result");
    expect(chat.requests[0].model).toBe(TEST_MODEL);
    expect(chat.requests[0].messages.at(-1)).toMatchObject({
      role: "user",
      content: "Read the docs and summarize the risk.",
    });
  });

  test("applies declarative subagent specs", async () => {
    let selectedSpecName: string | undefined;
    const chat = new CallbackChatClient((request) => {
      expect(request.model).toBe("finder-model");
      expect(request.reasoningEffort).toBe("low");
      expect(String(request.messages.at(-1)?.content)).toContain("You are a read-only finder.");
      expect(String(request.messages.at(-1)?.content)).toContain("Locate config parsing.");
      return textResponse("found config parser");
    });
    const task = createTaskTool({
      chat,
      model: TEST_MODEL,
      registryFactory: (spec) => {
        selectedSpecName = spec.name;
        return new ToolRegistry();
      },
      specs: [{
        name: "finder",
        description: "Read-only code finder",
        model: "finder-model",
        reasoningEffort: "low",
        instructions: "You are a read-only finder.",
        disabledTools: ["Write", "Edit"],
      }],
    });

    const result = await task.execute(JSON.stringify({
      description: "find config",
      subagent_type: "finder",
      prompt: "Locate config parsing.",
    }));

    expect(result).toBe("found config parser");
    expect(selectedSpecName).toBe("finder");
  });

  test("unknown subagent specs return a repairable error", async () => {
    const task = createTaskTool({
      chat: new ScriptedChatClient([]),
      model: TEST_MODEL,
      registryFactory: () => new ToolRegistry(),
      specs: [{ name: "finder", description: "Read-only code finder" }],
    });

    expect(await task.execute(JSON.stringify({
      description: "find config",
      subagent_type: "missing",
      prompt: "Locate config parsing.",
    }))).toContain('unknown subagent_type "missing". known subagents: general, finder');
  });

  test("returns parse and validation errors instead of throwing", async () => {
    const task = createTaskTool({
      chat: new ScriptedChatClient([]),
      model: TEST_MODEL,
      registryFactory: () => new ToolRegistry(),
    });

    expect(await task.execute("not json")).toContain("Error parsing Task arguments");
    expect(await task.execute(JSON.stringify({
      description: " ",
      prompt: "work",
    }))).toContain('"description" must be non-empty');
    expect(await task.execute(JSON.stringify({
      description: "work",
      prompt: "",
    }))).toContain('"prompt" must be non-empty');
  });
});
