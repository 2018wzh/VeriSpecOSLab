import { describe, expect, test } from "bun:test";
import { parseEnrollmentCsv } from "../domain/enrollment-csv.ts";

describe("enrollment CSV", () => {
  test("uses RFC-compatible parsing for quoted names and groups", () => {
    const result = parseEnrollmentCsv("username,display_name,role,group\nstudent-1,\"Li, Ming\",student,Group A\n");
    expect(result.issues).toEqual([]);
    expect(result.rows[0]).toMatchObject({ username: "student-1", display_name: "Li, Ming", role: "student", group: "Group A" });
  });

  test("reports duplicate users and invalid staff grouping", () => {
    const result = parseEnrollmentCsv("username,display_name,role,group\nuser,User,teacher,Group A\nUSER,Other,student,\n");
    expect(result.issues.map(issue => issue.message)).toContain("group 仅允许学生使用且不能超过 100 字符");
    expect(result.issues.map(issue => issue.message)).toContain("username 在 CSV 中重复");
  });
});
