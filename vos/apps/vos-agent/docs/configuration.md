# Configuration

Runtime configuration is assembled by
[app/settings.ts](../app/settings.ts) and [app/config.ts](../app/config.ts),
then consumed by [app/llm/providers.ts](../app/llm/providers.ts), which
constructs a routed `ChatClient`. Neither the agent loop nor any tool
reads environment variables.

## The `Config` object

```ts
export interface ModeDefinition {
  model: string;
  reasoningEffort?:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh";
}

export interface Config {
  defaultMode: string;                          // "smart" by default
  modes: Record<string, ModeDefinition>;        // { smart, deep, ... }
  tools: { disabled: string[] };                // settings-driven policy
  openai?:    { apiKey: string; baseURL?: string; maxRetries?: number };
  anthropic?: {
    apiKey?: string;
    authToken?: string;
    baseURL?: string;
    maxRetries?: number;
  };
}
```

Each provider section is independent — the presence of a section
enables that provider. **Modes** are named presets that resolve to a
model identifier; the default mode is used when the caller does not
override it. `tools.disabled` is populated from settings files and is
used by the session layer to hide and deny tools such as `Bash`.

## Modes

Modes are how Stars expresses model preference at a higher level than a
raw identifier. The pattern mirrors Amp-style `smart` / `deep` / `rush`
selection: a capable default, a reasoning-heavy mode, and a fast urgent
mode.

Built-in modes:

| Mode    | Default model | Provider          | Reasoning effort | Notes                         |
| ------- | ------------- | ----------------- | ---------------- | ----------------------------- |
| `smart` | `opus4.7`     | Anthropic         | —                | Default. Most work.           |
| `deep`  | `gpt5.5`      | OpenAI-compatible | —                | Reasoning-heavy work.         |
| `rush`  | `sonnet4.6`   | Anthropic         | `medium`         | Fast urgent-work preset.      |

Override the model bound to any built-in mode via env vars:

| Variable        | Effect                                              |
| --------------- | --------------------------------------------------- |
| `SMART_MODEL`   | Replaces the model used when mode is `smart`.       |
| `DEEP_MODEL`    | Replaces the model used when mode is `deep`.        |
| `RUSH_MODEL`    | Replaces the model used when mode is `rush`.        |

Reasoning effort is also mode-level configuration. It can be supplied
through env/programmatic config, but there is intentionally no CLI or
interactive TUI flag to mutate it per turn:

| Variable                 | Effect                                      |
| ------------------------ | ------------------------------------------- |
| `SMART_REASONING_EFFORT` | Reasoning hint for the `smart` mode.        |
| `DEEP_REASONING_EFFORT`  | Reasoning hint for the `deep` mode.         |
| `RUSH_REASONING_EFFORT`  | Reasoning hint for `rush` (default `medium`). |

Allowed values are `none`, `minimal`, `low`, `medium`, `high`, and
`xhigh`. A raw `--model <id>` override bypasses mode selection, so it
does not inherit a mode's reasoning effort.

## Settings files

Stars loads optional JSON settings from two locations:

| Location | Purpose |
| -------- | ------- |
| `$STARS_HOME/settings.json` | User defaults. `STARS_HOME` defaults to `~/.stars`. |
| `<workspace>/.stars/settings.json` | Workspace-local defaults and tool policy. |

Workspace settings are applied after user settings. Mode objects merge
field-by-field, so a workspace can override only a model while keeping a
user-specified reasoning effort. Disabled tool lists are unioned and
deduplicated.

Example workspace settings:

```json
{
  "defaultMode": "rush",
  "modes": {
    "smart": { "model": "anthropic:gpt-5.5" },
    "local": { "model": "openai:qwen2.5-coder" }
  },
  "tools": {
    "disabled": ["Bash"]
  }
}
```

Supported fields:

| Field | Meaning |
| ----- | ------- |
| `defaultMode` | Mode name used when neither `--model` nor `--mode` is passed. |
| `modes.<name>.model` | Model identifier for a built-in or custom mode. Custom modes require a model. |
| `modes.<name>.reasoningEffort` | Optional mode reasoning hint (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`). |
| `tools.disabled` | Tool names to hide from schemas and deny if still called. Names are matched case-insensitively. |

Tool denials are returned to the model as normal tool-result text, for
example `Tool "Bash" denied by policy: disabled by settings`; they do
not abort the agent loop.

## Project plugin manifests and MCP servers

Stars loads optional project plugin manifests from
`<workspace>/.agents/plugins/*.json` on each session turn. The first
plugin surface is deliberately small and replaceable: manifests can
contribute local stdio MCP servers, and MCP tools are adapted into the
same `ToolRegistry` used by built-ins.

Example:

```json
{
  "name": "debugger",
  "mcpServers": {
    "gdb": {
      "command": "mcp_gdb",
      "args": [],
      "env": { "LOG_LEVEL": "info" },
      "cwd": "."
    }
  }
}
```

Manifest fields:

| Field | Meaning |
| ----- | ------- |
| `name` | Optional plugin name. Defaults to the manifest filename without `.json`. Must match `^[A-Za-z][A-Za-z0-9_-]*$`. |
| `mcpServers` | Object whose keys are MCP server names. Server names use the same name pattern and must be unique across all manifests. |
| `mcpServers.<name>.command` | Required executable to spawn. |
| `mcpServers.<name>.args` | Optional argv array. Values are passed through literally, including empty strings and spaces. |
| `mcpServers.<name>.env` | Optional environment additions/overrides. Values are passed through literally. |
| `mcpServers.<name>.cwd` | Optional working directory. Relative paths resolve from the workspace root; default is the workspace root. |

Each configured server is started with stdio, initialized via MCP, asked
for `tools/list`, and closed after the turn. Tools are exposed to the
model as provider-safe names:

```text
mcp__<server>__<tool>
```

Names are sanitized to OpenAI-compatible characters and long names are
truncated with a deterministic hash suffix to stay within provider
function-name limits. If two MCP tools collide after namespacing,
startup fails fast with a duplicate-name error.

MCP tools use the normal tool policy hook. To disable a plugin tool,
put its exposed name in settings:

```json
{
  "tools": {
    "disabled": ["mcp__gdb__gdb_command"]
  }
}
```

When `--stream-json` is enabled, the `system/init` event includes active
MCP server names in `mcp_servers`.

Select a mode per invocation with the CLI:

```sh
stars -m deep -p "trace this bug across the codebase"
stars --mode smart -p "rename this variable everywhere"
```

To bypass mode resolution and pin a specific model, use `--model`:

```sh
stars --model claude-opus-4-5 -p "..."
```

Adding more modes programmatically — see
[Mixing modes and models](#mixing-modes-and-models) below.

## Environment variables

| Variable                 | Required | Default         | Purpose                                           |
| ------------------------ | -------- | --------------- | ------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | one of   | —               | Enables Anthropic API-key auth.                   |
| `ANTHROPIC_AUTH_TOKEN`   | one of   | —               | Enables Anthropic Bearer-token auth for gateways. |
| `OPENAI_API_KEY`         | one of   | —               | Enables the OpenAI-compatible provider.           |
| `ANTHROPIC_BASE_URL`     | no       | Anthropic's URL | Self-hosted or proxied Anthropic endpoint.        |
| `OPENAI_BASE_URL`        | no       | OpenAI's URL    | OpenRouter, vLLM, Ollama (OpenAI mode), …         |
| `SMART_MODEL`            | no       | `opus4.7`       | Model bound to the `smart` mode.                  |
| `DEEP_MODEL`             | no       | `gpt5.5`        | Model bound to the `deep` mode.                   |
| `RUSH_MODEL`             | no       | `sonnet4.6`     | Model bound to the `rush` mode.                   |
| `ANTHROPIC_DEFAULT_OPUS_MODEL`   | no | —       | Anthropic-provider fallback for `smart` when `SMART_MODEL` is unset. |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | no | —       | Anthropic-provider fallback for `rush` when `RUSH_MODEL` is unset.   |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL`  | no | —       | Anthropic-provider fallback for `rush` when Sonnet/Rush are unset.   |
| `SMART_REASONING_EFFORT` | no       | —               | Mode-level reasoning hint for `smart`.            |
| `DEEP_REASONING_EFFORT`  | no       | —               | Mode-level reasoning hint for `deep`.             |
| `RUSH_REASONING_EFFORT`  | no       | `medium`        | Mode-level reasoning hint for `rush`.             |
| `STARS_HOME`             | no       | `~/.stars`      | Thread/todo storage directory.                    |

`loadConfig` requires **at least one** of `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, or `OPENAI_API_KEY` and throws otherwise. Both
provider families may be set simultaneously to enable mixed-provider
routing.

The `ANTHROPIC_DEFAULT_*_MODEL` aliases are accepted for compatibility
with Anthropic-compatible gateway setups that also power Claude Code.
They are only used when an Anthropic provider is configured. Unprefixed
alias values such as `gpt-5.5` are routed through the Anthropic provider
internally and sent to the gateway without the routing prefix.

## CLI flags

| Flag                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `-p`, `--prompt`    | Execute one prompt and exit.                           |
| `-x`, `--execute`   | Execute one prompt and exit; accepts optional prompt.   |
| `-m`, `--mode`      | Mode name; resolved against `Config.modes`.            |
| `--model`           | Raw model identifier; bypasses mode resolution.        |
| `--thread <id>`     | Continue a local saved thread.                         |
| `--stream-json`     | Emit newline-delimited JSON lifecycle events.          |
| `--stream-json-input` | Read JSONL user messages from stdin; requires `--stream-json`. |
| `threads list [--archived|--all]` | List active, archived, or all local threads. |
| `threads continue <id>` | Resume a local thread interactively.              |
| `threads archive <id>`  | Hide a local thread from the default list.        |
| `threads fork <id>`     | Copy a local thread transcript into a new active thread. |

Precedence (first match wins):

1. `--model <id>` on the command line.
2. `-m`/`--mode <name>` on the command line.
3. `Config.defaultMode` from workspace/user settings, or `"smart"`.

Within `Config`, env vars such as `SMART_MODEL`, `DEEP_MODEL`,
`RUSH_MODEL`, and `*_REASONING_EFFORT` override settings-file mode
values. Settings-file values override the built-in defaults.

For automation schemas and examples, see
[Stream JSON automation](stream-json.md).
For thread commands and archive/fork semantics, see
[Local thread workflow](threads.md).

## Provider routing

When both providers are configured, the router in
[app/llm/router.ts](../app/llm/router.ts) dispatches each chat request
to a provider based on the request's `model` field:

| Model prefix                       | Provider  |
| ---------------------------------- | --------- |
| `claude*`, `opus*`, `sonnet*`, `haiku*`, `anthropic:*`, `anthropic/*` | Anthropic |
| `gpt*`, `o1*`, `o3*`, `o4*`, `openai:*`, `openai/*` | OpenAI-compatible |

Colon prefixes (`anthropic:...`, `openai:...`) are routing hints and
are stripped before the provider call. Slash prefixes (`anthropic/...`,
`openai/...`) are treated as provider/model namespaces and are preserved
for gateways that require names such as `anthropic/claude-opus-4.6`.

If only one provider is configured, it also serves as the fallback for
unrecognised model names. If both are configured and the model matches
neither prefix set, the router throws:

```
no chat client registered for model "<model>"
```

This routing happens **per request**, which is what enables mixing
models inside a single agent run — see
[Mixing modes and models](#mixing-modes-and-models) below.

## Provider compatibility

### Anthropic (smart/rush defaults)

```sh
export ANTHROPIC_API_KEY=sk-ant-...
# SMART_MODEL defaults to opus4.7; RUSH_MODEL defaults to sonnet4.6.
stars -p "..."                            # uses smart by default
stars -m rush -p "..."                    # uses rush with medium reasoning effort
```

For Anthropic-compatible gateways that use Bearer auth, set
`ANTHROPIC_AUTH_TOKEN` instead of `ANTHROPIC_API_KEY`.

### OpenAI (deep mode)

```sh
export OPENAI_API_KEY=sk-...
# DEEP_MODEL defaults to gpt5.5
stars -m deep -p "..."
```

### Override the model for a built-in mode

```sh
export SMART_MODEL=opus4.7
export DEEP_MODEL=o3
export DEEP_REASONING_EFFORT=high
```

### OpenRouter (OpenAI-compatible)

```sh
export OPENAI_API_KEY=sk-or-...
export OPENAI_BASE_URL=https://openrouter.ai/api/v1
stars --model openai:gpt-4o-mini -p "..."
```

Colon prefixes such as `openai:gpt-4o-mini` are routing hints and are
stripped before the model name is sent to the provider. Slash namespaces
such as `openai/gpt-4o-mini` are preserved for gateways that require
them.

### vLLM (self-hosted, OpenAI mode)

```sh
export OPENAI_API_KEY=ignored
export OPENAI_BASE_URL=http://localhost:8000/v1
stars --model openai:meta-llama/Llama-3.3-70B-Instruct -p "..."
```

### Ollama (OpenAI-compatible mode)

```sh
export OPENAI_API_KEY=ignored
export OPENAI_BASE_URL=http://localhost:11434/v1
stars --model openai:qwen2.5-coder -p "..."
```

Note: small local models often handle tool calling less reliably than
hosted frontier models. Prefer models with explicit tool-calling
support.

### Both providers, mixed

```sh
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
stars -p "..."                            # smart (Anthropic) by default
stars -m deep -p "..."                    # deep (OpenAI)
stars --model gpt-4o-mini -p "..."        # explicit per-call model
```

## Programmatic configuration

If you embed the agent in another program, build a `Config` directly
and skip the env layer:

```ts
import { runAgent } from "./app/agent/loop.ts";
import { createChatClientFromConfig } from "./app/llm/providers.ts";
import { createBuiltinToolRegistry } from "./app/tools/builtin.ts";

const chat = createChatClientFromConfig({
  defaultMode: "smart",
  modes: {
    smart: { model: "opus4.7" },
    deep:  { model: "gpt5.5", reasoningEffort: "high" },
    rush:  { model: "sonnet4.6", reasoningEffort: "medium" },
  },
  tools: { disabled: [] },
  anthropic: { apiKey: process.env.MY_ANTHROPIC_KEY! },
  openai:    { apiKey: process.env.MY_OPENAI_KEY! },
});

const result = await runAgent({
  chat,
  registry: createBuiltinToolRegistry(),
  prompt: "Summarise the README.",
  model: "opus4.7",
});
```

## Mixing modes and models

`runAgent` sends one model identifier on every turn (the `model`
option). To genuinely mix models within a run you have three options:

1. **Add custom modes**, then select them programmatically:

   ```ts
   const config: Config = {
     defaultMode: "smart",
     modes: {
       smart:  { model: "opus4.7" },
       deep:   { model: "gpt5.5", reasoningEffort: "high" },
       cheap:  { model: "haiku4.5" },
       local:  { model: "openai:qwen2.5-coder" },
     },
     tools: { disabled: [] },
     anthropic: { apiKey: "..." },
     openai:    { apiKey: "...", baseURL: "http://localhost:11434/v1" },
   };
   ```

2. **Per-call routing**, by composing your own `ChatClient` that
   picks the model dynamically:

   ```ts
   const baseChat = createChatClientFromConfig(config);
   const mixedChat: ChatClient = {
     async chat(req) {
       // First few turns use Haiku for cheap planning;
       // later turns switch to a reasoning model.
       const model = req.messages.length < 4
         ? config.modes.smart.model
         : config.modes.deep.model;
       return baseChat.chat({ ...req, model });
     },
   };
   ```

3. **Multiple agent runs** orchestrated by the host, each with its own
   mode/model — a natural pattern for delegating sub-tasks (planner,
   executor, critic) to different models. Each call to `runAgent`
   returns the transcript, which you can splice into the next run's
   `prompt` or `system` message.

The intent is to keep the router stateless and the loop unaware of
multi-model concerns; richer policies live in the host program.

## Adding new configuration

When a new setting is required:

1. Add it to the appropriate provider section in `Config` (or to the
   top level if it is provider-agnostic).
2. If it belongs in settings files, parse and validate it in
   `loadSettings`; if it belongs in environment, read it from `env` in
   `loadConfig` using the provider's prefix (`OPENAI_*`, `ANTHROPIC_*`)
   or an explicit project prefix for cross-cutting settings.
3. Document the settings field or env variable above.
4. Add deterministic tests covering defaults, precedence, and invalid
   input.

Avoid scattering `process.env` reads through the codebase. The
config layer is the single source of truth.
