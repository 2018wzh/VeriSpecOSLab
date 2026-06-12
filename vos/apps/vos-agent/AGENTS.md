# AGENTS.md

Guidance for AI agents (and humans) working on this repo.

## Project

`vos-agent` — the Bun/TypeScript coding-agent backend for
VeriSpecOSLab. It speaks both
**Anthropic's native Messages API** and **OpenAI-compatible**
endpoints, with file, VOS workspace, todo, and subagent tools. A
model-name router dispatches each request to the right provider, so a
single agent run can mix models. The release binary is named
`vos-agent`.

Entry point: [app/main.ts](app/main.ts). Documentation:
[docs/README.md](docs/README.md).

## Runtime

- Bun **1.3+**. Do not introduce a Node-only dependency without
  confirming Bun compatibility.
- TypeScript with `verbatimModuleSyntax: true` and
  `moduleResolution: bundler`. Use `.ts` extensions in imports and
  `import type` for type-only imports.

## Commands

```sh
bun install                            # deps
bun test                               # full test suite (~250 ms)
bun test tests/llm                     # subset by directory
bunx tsc --noEmit                      # typecheck
bun run app/main.ts -p "…"             # smart mode (default, Anthropic)
bun run app/main.ts -m deep -p "…"     # deep mode (OpenAI)
bun run app/main.ts serve --port 8787  # OpenAI-compatible HTTP gateway
bun run app/main.ts --model <id> -p "…" # pin a raw model identifier
```

## Modes and model selection

This agent exposes Amp-style modes. Each mode is a named preset that
resolves to a model identifier:

| Mode    | Default model | Provider          | Reasoning effort | Purpose                 |
| ------- | ------------- | ----------------- | ---------------- | ----------------------- |
| `smart` | `opus4.7`     | Anthropic         | —                | Default. Most work.     |
| `deep`  | `gpt5.5`      | OpenAI-compatible | —                | Reasoning-heavy work.   |
| `rush`  | `sonnet4.6`   | Anthropic         | `medium`         | Fast urgent-work preset. |

Resolution order (first match wins) is implemented in
[app/resolve-model.ts](app/resolve-model.ts):

1. `--model <id>` (raw override; bypasses modes)
2. `-m`/`--mode <name>` (resolves against `Config.modes`)
3. `Config.defaultMode` (`"smart"` for the built-in config)

Env overrides: `SMART_MODEL`, `DEEP_MODEL`, `RUSH_MODEL`, plus
mode-level `SMART_REASONING_EFFORT`, `DEEP_REASONING_EFFORT`, and
`RUSH_REASONING_EFFORT` (default `medium`). Reasoning effort is not a
CLI/TUI flag. Provider keys: `ANTHROPIC_API_KEY` or
`ANTHROPIC_AUTH_TOKEN` for Anthropic-compatible routing,
`OPENAI_API_KEY` for OpenAI-compatible routing. Either provider is
sufficient, but each enabled mode requires its corresponding provider.

After any code change, run `bunx tsc --noEmit` and `bun test`.

## Architecture summary

```
main → cli → config → providers → router ──┐
                                            │ dispatches by model
                                            ▼
                       ┌───────────┐  ┌─────────────┐
                       │  OpenAI   │  │  Anthropic  │
                       │ ChatClient│  │ ChatClient  │
                       └─────┬─────┘  └──────┬──────┘
                             │ implements    │ implements
                             └───────┬───────┘
                                     ▼
                            ChatClient (interface)
                                     │
                                     ▼
                          agent/loop  ────  ToolRegistry (Read, Write, Vos, Bash, …)
```

The agent loop depends only on `ChatClient` and `ToolRegistry`.
Tests inject `ScriptedChatClient`/`CallbackChatClient` stubs and
never touch the network. The OpenAI message shape is the canonical
internal format; the Anthropic client translates at its boundary.

Full architecture details: [docs/architecture.md](docs/architecture.md).

## Adding a tool

1. Create `app/tools/<name>.ts` exporting a `Tool`
   ([app/tools/types.ts](app/tools/types.ts)).
2. The schema must be a `ChatCompletionFunctionTool`. Parameters use
   JSON Schema; declare `required` fields explicitly.
3. `execute(argumentsJson)` must **return a string, never throw on
   expected failures**. Throwing breaks the agent loop; returning
   the error text lets the model reason about it.
4. Register the tool in
   [app/tools/builtin.ts](app/tools/builtin.ts).
5. Add a unit test in `tests/tools/<name>.test.ts` using
   `makeTmpDir` from [tests/helpers/tmp.ts](tests/helpers/tmp.ts).
6. Consider an integration scenario in `tests/scenarios/` if the new
   tool composes with others.

Full tool contract: [docs/tools.md](docs/tools.md).

## Adding a provider

1. Create `app/llm/<name>-client.ts` exporting a function that
   returns a `ChatClient`.
2. If the provider's wire format differs from OpenAI's, write the
   translation in a sibling `<name>-translate.ts` and unit-test it.
3. Extend `createChatClientFromConfig` in
   [app/llm/providers.ts](app/llm/providers.ts) to register a `Route`
   that matches the provider's model identifiers.
4. Add the provider's config to the `Config` interface and read it
   in `loadConfig`.
5. Add tests under `tests/llm/`.

## Coding conventions

- Two-space indent, double quotes, trailing commas (matches existing
  files).
- Small modules with single responsibilities. Keep `app/main.ts` to
  wiring only.
- Tools and the agent loop never print to `stdout`. Only `app/main.ts`
  prints the final assistant reply. Use `console.error` for
  diagnostics if you must.
- Side-effects (`fs`, `child_process`, network) live in tool or
  provider modules; the agent loop is pure orchestration over
  `ChatClient` and `ToolRegistry`.
- The canonical internal message shape is OpenAI's. New providers
  translate at their boundary, not in the loop.

## Test layering

- `tests/cli.test.ts`, `tests/config.test.ts` — pure parsing.
- `tests/llm/router.test.ts` — pure routing logic with fake clients.
- `tests/llm/anthropic-translate.test.ts` — shape translation, both
  directions, including round-trip.
- `tests/llm/providers.test.ts` — wiring; uses `127.0.0.1:1` +
  `maxRetries: 0` to fail fast.
- `tests/tools/*.test.ts` — each tool against a fresh tmp dir.
- `tests/agent/loop.test.ts` — `runAgent` driven by stub
  `ChatClient`s.
- `tests/scenarios/*.test.ts` — end-to-end flows with scripted LLM
  responses and real filesystem operations.

Bun's test runner is sequential within a file, so the `withCwd`
helper in [tests/helpers/cwd.ts](tests/helpers/cwd.ts) is race-free
when wrapping individual tests.

Full test guide: [docs/testing.md](docs/testing.md).

## Working as an agent in this repo

- Before claiming a change works, run `bunx tsc --noEmit` and
  `bun test`. Don't claim integration with a real LLM unless you
  actually ran it.
- The agent loop has `maxIterations` (default 50). If a real task
  legitimately needs more, raise it at the call site; do not remove
  the guard.
- New env vars use a meaningful prefix: `OPENAI_*`/`ANTHROPIC_*` for
  provider settings, a project prefix for cross-cutting settings.
- The router dispatches by `request.model`. To mix models inside a
  run, wrap a `ChatClient` and rewrite `request.model` per call —
  do not change the loop.
