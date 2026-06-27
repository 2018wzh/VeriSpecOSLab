import { describe, expect, test } from "bun:test";
import { ToolRegistry, type Tool } from "../../app/tools/types.ts";
import { createBuiltinToolRegistry } from "../../app/tools/builtin.ts";
import { CallbackChatClient, ScriptedChatClient, TEST_MODEL, textResponse } from "../helpers/stub-chat.ts";

function fakeTool(name: string, handler: (args: string) => string): Tool {
  return {
    name,
    schema: {
      type: "function",
      function: {
        name,
        description: "",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    execute: handler,
  };
}

describe("ToolRegistry", () => {
  test("registers and lists tools by name", () => {
    const reg = new ToolRegistry([
      fakeTool("A", () => "a"),
      fakeTool("B", () => "b"),
    ]);
    expect(reg.names().sort()).toEqual(["A", "B"]);
    expect(reg.has("A")).toBe(true);
    expect(reg.has("C")).toBe(false);
  });

  test("schemas() returns the schema of every registered tool", () => {
    const reg = new ToolRegistry([fakeTool("A", () => "a")]);
    const schemas = reg.schemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe("A");
  });

  test("execute() dispatches by name and returns handler result", async () => {
    const reg = new ToolRegistry([
      fakeTool("Echo", (args) => `echo:${args}`),
    ]);
    const result = await reg.execute("Echo", '{"x":1}');
    expect(result).toBe('echo:{"x":1}');
  });

  test("execute() returns a fallback string for unknown tools", async () => {
    const reg = new ToolRegistry();
    const result = await reg.execute("Missing", "{}");
    expect(result).toContain("Unknown tool: Missing");
  });

  test("register() rejects duplicate tool names", () => {
    const reg = new ToolRegistry([fakeTool("A", () => "a")]);
    expect(() => reg.register(fakeTool("A", () => "x"))).toThrow(
      /already registered/,
    );
  });

  test("awaits async tool handlers", async () => {
    const reg = new ToolRegistry([
      {
        name: "Async",
        schema: fakeTool("Async", () => "").schema,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return "done";
        },
      },
    ]);
    expect(await reg.execute("Async", "{}")).toBe("done");
  });

  test("execute() converts thrown tool errors into tool-result text", async () => {
    const reg = new ToolRegistry([
      fakeTool("Boom", () => {
        throw new Error("bad args");
      }),
    ]);
    const result = await reg.execute("Boom", "{}");
    expect(result).toContain('Error executing tool "Boom"');
    expect(result).toContain("bad args");
  });

  test("policy-denied tool executions return text instead of throwing", async () => {
    const reg = new ToolRegistry([
      fakeTool("Bash", () => "ran"),
    ], {
      policy: {
        canExecute: ({ name }) => name === "Bash"
          ? { allowed: false, reason: "disabled by settings" }
          : { allowed: true },
      },
    });

    const result = await reg.execute("Bash", "{}");
    expect(result).toContain('Tool "Bash" denied by policy');
    expect(result).toContain("disabled by settings");
  });

  test("policy can hide a tool from advertised names and schemas", () => {
    const reg = new ToolRegistry([
      fakeTool("Read", () => "read"),
      fakeTool("Bash", () => "ran"),
    ], {
      policy: {
        canAdvertise: (tool) => tool.name !== "Bash",
      },
    });

    expect(reg.names()).toEqual(["Read"]);
    expect(reg.has("Bash")).toBe(false);
    expect(reg.schemas().map((schema) => schema.function.name)).toEqual(["Read"]);
  });
});

describe("createBuiltinToolRegistry", () => {
  test("includes VOS-native file and command tools", () => {
    const reg = createBuiltinToolRegistry();
    expect(reg.names().sort()).toEqual([
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "Vos",
      "Write",
    ]);
    expect(reg.schemas()).toHaveLength(6);
  });

  test("includes Task only when subagent options are provided", () => {
    const reg = createBuiltinToolRegistry({
      task: {
        chat: new ScriptedChatClient([]),
        model: TEST_MODEL,
      },
    });
    expect(reg.names().sort()).toEqual([
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "Task",
      "Vos",
      "Write",
    ]);
  });

  test("disabled built-in tools are hidden and policy-denied on execution", async () => {
    const reg = createBuiltinToolRegistry({ disabledTools: ["vos"] });

    expect(reg.names().sort()).toEqual([
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "Write",
    ]);
    expect(reg.schemas().map((schema) => schema.function.name)).not.toContain("Vos");
    expect(await reg.execute("Vos", "{}")).toContain('Tool "Vos" denied by policy');
  });

  test("external tools use the same registry and disabled-tool policy", async () => {
    const reg = createBuiltinToolRegistry({
      extraTools: [fakeTool("mcp__fake__echo", () => "ran")],
      disabledTools: ["mcp__fake__echo"],
    });

    expect(reg.names()).not.toContain("mcp__fake__echo");
    expect(await reg.execute("mcp__fake__echo", "{}")).toContain(
      'Tool "mcp__fake__echo" denied by policy',
    );
  });

  test("course mode denies write tools even if they are supplied externally", async () => {
    const reg = createBuiltinToolRegistry({
      courseMode: true,
      extraTools: [fakeTool("Write", () => "wrote")],
    });

    expect(reg.names()).not.toContain("Write");
    expect(await reg.execute("Write", JSON.stringify({
      file_path: "boot-flow-visual.html",
      content: "<html></html>",
    }))).toContain('Tool "Write" denied by policy');
  });

  test("Task subagent specs restrict the nested built-in registry", async () => {
    const chat = new CallbackChatClient((request) => {
      const names = request.tools.map((tool) => tool.function.name);
      expect(names).toContain("Read");
      expect(names).not.toContain("Write");
      expect(names).not.toContain("Task");
      return textResponse("finder done");
    });
    const reg = createBuiltinToolRegistry({
      task: {
        chat,
        model: TEST_MODEL,
        specs: [{
          name: "finder",
          description: "Read-only code finder",
          disabledTools: ["Write"],
        }],
      },
    });

    expect(await reg.execute("Task", JSON.stringify({
      description: "find files",
      subagent_type: "finder",
      prompt: "Find config files.",
    }))).toBe("finder done");
  });
});
