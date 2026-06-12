import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ThreadStore } from "../../app/session/thread-store.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("ThreadStore", () => {
  let tmp: string;
  let now: Date;

  beforeEach(() => {
    tmp = makeTmpDir("stars-thread-store-");
    now = new Date("2026-06-03T12:00:00.000Z");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("creates a thread record with deterministic id, timestamps, title, and path", () => {
    const store = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-test",
      now: () => now,
    });

    const thread = store.create({
      prompt: "Build stars",
      model: "m",
      mode: "rush",
      reasoningEffort: "medium",
    });

    expect(thread).toMatchObject({
      schemaVersion: 1,
      id: "T-test",
      title: "Build stars",
      createdAt: "2026-06-03T12:00:00.000Z",
      updatedAt: "2026-06-03T12:00:00.000Z",
      workspaceRoot: tmp,
      model: "m",
      mode: "rush",
      reasoningEffort: "medium",
      messages: [],
      todos: [],
    });
    expect(store.pathFor("T-test")).toBe(join(tmp, "threads", "T-test.json"));
  });

  test("saves and loads a transcript", () => {
    const store = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-save",
      now: () => now,
    });
    const thread = store.create({ prompt: "Read x", model: "m" });
    thread.messages = [
      { role: "system", content: "rules" },
      { role: "user", content: "Read x" },
      { role: "assistant", content: "done" },
    ];
    thread.todos = [{ id: "1", content: "inspect", status: "completed" }];
    store.save(thread);

    const loaded = store.load("T-save");
    expect(loaded).toEqual(thread);
  });

  test("lists thread summaries newest first", () => {
    const store = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-old",
      now: () => new Date("2026-06-03T12:00:00.000Z"),
    });
    const old = store.create({ prompt: "old prompt", model: "m" });
    old.messages = [{ role: "user", content: "old prompt" }];
    store.save(old);

    const newerStore = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-new",
      now: () => new Date("2026-06-03T12:05:00.000Z"),
    });
    const newer = newerStore.create({ prompt: "new prompt", model: "m" });
    newer.messages = [{ role: "user", content: "new prompt" }];
    newerStore.save(newer);

    expect(store.list().map((t) => t.id)).toEqual(["T-new", "T-old"]);
    expect(store.list()[0]).toMatchObject({
      id: "T-new",
      title: "new prompt",
      messageCount: 1,
    });
  });

  test("archives threads and filters archived summaries", () => {
    const store = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-active",
      now: () => new Date("2026-06-03T12:00:00.000Z"),
    });
    const active = store.create({ prompt: "active prompt", model: "m" });
    store.save(active);

    const archivedStore = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => "T-archived",
      now: () => new Date("2026-06-03T12:05:00.000Z"),
    });
    const archived = archivedStore.create({ prompt: "archived prompt", model: "m" });
    archivedStore.save(archived);

    const archiveTime = new Date("2026-06-03T12:10:00.000Z");
    const archiveStore = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      now: () => archiveTime,
    });
    const archivedThread = archiveStore.archive("T-archived");

    expect(archivedThread.archivedAt).toBe("2026-06-03T12:10:00.000Z");
    expect(archiveStore.load("T-archived").archivedAt).toBe(
      "2026-06-03T12:10:00.000Z",
    );
    expect(archiveStore.list().map((t) => t.id)).toEqual(["T-active"]);
    expect(archiveStore.list({ archived: "archived" }).map((t) => t.id)).toEqual([
      "T-archived",
    ]);
    expect(archiveStore.list({ archived: "all" }).map((t) => t.id)).toEqual([
      "T-archived",
      "T-active",
    ]);
    expect(archiveStore.list({ archived: "archived" })[0].archivedAt).toBe(
      "2026-06-03T12:10:00.000Z",
    );
  });

  test("forks a thread into a new active transcript copy", () => {
    let nextId = "T-source";
    const store = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: tmp,
      idGenerator: () => nextId,
      now: () => new Date("2026-06-03T12:00:00.000Z"),
    });
    const source = store.create({
      prompt: "original prompt",
      model: "m",
      mode: "deep",
      reasoningEffort: "high",
      guidanceFiles: [{ path: "AGENTS.md", scopeDir: tmp }],
      todos: [{ id: "1", content: "plan", status: "completed" }],
    });
    source.messages = [
      { role: "user", content: "original prompt" },
      { role: "assistant", content: "done" },
    ];
    store.save(source);
    store.archive("T-source");
    nextId = "T-fork";

    const fork = store.fork("T-source");

    expect(fork).toMatchObject({
      id: "T-fork",
      title: "Fork of original prompt",
      model: "m",
      mode: "deep",
      reasoningEffort: "high",
      messages: source.messages,
      todos: source.todos,
      guidanceFiles: source.guidanceFiles,
    });
    expect(fork.archivedAt).toBeUndefined();
    expect(store.load("T-fork")).toEqual(fork);
    expect(store.list({ archived: "all" }).map((t) => t.id)).toEqual([
      "T-fork",
      "T-source",
    ]);
  });

  test("archive and fork reject threads from another workspace", () => {
    const otherWorkspace = join(tmp, "other-workspace");
    const otherStore = new ThreadStore({
      stateDir: tmp,
      workspaceRoot: otherWorkspace,
      idGenerator: () => "T-other",
      now: () => now,
    });
    otherStore.save(otherStore.create({ prompt: "other", model: "m" }));

    const store = new ThreadStore({ stateDir: tmp, workspaceRoot: tmp });

    expect(() => store.archive("T-other")).toThrow(/belongs to workspace/);
    expect(() => store.fork("T-other")).toThrow(/belongs to workspace/);
  });

  test("returns an empty list when the store directory does not exist", () => {
    const store = new ThreadStore({ stateDir: join(tmp, "missing"), workspaceRoot: tmp });
    expect(store.list()).toEqual([]);
  });

  test("ignores schema-valid but incomplete thread files while listing", () => {
    const threadsDir = join(tmp, "threads");
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(join(threadsDir, "T-bad.json"), JSON.stringify({
      schemaVersion: 1,
      id: "T-bad",
      messages: [],
      todos: [],
      guidanceFiles: [],
    }), "utf8");

    const store = new ThreadStore({ stateDir: tmp, workspaceRoot: tmp });
    expect(store.list()).toEqual([]);
  });

  test("rejects corrupted reasoning effort values while loading", () => {
    const threadsDir = join(tmp, "threads");
    mkdirSync(threadsDir, { recursive: true });
    writeFileSync(
      join(threadsDir, "T-bad-reasoning.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "T-bad-reasoning",
        title: "bad",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        workspaceRoot: tmp,
        model: "m",
        reasoningEffort: "huge",
        messages: [],
        todos: [],
        guidanceFiles: [],
      }),
      "utf8",
    );

    const store = new ThreadStore({ stateDir: tmp, workspaceRoot: tmp });
    expect(() => store.load("T-bad-reasoning")).toThrow(
      /reasoningEffort is invalid/,
    );
  });

  test("rejects invalid thread ids before touching disk", () => {
    const store = new ThreadStore({ stateDir: tmp, workspaceRoot: tmp });
    for (const id of ["../x", "x/y", ".hidden", ""]) {
      expect(() => store.pathFor(id)).toThrow(/invalid thread id/);
    }
    expect(existsSync(join(tmp, "..", "x.json"))).toBe(false);
  });
});
