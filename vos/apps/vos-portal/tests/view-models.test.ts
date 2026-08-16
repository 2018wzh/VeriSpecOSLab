import { describe, expect, test } from "bun:test";
import { createDemoDashboard } from "../demo/seed.ts";
import { getRunActivity, getStudentNextAction, getTeacherQueue } from "../client/view-models.ts";

describe("Portal view models", () => {
  test("student next action points to the current stage and activity is chronological", () => {
    const dashboard = createDemoDashboard();
    expect(getStudentNextAction(dashboard).href).toBe("/stages?stage=memory");
    expect(getRunActivity(dashboard).map((item) => item.id)).toEqual([
      "run-20260516-a1b2c3d",
      "run-20260515-5c6d7e8",
      "run-20260514-4d5e6f7",
    ]);
    dashboard.runs[0].status = "timed_out";
    expect(getStudentNextAction(dashboard).label).toBe("查看失败运行并修复");
  });

  test("teacher queue prioritizes appeals, failures, then submitted designs", () => {
    const dashboard = createDemoDashboard();
    const operations = {
      version: "course-operations.v2" as const,
      course_id: dashboard.course.id,
      generated_at: new Date().toISOString(),
      projects: [
        { project_id: "z", status: "active" as const, stage_key: "z", stage_name: "Z", member_names: [], failed_runs: 5, open_appeals: 0, design_status: "submitted" as const },
        { project_id: "a", status: "active" as const, stage_key: "a", stage_name: "A", member_names: [], failed_runs: 0, open_appeals: 1, design_status: "review" as const },
      ],
    };
    expect(getTeacherQueue(operations).map((item) => item.project_id)).toEqual(["a", "z"]);
  });
});
