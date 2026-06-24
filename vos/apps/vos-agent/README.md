# VOS Agent

VOS Agent is the TypeScript LLM runner, Agent Gateway, and Portal backend
for VeriSpecOSLab. It can run interactively (`vos-agent`) or headlessly
(`vos-agent -p "..."`), persists local threads, injects `AGENTS.md`
guidance, tracks todos, and routes each model request to Anthropic's
Messages API or an OpenAI-compatible endpoint. In server mode it also
serves the VOS portal REST API consumed by frontend clients and local tools.

In the course-runtime architecture, `vos-agent` is also the implementation
surface behind `vos agent <subcommand>` wrappers. The CLI/runtime builds a
`ContextBundle` and `PromptEnvelope`, selects a versioned fixed prompt,
calls this runner, validates the structured output, then writes evidence
and `AICollaborationLog` records. Policy, patch application, stage gates,
and validation DAGs remain deterministic `vos` runtime responsibilities,
not prompt-only behavior.

The codebase is intentionally small and agent-friendly: the LLM clients,
router, session layer, agent loop, and tools are split behind narrow
interfaces with deterministic tests and no network calls in the suite.

## Requirements

- [Bun](https://bun.sh) **1.3** or newer.
- An API key or token for at least one provider:
  - Anthropic native Messages API, or
  - any OpenAI-compatible service (OpenAI, OpenRouter, vLLM, Ollama, …).

## Install

```sh
cd vos/apps/vos-agent
bun install
```

For local CLI use:

```sh
bun link
vos-agent --help
```

Build the release binary:

```sh
bun run build
./dist/vos-agent --help
```

The compiled artifact is intentionally named only `vos-agent` and is ignored
by git under `dist/`.

## Configure

| Variable                 | Required | Default            | Notes                                        |
| ------------------------ | -------- | ------------------ | -------------------------------------------- |
| `ANTHROPIC_API_KEY`      | one of   | —                  | Enables Anthropic API-key auth.              |
| `ANTHROPIC_AUTH_TOKEN`   | one of   | —                  | Enables Anthropic Bearer-token gateway auth. |
| `OPENAI_API_KEY`         | one of   | —                  | Enables the OpenAI-compatible provider.      |
| `ANTHROPIC_BASE_URL`     | no       | Anthropic's URL    | For proxies / self-hosted gateways.          |
| `OPENAI_BASE_URL`        | no       | OpenAI's URL       | For OpenRouter, vLLM, Ollama, …              |
| `SMART_MODEL`            | no       | `opus4.7`          | Model bound to `smart` mode.                 |
| `DEEP_MODEL`             | no       | `gpt5.5`           | Model bound to `deep` mode.                  |
| `RUSH_MODEL`             | no       | `sonnet4.6`        | Model bound to `rush` mode.                  |
| `SMART_REASONING_EFFORT` | no       | —                  | Mode-level reasoning hint; no CLI/TUI flag.  |
| `DEEP_REASONING_EFFORT`  | no       | —                  | Mode-level reasoning hint; no CLI/TUI flag.  |
| `RUSH_REASONING_EFFORT`  | no       | `medium`           | Mode-level reasoning hint for `rush`.        |
| `VOS_AGENT_HOME`         | no       | `~/.vos-agent`     | Local thread/todo storage directory.         |

## Modes and routing

| Mode    | Default model | Reasoning effort | Provider selected by model name |
| ------- | ------------- | ---------------- | -------------------------------- |
| `smart` | `opus4.7`     | —                | Anthropic                        |
| `deep`  | `gpt5.5`      | —                | OpenAI-compatible                |
| `rush`  | `sonnet4.6`   | `medium`         | Anthropic                        |

Use `-m`/`--mode` to select a mode, or `--model <id>` to pin a raw
model identifier. Reasoning effort is selected only by mode/config, not
by any CLI or TUI flag; accepted values are `none`, `minimal`, `low`,
`medium`, `high`, and `xhigh`. Routing prefixes are supported:
`anthropic:gpt-5.5` forces Anthropic-compatible routing and
`openai:gpt-4o-mini` forces OpenAI-compatible routing; the prefix is
stripped before the request is sent.

## Run

Interactive mode:

```sh
vos-agent
```

On a real TTY, interactive mode opens an alternate-screen TUI with an
Amp-style welcome view, including a short galloping-horse startup
animation, a scrollback transcript, and a slightly taller bordered
prompt box pinned to the bottom of the terminal. Long transcript and
prompt lines wrap to fit the current terminal width instead of
disappearing off screen. Submitted user prompts are marked with a slim
green left rail and green italic text, while assistant output uses the terminal's
default foreground without repeated role labels. Typing `/` opens an
Amp-style command palette above the prompt; use the arrow keys to move
the highlight and Enter to activate the selected entry. Use PageUp /
PageDown or Ctrl-Up / Ctrl-Down to page through transcript history;
the mouse wheel also scrolls history when your terminal/tmux forwards
mouse events (`set -g mouse on` inside tmux). UTF-8 prompt and
transcript text, including Chinese wide characters, is rendered with
terminal-cell-aware wrapping. Routine thread/model/tool metadata stays
out of the transcript, while live mode/tool/cwd state stays in the
prompt border. Smart/deep mode labels use distinct colors. Press Ctrl-C
once to clear/arm exit; press Ctrl-C again to leave the TUI.
Piped input and non-TTY output continue to use the line-mode fallback.

Headless execute mode:

```sh
vos-agent -p "List the .ts files in app/ and describe each one."
vos-agent -m deep -p "Trace this bug across the codebase."
vos-agent --model anthropic:gpt-5.5 -p "Use the Anthropic-compatible gateway."
echo "Summarize README.md" | vos-agent
```

Thread and automation helpers:

```sh
vos-agent --thread VOS-... -p "continue from here"
vos-agent threads list
vos-agent -p "make the tests pass" --stream-json
```

## Used by `vos agent` wrapper

The `vos` CLI currently calls `vos-agent` as a controlled runner rather
than exposing the model to the whole workspace. The wrapper flow is:

```text
vos agent <subcommand>
  -> construct ContextBundle and PromptEnvelope
  -> choose fixed prompt id/version
  -> call vos-agent headless runner
  -> validate structured output
  -> write .vos/runs/<run-id>/ and AICollaborationLog
```

Command responsibilities:

- `vos agent context` and `vos agent log` are deterministic and should not
  call the model.
- `vos agent plan`, `vos agent generate`, and `vos agent debug` use
  versioned fixed prompts and schema-checked outputs.
- `vos agent generate` returns a patch proposal by default; it does not
  apply files directly.
- `vos agent apply-patch` is gated by policy, spec binding, allowed paths,
  impact analysis, and the minimum validation DAG.

Course mode must not expose free `Bash`, `Write`, or `Edit` tools to the
model. Hidden tests, staff-only rubrics, and other students' code must not
enter the `ContextBundle`.
When `vos-cli` calls `vos-agent/headless` for `agent plan`, `agent generate`,
or `agent debug`, it enables `courseMode` and passes `.vos/policy.yaml`
`allowed_commands` as the `Vos` tool whitelist.

Interactive slash commands:

```text
/help           show commands
/new            start a new local thread
/thread         show current thread id
/thread <id>    switch to a saved thread
/mode           show current mode
/mode <name>    switch mode (smart, deep, rush)
/todos          show current thread todos
/quit           exit
```

## Built-in tools

VOS Agent currently ships these tool-call surfaces for general development
mode:

- `Read` — read UTF-8 files under the workspace root, with truncation.
- `Write` — create or overwrite files under the workspace root.
- `Edit` — exact, surgical string replacement with ambiguity checks.
- `Glob` — deterministic file matching as JSON.
- `Grep` — deterministic content search as JSON.
- `Bash` — shell commands in the workspace root with timeout/output caps.
- `TodoRead` / `TodoWrite` — thread-scoped work tracking in session runs.
- `Task` — focused nested subagents for delegated investigation/work.

All expected tool failures are returned as strings so the model can
repair its next step instead of crashing the loop.

Course-runtime mode should expose a narrower registry: read-only context
tools plus a policy-checked `Vos` tool. File writes and shell execution
must go through `vos agent apply-patch` and runtime validation, not direct
model tool calls.

## Layout

```text
app/
  main.ts                  vos-agent CLI entrypoint
  cli.ts                   argv parsing
  config.ts                env → Config (modes + providers)
  session/                 local threads + turn orchestration
  context/                 AGENTS.md guidance discovery
  terminal/                slash commands + interactive loop
  tui/                     alternate-screen renderer + raw prompt input
  output/                  stream-json formatting
  agent/loop.ts            pure model/tool loop
  llm/                     OpenAI, Anthropic, router, translation
  tools/                   Read/Write/Edit/Glob/Grep/Bash/Todo/Task tools
tests/                     deterministic Bun suite
docs/                      formal documentation
```

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture overview](docs/architecture.md)
- [The agent loop](docs/agent-loop.md)
- [Tools and the registry](docs/tools.md)
- [Configuration](docs/configuration.md)
- [Testing](docs/testing.md)
- [TypeScript CLI wrapper design](../../../docs/design/agent/10-typescript-cli-wrapper.md)

## Verification

```sh
bun test
bunx tsc --noEmit
```

The suite uses scripted `ChatClient`s and temporary workspaces, so it is
fast, deterministic, and safe to run without real LLM credentials.

## License

MIT.
