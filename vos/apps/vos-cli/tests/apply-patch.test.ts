import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPatchText } from "../app/agent/apply-patch.ts";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("agent apply-patch spec gate", () => {
  test("accepts structured spec bindings from agent generate output", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(
      join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "kernel_main.yaml"),
      "id: kernel/boot.kernel_main\n",
    );

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["spec/modules/kernel/boot/ops/kernel_main.yaml"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 1");
  });

  test("rejects malformed model patches instead of repairing them", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "kernel_main.yaml"), [
      "id: kernel/boot.kernel_main",
      "module: kernel/boot",
      "operation: kernel_main",
      "llm_codegen:",
      "  editable_region:",
      "    file: kernel/boot.c",
      "",
    ].join("\n"));

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -0,0 +1,1 @@",
        "-int missing_context(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["spec/modules/kernel/boot/ops/kernel_main.yaml"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("patch_apply_failed");
  });

  test("accepts complete patches with inaccurate hunk counts via git recount", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(
      join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "kernel_main.yaml"),
      "id: kernel/boot.kernel_main\n",
    );

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/kernel/boot.c",
        "@@ -0,0 +1,1 @@",
        "+int boot(void) {",
        "+  return 1;",
        "+}",
        "",
      ].join("\n"),
      specBindings: ["spec/modules/kernel/boot/ops/kernel_main.yaml"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 1");
  });

  test("accepts operation id bindings resolved from normalized spec cache", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "operations.json"), JSON.stringify([{
      id: "kernel/boot.kernel_main",
      module: "kernel/boot",
      operation: "kernel_main",
      llm_codegen: {
        editable_region: {
          file: "kernel/boot.c",
        },
      },
    }]));

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["kernel/boot.kernel_main"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 1");
  });

  test("accepts operation id bindings resolved from spec yaml", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "kernel_main.yaml"), [
      "id: kernel/boot.kernel_main",
      "module: kernel/boot",
      "operation: kernel_main",
      "llm_codegen:",
      "  editable_region:",
      "    file: kernel/boot.c",
      "",
    ].join("\n"));

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["kernel/boot.kernel_main"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("ok");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 1");
  });

  test("rejects unbound patches when requireSpec is enabled", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("policy_violation");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 0");
  });

  test("rejects unknown operation id bindings", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "operations.json"), JSON.stringify([{
      id: "kernel/boot.kernel_main",
      module: "kernel/boot",
      operation: "kernel_main",
    }]));

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["kernel/boot.unknown"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("policy_violation");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 0");
  });

  test("rejects operation bindings whose editable file does not match the patch", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, ".vos", "cache", "normalized"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(join(projectRoot, ".vos", "cache", "normalized", "operations.json"), JSON.stringify([{
      id: "kernel/boot.kernel_main",
      module: "kernel/boot",
      operation: "kernel_main",
      llm_codegen: {
        editable_region: {
          file: "kernel/other.c",
        },
      },
    }]));

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["kernel/boot.kernel_main"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: false,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("policy_violation");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 0");
  });

  test("rolls back an applied patch when validation fails", async () => {
    const projectRoot = makeProject();
    mkdirSync(join(projectRoot, "kernel"), { recursive: true });
    mkdirSync(join(projectRoot, "spec", "modules", "kernel", "boot", "ops"), { recursive: true });
    writeFileSync(join(projectRoot, "kernel", "boot.c"), "int boot(void) { return 0; }\n");
    writeFileSync(
      join(projectRoot, "spec", "modules", "kernel", "boot", "ops", "kernel_main.yaml"),
      "id: kernel/boot.kernel_main\n",
    );

    const result = await applyPatchText({
      projectRoot,
      patchText: [
        "diff --git a/kernel/boot.c b/kernel/boot.c",
        "--- a/kernel/boot.c",
        "+++ b/kernel/boot.c",
        "@@ -1 +1 @@",
        "-int boot(void) { return 0; }",
        "+int boot(void) { return 1; }",
        "",
      ].join("\n"),
      specBindings: ["spec/modules/kernel/boot/ops/kernel_main.yaml"],
      allowedPaths: ["kernel/boot.c"],
      requireSpec: true,
      runValidation: true,
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("validation_failed");
    expect(result.output).toContain("rolled back applied patch");
    expect(readFileSync(join(projectRoot, "kernel", "boot.c"), "utf8")).toContain("return 0");
  });
});

function makeProject(): string {
  const root = join("/tmp", `vos-cli-apply-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  return root;
}
