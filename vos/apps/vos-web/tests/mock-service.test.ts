import { describe, expect, test } from "bun:test";
import {
  createDemoPortal,
  createMemoryStorage,
  sanitizeRun,
  type User,
} from "../src/lib/api.ts";

describe("vos-web demo portal service", () => {
  test("logs in demo accounts and persists session state", () => {
    const storage = createMemoryStorage();
    const portal = createDemoPortal(storage);

    const user = portal.login("student", "student");
    const restored = createDemoPortal(storage).me();

    expect(user).toMatchObject({ username: "student", role: "student" });
    expect(restored).toMatchObject({ username: "student", role: "student" });
  });

  test("redacts staff-only run details from student views", () => {
    const storage = createMemoryStorage();
    const portal = createDemoPortal(storage);
    const student = portal.login("risk", "risk");
    const teacher = portal.login("teacher", "teacher");
    const staffRun = portal.bundle(teacher, "project-risk-review").runs.find((run) => run.id === "run-risk-resource-audit");
    expect(staffRun).toBeDefined();

    const redacted = sanitizeRun(student, staffRun!);

    expect(redacted.staff_log).toBeUndefined();
    expect(redacted.tool_calls.some((tool) => tool.name === "Task")).toBe(false);
    expect(redacted.events.every((event) => event.visibility === "student")).toBe(true);
    expect(redacted.log_lines.every((line) => line.visibility === "student")).toBe(true);
    expect(redacted.artifacts.every((artifact) => artifact.visibility === "student")).toBe(true);
    expect(redacted.risk_tags.some((tag) => tag.label === "large_patch_proposal")).toBe(false);
  });

  test("student bundle only exposes that student's project", () => {
    const portal = createDemoPortal(createMemoryStorage());
    const student = portal.login("student", "student");
    const bundle = portal.bundle(student);

    expect(bundle.projects.map((item) => item.project.id)).toEqual(["project-demo-student"]);
    expect(bundle.rubrics).toEqual([]);
    expect(bundle.qaNotes).toEqual([]);
  });

  test("chat creates read-only local replies and audit summaries", () => {
    const portal = createDemoPortal(createMemoryStorage());
    const student = portal.login("student", "student");

    const before = portal.bundle(student).audits.length;
    const thread = portal.sendChat(student, "project-demo-student", "Which command should I run?");
    const after = portal.bundle(student).audits;

    expect(thread.messages.at(-1)?.role).toBe("assistant");
    expect(thread.messages.at(-1)?.content).toContain("I only recommend it; I do not run it");
    expect(after).toHaveLength(before + 1);
    expect(after[0]).toMatchObject({ task_kind: "student_chat", risk_level: "low" });
  });

  test("seeded runs include full platform chain logs for submission detail", () => {
    const portal = createDemoPortal(createMemoryStorage());
    const teacher = portal.login("teacher", "teacher");
    const run = portal.bundle(teacher, "project-demo-student").runs.find((item) => item.id === "run-demo-memory-debug");

    expect(run?.steps.map((step) => step.id)).toEqual([
      "submit",
      "spec-lint",
      "arch-lint",
      "build",
      "qemu",
      "public-verify",
      "evidence-ingest",
      "agent-assist",
      "ta-review",
      "score-freeze",
      "appeal-retro",
    ]);
    expect(run?.log_lines.some((line) => line.step_id === "public-verify" && line.severity === "error")).toBe(true);
  });

  test("QA replay and notes are localStorage-backed demo actions", () => {
    const storage = createMemoryStorage();
    const portal = createDemoPortal(storage);
    const teacher = portal.login("teacher", "teacher");

    const replay = portal.replayRun(teacher, "run-demo-memory-debug");
    portal.addQaNote(teacher, replay.id, "Replay looked good in class.");
    const restored = createDemoPortal(storage);
    const bundle = restored.bundle(teacher, "project-demo-student");

    expect(replay.demo_action).toBe(true);
    expect(bundle.runs.some((run) => run.id === replay.id)).toBe(true);
    expect(bundle.qaNotes.some((note) => note.run_id === replay.id)).toBe(true);
  });

  test("students cannot add staff QA notes", () => {
    const portal = createDemoPortal(createMemoryStorage());
    const student: User = portal.login("student", "student");

    expect(() => portal.addQaNote(student, "run-demo-memory-debug", "note")).toThrow("Only staff");
  });
});
