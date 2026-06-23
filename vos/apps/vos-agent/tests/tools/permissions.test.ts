import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createBuiltinToolRegistry } from "../../app/tools/builtin.ts";
import {
  createPermissionPolicy,
  defaultGuardedFilePatterns,
} from "../../app/tools/permissions.ts";
import { makeTmpDir, removeTmpDir } from "../helpers/tmp.ts";

describe("createPermissionPolicy", () => {
  test("evaluates ordered allow/reject file rules with glob matching", async () => {
    const policy = createPermissionPolicy({
      rules: [
        {
          action: "allow",
          tool: "Write",
          target: "path",
          match: "glob",
          pattern: ".env.local",
        },
        {
          action: "reject",
          tool: "Write",
          target: "path",
          match: "glob",
          pattern: ".env*",
          reason: "secret-bearing files need review",
        },
      ],
    });

    await expect(policy.canExecute?.({
      name: "Write",
      argumentsJson: JSON.stringify({ file_path: ".env.local", content: "ok" }),
    })).resolves.toEqual({ allowed: true });

    await expect(policy.canExecute?.({
      name: "Write",
      argumentsJson: JSON.stringify({ file_path: ".env.production", content: "x" }),
    })).resolves.toEqual({
      allowed: false,
      reason: "secret-bearing files need review",
    });
  });

  test("matches command rules with regex patterns", async () => {
    const policy = createPermissionPolicy({
      rules: [
        {
          action: "reject",
          tool: "Vos",
          target: "command",
          match: "regex",
          pattern: "(^|[;&|])\\s*sudo\\b",
          reason: "sudo is not allowed",
        },
      ],
    });

    await expect(policy.canExecute?.({
      name: "Vos",
      argumentsJson: JSON.stringify({ command: "agent test && sudo id" }),
    })).resolves.toEqual({ allowed: false, reason: "sudo is not allowed" });

    await expect(policy.canExecute?.({
      name: "Vos",
      argumentsJson: JSON.stringify({ command: "agent test" }),
    })).resolves.toEqual({ allowed: true });
  });

  test("ask rules require an approver and honor the approver decision", async () => {
    const request = {
      name: "Edit",
      argumentsJson: JSON.stringify({
        file_path: "certs/key.pem",
        old_str: "old",
        new_str: "new",
      }),
    };

    const noApprover = createPermissionPolicy({
      rules: [{ action: "ask", tool: "Edit", target: "path", pattern: "**/*.pem" }],
    });
    await expect(noApprover.canExecute?.(request)).resolves.toEqual({
      allowed: false,
      reason: "requires approval for Edit on certs/key.pem",
    });

    const approved = createPermissionPolicy({
      rules: [{ action: "ask", tool: "Edit", target: "path", pattern: "**/*.pem" }],
      approve: async ({ toolName, targetValue }) =>
        toolName === "Edit" && targetValue === "certs/key.pem",
    });
    await expect(approved.canExecute?.(request)).resolves.toEqual({ allowed: true });
  });

  test("malformed arguments defer to the tool's own validation", async () => {
    const policy = createPermissionPolicy({
      rules: [{ action: "reject", tool: "Write", target: "path", pattern: "**" }],
    });

    await expect(policy.canExecute?.({
      name: "Write",
      argumentsJson: "not json",
    })).resolves.toEqual({ allowed: true });
  });

  test("does not treat search regex patterns as file paths", async () => {
    const policy = createPermissionPolicy({
      rules: [{ action: "reject", tool: "Grep", target: "path", pattern: ".env*" }],
    });

    await expect(policy.canExecute?.({
      name: "Grep",
      argumentsJson: JSON.stringify({ pattern: ".env.*" }),
    })).resolves.toEqual({ allowed: true });
  });
});

describe("built-in guarded permissions", () => {
  test("default guarded file patterns protect secret files before Write executes", async () => {
    const tmp = makeTmpDir("vos-permissions-");
    try {
      expect(defaultGuardedFilePatterns).toContain(".env*");
      const registry = createBuiltinToolRegistry({ rootDir: tmp });

      const result = await registry.execute("Write", JSON.stringify({
        file_path: ".env",
        content: "TOKEN=secret\n",
      }));

      expect(result).toContain('Tool "Write" denied by policy');
      expect(result).toContain("requires approval for Write on .env");
      expect(existsSync(join(tmp, ".env"))).toBe(false);
    } finally {
      removeTmpDir(tmp);
    }
  });

  test("path rules normalize traversal before Write executes", async () => {
    const tmp = makeTmpDir("vos-permissions-");
    try {
      const registry = createBuiltinToolRegistry({
        rootDir: tmp,
        permissionRules: [{
          action: "ask",
          tool: "Write",
          target: "path",
          pattern: "secrets/*",
        }],
      });

      const result = await registry.execute("Write", JSON.stringify({
        file_path: "secrets/../secrets/token.txt",
        content: "TOKEN=secret\n",
      }));

      expect(result).toContain('Tool "Write" denied by policy');
      expect(result).toContain("requires approval for Write on secrets/token.txt");
      expect(existsSync(join(tmp, "secrets/token.txt"))).toBe(false);
    } finally {
      removeTmpDir(tmp);
    }
  });

  test("explicit allow rules can approve a guarded file", async () => {
    const tmp = makeTmpDir("vos-permissions-");
    try {
      const registry = createBuiltinToolRegistry({
        rootDir: tmp,
        permissionRules: [{
          action: "allow",
          tool: "Write",
          target: "path",
          pattern: ".env.local",
        }],
      });

      const result = await registry.execute("Write", JSON.stringify({
        file_path: ".env.local",
        content: "TOKEN=local\n",
      }));

      expect(result).toBe("OK");
      expect(existsSync(join(tmp, ".env.local"))).toBe(true);
    } finally {
      removeTmpDir(tmp);
    }
  });
});
