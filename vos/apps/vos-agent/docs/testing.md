# Testing

The test suite is the executable specification of the system. It
covers every module the agent depends on, runs in roughly two hundred
milliseconds, and makes no network calls.

This document describes the layering, the helpers, and the conventions
to follow when adding tests.

## Tooling

Tests run on Bun's built-in test runner. No additional packages are
required.

```sh
bun test                    # run everything
bun test tests/tools        # subset by directory
bun test tests/tools/read   # subset by name fragment
```

Bun loads every file matching `*.test.ts` under the project root.

## Layering

The suite is organised into four layers, each with a distinct scope.

### Layer 1: Pure parsing

[tests/cli.test.ts](../tests/cli.test.ts),
[tests/config.test.ts](../tests/config.test.ts).

Pure function tests over argv and environment maps. No side effects.

### Layer 1b: LLM plumbing

[tests/llm/router.test.ts](../tests/llm/router.test.ts) covers the
prefix-matching router with fake clients (in-memory, no SDK), including
capability lookup routing through the same matching and model-rewrite
rules as chat calls.

[tests/llm/anthropic-translate.test.ts](../tests/llm/anthropic-translate.test.ts)
covers the OpenAI ⇄ Anthropic message-shape translation, including
system extraction, tool-result grouping, image/PDF user content,
schema translation, and a round-trip case.

[tests/llm/providers.test.ts](../tests/llm/providers.test.ts)
verifies the wiring built by `createChatClientFromConfig`. It points
the SDKs at an unreachable URL with `maxRetries: 0` so the network
attempt fails immediately; the test only asserts that the *router*
resolved a backend (or correctly threw). It also verifies provider
capability metadata exposed through the routed client.

### Layer 1c: Terminal rendering primitives

[tests/render/markdown.test.ts](../tests/render/markdown.test.ts)
covers the Markdown renderer before it enters the full TUI: visible URL
fallbacks plus OSC-8 link metadata, fenced-code wrapping and
highlighting, GFM tables, nested task lists, responsive table fitting,
and display-width-sensitive cases such as CJK cells.

[tests/tui/screen.test.ts](../tests/tui/screen.test.ts) covers the
screen buffer and terminal diff layer: Unicode cell widths, grapheme
cluster preservation, wide-cell clearing, style diffs, OSC-8 hyperlink
open/close handling, and sanitisation of control bytes.

[tests/tui/stars-view.test.ts](../tests/tui/stars-view.test.ts) covers
the integration boundary where assistant transcript Markdown becomes
viewport rows. These tests assert theme-safe styles, code fence/table
wrapping, clickable links, wide glyph alignment, and emoji grapheme
cluster handling in rendered transcript cells.

### Layer 2: Tools

[tests/tools/](../tests/tools/) — one file per tool plus
[registry.test.ts](../tests/tools/registry.test.ts).

Each tool is exercised against a fresh temporary directory created by
`makeTmpDir`. The tests assert directly on the filesystem after each
call. The `Bash` tests use the same tmp dir to verify side effects
such as `rm`. The registry tests are pure and cover dispatch,
unknown-tool fallback, duplicate registration, and async handler
support.

### Layer 3: Agent loop

[tests/agent/loop.test.ts](../tests/agent/loop.test.ts).

Drives `runAgent` with stub `ChatClient`s and asserts on:

- the shape and ordering of messages in the transcript,
- the dispatching of tool calls to the registry,
- termination conditions,
- the `maxIterations` ceiling,
- the optional `system` prompt.

These tests do not touch the filesystem; the registry is constructed
from a `recordingTool` helper that records and replays.

### Layer 4: Scenarios

[tests/scenarios/](../tests/scenarios/) — end-to-end flows.

Each scenario combines:

- a real filesystem fixture in a tmp dir,
- a scripted or callback-driven `ChatClient`,
- the builtin tool registry,
- `runAgent` run with `withCwd` so the tools see the fixture dir.

After the run, the test asserts on both the agent's final reply and
on the filesystem state. These scenarios protect against regressions
that would only manifest in production paths (e.g. cwd handling,
message-shape round-tripping, multi-tool composition).

The four shipped scenarios:

| File                                                | Validates                                    |
| --------------------------------------------------- | -------------------------------------------- |
| [read-flow.test.ts](../tests/scenarios/read-flow.test.ts)     | Single Read returns exact file contents.     |
| [multi-turn.test.ts](../tests/scenarios/multi-turn.test.ts)   | Read → Read → answer via loop iteration.     |
| [write-flow.test.ts](../tests/scenarios/write-flow.test.ts)   | Read then Write composes across tools.       |
| [bash-flow.test.ts](../tests/scenarios/bash-flow.test.ts)     | Bash side effects observable on disk.        |

## Helpers

[tests/helpers/tmp.ts](../tests/helpers/tmp.ts)

```ts
makeTmpDir(prefix?: string): string
removeTmpDir(path: string): void
writeFixture(root: string, relative: string, content: string): string
```

`writeFixture` creates intermediate directories.

[tests/helpers/cwd.ts](../tests/helpers/cwd.ts)

```ts
withCwd<T>(dir: string, fn: () => T | Promise<T>): Promise<T>
```

Swaps `process.cwd()` for the duration of `fn`, restoring it even on
throw. Bun runs tests sequentially within a file, so this is safe
per test. Do **not** mutate `process.cwd()` from top-level hooks
shared across files.

[tests/helpers/stub-chat.ts](../tests/helpers/stub-chat.ts)

```ts
textResponse(content: string): Msg
toolCallResponse(calls: { name; args; id? }[]): Msg

class ScriptedChatClient implements ChatClient {
  constructor(script: Msg[]);
  readonly requests: ChatRequest[];
  readonly callCount: number;
}

class CallbackChatClient implements ChatClient {
  constructor(handler: (req, callIndex) => Msg | Promise<Msg>);
  readonly requests: ChatRequest[];
}
```

Use `ScriptedChatClient` when the response sequence is fixed.
Use `CallbackChatClient` when responses depend on the request or on
the call index (e.g. branch on whether the model has seen a
particular tool result yet).

## Conventions

- One `describe` per file. Subgroups only when a file naturally
  covers multiple related units.
- Test names start with a verb in the present tense
  (`"creates a new file"`, `"throws when …"`).
- Use `beforeEach`/`afterEach` for tmp-dir lifecycle, never
  `beforeAll`.
- Assertions on stdout/stderr from subprocesses use
  `result.stdout.trim()` to insulate from trailing-newline
  differences across shells.
- Network calls in tests are forbidden. The fix is always to inject
  a stub.

## Adding tests

When you add a new tool, add a `tests/tools/<name>.test.ts`. When
the tool meaningfully composes with another, add a scenario in
`tests/scenarios/`. When you add a new option to `runAgent`, add a
case in `tests/agent/loop.test.ts` covering both the default and the
override.

If a bug slips through, the first commit fixing it should add a
regression test that fails before the fix and passes after.
