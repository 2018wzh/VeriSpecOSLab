import { describe, expect, test } from "bun:test";
import { TodoState, createTodoReadTool, createTodoWriteTool } from "../../app/tools/todo.ts";

describe("todo tools", () => {
  test("TodoRead returns current todo JSON", async () => {
    const state = new TodoState([
      { id: "1", content: "plan", status: "pending" },
    ]);
    const read = createTodoReadTool(state);
    expect(JSON.parse(await read.execute("{}"))).toEqual([
      { id: "1", content: "plan", status: "pending" },
    ]);
  });

  test("TodoWrite replaces todo state", async () => {
    const state = new TodoState([
      { id: "old", content: "old", status: "pending" },
    ]);
    const write = createTodoWriteTool(state);
    const result = await write.execute(JSON.stringify({
      todos: [
        { id: "1", content: "plan", status: "completed" },
        { id: "2", content: "code", status: "in_progress" },
      ],
    }));

    expect(result).toBe("OK");
    expect(state.items).toEqual([
      { id: "1", content: "plan", status: "completed" },
      { id: "2", content: "code", status: "in_progress" },
    ]);
  });

  test("TodoWrite clears todo state", async () => {
    const state = new TodoState([
      { id: "1", content: "plan", status: "completed" },
    ]);
    const write = createTodoWriteTool(state);

    expect(await write.execute(JSON.stringify({ todos: [] }))).toBe("OK");
    expect(state.items).toEqual([]);
  });

  test("TodoWrite validates statuses and required fields", async () => {
    const state = new TodoState();
    const write = createTodoWriteTool(state);
    expect(await write.execute("not json")).toContain("Error parsing TodoWrite arguments");
    expect(await write.execute(JSON.stringify({
      todos: [{ id: " ", content: "x", status: "pending" }],
    }))).toContain(
      "id",
    );
    expect(await write.execute(JSON.stringify({
      todos: [{ id: "1", content: " ", status: "pending" }],
    }))).toContain(
      "content",
    );
    expect(await write.execute(JSON.stringify({
      todos: [{ id: "1", content: "x", status: "blocked" }],
    }))).toContain("invalid status");
    expect(await write.execute(JSON.stringify({
      todos: [
        { id: "1", content: "x", status: "pending" },
        { id: "1", content: "y", status: "pending" },
      ],
    }))).toContain("duplicate todo id");
  });
});
