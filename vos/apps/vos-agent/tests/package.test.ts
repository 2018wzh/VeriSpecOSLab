import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../package.json";
import {
  runHeadlessAgentPrompt,
  startAgentHttpServer,
} from "vos-agent/headless";

const tmpRoots: string[] = [];
const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(testDir);
const workspaceRoot = dirname(dirname(packageRoot));

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("package metadata", () => {
  test("brands the package as vos-agent", () => {
    expect(packageJson.name).toBe("vos-agent");
  });

  test("exposes only the vos-agent binary", () => {
    expect(packageJson.bin).toEqual({ "vos-agent": "./app/main.ts" });
  });

  test("exposes headless package APIs for vos-cli package integration", () => {
    expect(packageJson.exports).toMatchObject({
      ".": "./app/main.ts",
      "./headless": "./app/headless.ts",
    });
    expect(typeof runHeadlessAgentPrompt).toBe("function");
    expect(typeof startAgentHttpServer).toBe("function");
  });

  test("starts package HTTP server with explicit host and ephemeral port", () => {
    const projectRoot = makeProject();
    const result = startAgentHttpServer({
      projectRoot,
      host: "127.0.0.1",
      port: 0,
      env: {
        OPENAI_API_KEY: "test-key",
        SMART_MODEL: "openai:gpt-test",
      },
    });

    try {
      expect(result.host).toBe("127.0.0.1");
      expect(result.port).toBeGreaterThan(0);
      expect(result.url).toBe(`http://127.0.0.1:${result.port}`);
    } finally {
      result.server.stop(true);
    }
  });

  test("uses env host fallback and defaults for package HTTP server", () => {
    const projectRoot = makeProject();
    const result = startAgentHttpServer({
      projectRoot,
      port: 0,
      env: {
        OPENAI_API_KEY: "test-key",
        SMART_MODEL: "openai:gpt-test",
        VOS_AGENT_HOST: "127.0.0.1",
      },
    });

    try {
      expect(result.host).toBe("127.0.0.1");
      expect(result.port).toBeGreaterThan(0);
      expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      result.server.stop(true);
    }
  });

  test("build script emits a single vos-agent release binary", () => {
    expect(packageJson.scripts.build).toBe(
      "bun build --compile ./app/main.ts --outfile dist/vos-agent",
    );
  });

  test("vos-agent binary entry has a Bun shebang and executable bit", () => {
    const entry = join(packageRoot, "app", "main.ts");
    expect(readFileSync(entry, "utf8").startsWith("#!/usr/bin/env bun")).toBe(true);
    expect(statSync(entry).mode & 0o111).not.toBe(0);
  });

  test("root bun workspace lockfile includes vos-agent", () => {
    const lockfile = readFileSync(join(workspaceRoot, "bun.lock"), "utf8");
    expect(lockfile).toContain('"apps/vos-agent"');
    expect(lockfile).toContain('"name": "vos-agent"');
  });
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-agent-package-"));
  tmpRoots.push(root);
  return root;
}
