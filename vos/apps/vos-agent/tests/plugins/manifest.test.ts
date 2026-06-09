import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadPluginManifests, pluginMcpServers } from "../../app/plugins/manifest.ts";
import { makeTmpDir, removeTmpDir, writeFixture } from "../helpers/tmp.ts";

describe("plugin manifests", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpDir("stars-plugins-");
  });

  afterEach(() => {
    removeTmpDir(tmp);
  });

  test("returns no manifests when the plugin directory is missing", () => {
    expect(loadPluginManifests({ workspaceRoot: tmp })).toEqual([]);
  });

  test("loads MCP stdio server configuration from .agents/plugins", () => {
    writeFixture(tmp, ".agents/plugins/fake.json", JSON.stringify({
      name: "fake",
      mcpServers: {
        echo: {
          command: " bun ",
          args: ["server.js", "  literal spaces  ", ""],
          env: { FAKE_ENV: "1", EMPTY_ENV: "", PADDED_ENV: " x " },
        },
      },
    }));

    expect(loadPluginManifests({ workspaceRoot: tmp })).toEqual([{
      name: "fake",
      path: expect.stringContaining(".agents/plugins/fake.json"),
      mcpServers: [{
        name: "echo",
        command: "bun",
        args: ["server.js", "  literal spaces  ", ""],
        env: { FAKE_ENV: "1", EMPTY_ENV: "", PADDED_ENV: " x " },
        cwd: tmp,
      }],
    }]);
  });

  test("rejects duplicate MCP server names across plugin manifests", () => {
    writeFixture(tmp, ".agents/plugins/a.json", JSON.stringify({
      name: "a",
      mcpServers: { echo: { command: "bun" } },
    }));
    writeFixture(tmp, ".agents/plugins/b.json", JSON.stringify({
      name: "b",
      mcpServers: { Echo: { command: "bun" } },
    }));

    expect(() => pluginMcpServers(loadPluginManifests({ workspaceRoot: tmp }))).toThrow(
      /duplicate MCP server name "Echo"/,
    );
  });

  test("rejects invalid manifest shape clearly", () => {
    writeFixture(tmp, ".agents/plugins/bad.json", JSON.stringify({
      name: "bad",
      mcpServers: { echo: { args: ["server.js"] } },
    }));

    expect(() => loadPluginManifests({ workspaceRoot: tmp })).toThrow(
      /mcpServers.echo.command must be a non-empty string/,
    );
  });
});
