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
| `OPENAI_API_KEY`         | one of   | —                  | Enables official OpenAI when `OPENAI_BASE_URL` is unset. |
| `OPENAI_COMPATIBLE_API_KEY` | one of | —               | Enables the generic OpenAI-compatible provider. |
| `ANTHROPIC_BASE_URL`     | no       | Anthropic's URL    | For proxies / self-hosted gateways.          |
| `OPENAI_BASE_URL`        | no       | —                  | Legacy OpenAI-compatible endpoint override.  |
| `OPENAI_COMPATIBLE_BASE_URL` | no    | —                  | OpenRouter, vLLM, local gateways.            |
| `OLLAMA_ENABLED`         | one of   | —                  | Enables native local Ollama.                 |
| `OLLAMA_BASE_URL`        | no       | `http://localhost:11434/api` | Native Ollama API base URL.        |
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
| `deep`  | `gpt5.5`      | —                | OpenAI                           |
| `rush`  | `sonnet4.6`   | `medium`         | Anthropic                        |

Use `-m`/`--mode` to select a mode, or `--model <id>` to pin a raw
model identifier. Reasoning effort is selected only by mode/config, not
by any CLI or TUI flag; accepted values are `none`, `minimal`, `low`,
`medium`, `high`, and `xhigh`. Routing prefixes are supported:
`anthropic:gpt-5.5` forces Anthropic-compatible routing,
`openai:gpt-4o-mini` forces official OpenAI routing, and
`compat:llama` forces generic OpenAI-compatible routing. `ollama:qwen2.5-coder`
uses Ollama's native API. Colon prefixes are stripped before the request is sent.

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

- `vos agent ask` discusses concepts and trade-offs without changing project
  files.
- `vos agent review` runs deterministic lint first and then returns
  schema-checked Spec findings without changing the project.
- `vos agent debug` and `vos agent verify` are read-only diagnostic roles.
- `vos agent implement <module>` is the only student code-generation entry.
  It writes in a detached worktree, submits a structured implementation and
  test-target result, and lands only after deterministic ownership and gate
  checks pass.

All student profiles may use `Bash` for evidence collection. Read-only roles
must not change project files; VOS checks the Git tree before and after each
run. The implementation profile may also use `Write` and `Edit`, but only in
its disposable worktree. These prompt and Git checks are not a host security
boundary: commands inherit the current user, network, credentials, and access
to files outside the repository. Hidden tests, staff-only rubrics, and other
students' code must not enter the projected task context.

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

Course-runtime mode selects tools from the fixed task profile. Read-only
profiles retain `Bash` but are checked for project-tree changes. Implementation
runs receive write tools only inside a detached worktree; their structured
result is still subject to deterministic schema, owns, HEAD, build, and test
validation before VOS creates the final commit.

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
