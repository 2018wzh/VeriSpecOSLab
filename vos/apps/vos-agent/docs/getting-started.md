# Getting started

This guide takes you from a clean checkout to a working Stars agent that
you have extended with a custom tool.

## 1. Prerequisites

- [Bun](https://bun.sh) 1.3 or newer.
- An API key for an OpenAI-compatible service. See
  [Configuration](configuration.md) for the list of supported
  providers; OpenAI and OpenRouter are the most common.

Verify Bun is installed:

```sh
$ bun --version
1.3.0
```

## 2. Install

```sh
$ git clone <repository-url> stars
$ cd stars
$ bun install
```

For local development, `bun link` exposes the `stars` bin from
[app/main.ts](../app/main.ts). For release builds, compile a standalone
binary:

```sh
$ bun run build
$ ./dist/stars --help
```

## 3. Configure

The agent talks to both Anthropic's native Messages API and any
OpenAI-compatible endpoint. Configure at least one:

```sh
# Anthropic — powers the default 'smart' mode (opus4.7) and 'rush' mode:
$ export ANTHROPIC_API_KEY=sk-ant-...

# OpenAI-compatible — powers the 'deep' mode (gpt5.5):
$ export OPENAI_API_KEY=sk-...

# or both, to use smart and deep in different runs / mix models:
$ export ANTHROPIC_API_KEY=sk-ant-...
$ export OPENAI_API_KEY=sk-...
```

The agent exposes Amp-style modes:

| Mode    | Default model | Provider          | Reasoning effort |
| ------- | ------------- | ----------------- | ---------------- |
| `smart` | `opus4.7`     | Anthropic         | —                |
| `deep`  | `gpt5.5`      | OpenAI-compatible | —                |
| `rush`  | `sonnet4.6`   | Anthropic         | `medium`         |

Override defaults with `SMART_MODEL`, `DEEP_MODEL`, and `RUSH_MODEL`.
Reasoning effort is mode/config-driven (for example,
`DEEP_REASONING_EFFORT=high`) and cannot be changed from the CLI or
interactive TUI. Existing Anthropic-compatible gateway setups that set
`ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` are
also understood as fallbacks for `smart` / `rush`. The full
configuration surface, including
Anthropic-compatible bearer gateways, OpenRouter, vLLM, Ollama, user or
workspace settings, and disabling tools such as `Bash`, is documented in
[Configuration](configuration.md).

## 4. Run a prompt

Smart mode (the default):

```sh
$ stars -p "List the .ts files in app/ and describe each one in one sentence."
```

Deep mode, for reasoning-heavy work:

```sh
$ stars -m deep -p "Trace why this test is flaky across the loop and tools."
```

Pin an explicit model identifier:

```sh
$ stars --model claude-opus-4-5 -p "..."
```

No arguments starts the interactive loop:

```sh
$ stars
```

When stdin and stdout are real TTYs, Stars enters an alternate-screen
TUI. It shows an Amp-style welcome area with a short galloping-horse
startup animation, a scrollback transcript, and a slightly taller
bordered prompt box pinned to the bottom of the terminal. The prompt
border shows live mode/tool state and the current cwd; long transcript
and prompt lines wrap to fit the pane. Submitted user prompts use a
slim green left rail plus green italic text so they stand apart from
assistant/tool output, and assistant text uses the terminal's default
foreground without repeated role labels. Typing `/` opens a command
palette with filtered slash-command choices. Use the arrow keys to move
the highlight and Enter to activate the selected command; entries that
need arguments fill the command prefix without submitting. Use PageUp /
PageDown or Ctrl-Up / Ctrl-Down to page through transcript history; the
mouse wheel also scrolls history when your terminal/tmux forwards mouse
events (`set -g mouse on` inside tmux). UTF-8 text,
including Chinese wide characters, is accepted in the prompt and
rendered with terminal-cell-aware wrapping in the prompt and transcript.
Routine thread/model/tool metadata is not added as transcript rows; live
state stays in the prompt border, with distinct colors for smart/deep
mode labels. Press Ctrl-C once to clear the current draft and arm exit,
then Ctrl-C again to leave the TUI. Ctrl-D on an empty prompt also exits.

Piped input or non-TTY output uses the line-oriented fallback. In that
fallback each turn reports the active thread, mode/model, cwd, and
available tools; tool calls show as they start and finish, followed by
the final assistant response. For example:

```text
╭─ Stars turn ─────────────────────────────────
│ thread: T-abc123 (new)
│ mode: smart
│ model: opus4.7
│ cwd: /path/to/project
│ tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch, TodoRead, TodoWrite, Task
╰─ running
tool call: Bash (call_1)
args: {"command":"bun test"}
active tools: Bash
tool done: Bash (call_1)
result: 198 pass, 0 fail
The tests pass.
```

Use the live `/` command palette or submit `/help` for slash commands.
`/mode <name>` switches modes unless a raw `--model` was pinned at
startup; raw model pins intentionally bypass mode selection.

Projects can add simple custom slash commands in
`.agents/commands/*.md`. The filename becomes the command name and
`$ARGUMENTS` is replaced by the text after the slash command:

```sh
$ mkdir -p .agents/commands
$ cat > .agents/commands/review.md <<'EOF'
Review the following target and return risks plus suggested fixes:

$ARGUMENTS
EOF
$ stars
/review app/main.ts
```

If a template does not contain `$ARGUMENTS`, Stars appends the arguments
after a blank line. Command filenames must look like `review.md` or
`fix-tests.md` (`^[A-Za-z][A-Za-z0-9_-]*$`) and cannot shadow built-in
commands such as `/help`, `/mode`, or `/thread`.

Projects can also add first-cut plugin manifests in
`.agents/plugins/*.json`. Today plugin manifests contribute local stdio
MCP servers; each MCP tool becomes a normal Stars tool named
`mcp__<server>__<tool>`.

For example, if `mcp_gdb` is installed on your `PATH`:

```sh
$ mkdir -p .agents/plugins
$ cat > .agents/plugins/gdb.json <<'EOF'
{
  "name": "debugger",
  "mcpServers": {
    "gdb": {
      "command": "mcp_gdb",
      "args": []
    }
  }
}
EOF
$ stars -p "Use the gdb MCP tools to inspect this executable."
```

The session/TUI metadata will include MCP server names and the advertised
tool list will include names such as `mcp__gdb__gdb_command`. See
[Configuration](configuration.md#project-plugin-manifests-and-mcp-servers)
for the manifest schema and disabled-tool policy.

The agent will:

1. Send your prompt to the model along with the schemas of `Read`,
   `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`,
   todo tools, and `Task` subagents, plus any plugin-provided MCP tools.
2. Execute any tool calls the model requests (e.g. `Bash("ls app")` or
   `Read("app/main.ts")`).
3. Loop until the model produces a reply with no tool calls.
4. Print that final reply to `stdout`. Diagnostic errors, if any, go
   to `stderr` with exit code 1.

## 5. Run the tests

```sh
$ bun test
```

You should see the full deterministic suite pass in under a second. The test
suite never makes network calls; the agent loop is exercised through
stub `ChatClient`s. See [Testing](testing.md) for details.

## 6. Write a custom tool

Tools are plain values implementing the `Tool` interface from
[app/tools/types.ts](../app/tools/types.ts). They consist of:

- a `name` (also the function name advertised to the model);
- a JSON Schema describing the arguments;
- an `execute(argumentsJson)` function that returns a string.

The example below adds a `Now` tool that returns the current ISO
timestamp.

Create [app/tools/now.ts](../app/tools/now.ts):

```ts
import type { Tool } from "./types.ts";

export const nowTool: Tool = {
  name: "Now",
  schema: {
    type: "function",
    function: {
      name: "Now",
      description: "Return the current time in ISO-8601 format (UTC).",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  execute(): string {
    return new Date().toISOString();
  },
};
```

Register it in [app/tools/builtin.ts](../app/tools/builtin.ts):

```ts
import { nowTool } from "./now.ts";
// ...
export function createBuiltinToolRegistry(): ToolRegistry {
  return new ToolRegistry([readTool, writeTool, bashTool, nowTool]);
}
```

Add a unit test at `tests/tools/now.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { nowTool } from "../../app/tools/now.ts";

describe("nowTool", () => {
  test("returns a valid ISO-8601 timestamp", async () => {
    const result = await nowTool.execute("{}");
    expect(() => new Date(result).toISOString()).not.toThrow();
  });
});
```

Run the suite and the typechecker:

```sh
$ bun test
$ bunx tsc --noEmit
```

Both should pass. Your tool is now available to every subsequent
agent run.

## Next steps

- Read [Architecture](architecture.md) to understand the module
  boundaries before making larger changes.
- Read [The agent loop](agent-loop.md) for the loop's exact contract
  with the LLM, including failure modes.
- Read [Tools and the registry](tools.md) for the full tool contract,
  including the rules around error handling and idempotency.
