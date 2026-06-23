# Architecture

`stars` is organised around these deliberate boundaries:

1. The **CLI/session host** translates user input and environment into
   a typed `Config`, interactive or execute mode, thread identity, and
   an optional mode/model override.
2. The **mode/model resolver** picks the concrete model identifier and
   optional mode-level reasoning effort for this invocation, given the
   CLI args and the `Config`.
3. The **agent loop** orchestrates a conversation between a
   `ChatClient` and a `ToolRegistry`. It depends only on those two
   interfaces.
4. The **LLM layer** exposes a single `ChatClient` interface and ships
   concrete implementations for OpenAI-compatible endpoints and
   Anthropic's native Messages API. A **router** dispatches each
   request to the right provider based on the model identifier.
5. The **session/context layer** persists local threads, injects scoped
   `AGENTS.md` guidance, and carries thread todos across turns.
6. The **terminal rendering layer** turns assistant Markdown into
   styled, width-aware transcript rows without changing the raw
   conversation history sent to providers.
7. The **tools** are plain values that implement the `Tool` interface.

This separation is what makes the loop testable in isolation, the LLM
provider swappable, multi-provider mixing possible, and the tool set
extensible.

## Module layout

```
app/
├── main.ts                   CLI entrypoint. Wiring only.
├── headless.ts               package API for prompt and profile-based tasks
├── cli.ts                    parseArgs(argv) → interactive/execute/thread commands
├── config.ts                 loadConfig(env) → Config (modes + providers)
├── resolve-model.ts          resolveActiveModelSettings(config, args)
├── session/                  local threads + runSessionTurn()
├── context/                  AGENTS.md guidance discovery
├── server/                   HTTP gateway, VOS-native agent routes, portal API
├── terminal/                 slash commands + interactive loop
├── tui/                      alternate-screen rendering + raw prompt input
├── render/                   Markdown AST → styled terminal segments
├── output/                   stream-json helpers
├── agent/
│   ├── loop.ts               runAgent({...}); ChatClient interface
│   └── profiles.ts           task profile registry and tool policy
├── llm/
│   ├── openai-client.ts      OpenAI-backed ChatClient
│   ├── anthropic-client.ts   Anthropic-backed ChatClient
│   ├── anthropic-translate.ts OpenAI ⇄ Anthropic shape translation
│   ├── router.ts             createRoutedChatClient + matchesPrefix
│   └── providers.ts          createChatClientFromConfig (the wiring)
└── tools/
    ├── types.ts              Tool interface + ToolRegistry
    ├── read.ts / write.ts / edit.ts / glob.ts / grep.ts / bash.ts
    ├── todo.ts / task.ts
    └── builtin.ts            createBuiltinToolRegistry()
```

## Dependency graph

```diagram
                       ┌──────────────────────────────┐
                       │            main              │
                       │ (parse → load → wire → run)  │
                       └──────────────┬───────────────┘
                                      │ constructs
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
  ┌───────────┐               ┌────────────────┐            ┌──────────────┐
  │  config   │               │ providers.ts   │            │ tools/       │
  │ loadConfig│               │ createChat-    │            │ builtin      │
  └───────────┘               │ ClientFrom-    │            │   Read       │
                              │ Config         │            │   Write      │
                              └──────┬─────────┘            │   Bash       │
                                     │ produces             └──────┬───────┘
                                     ▼                             │
                              ┌────────────────┐                   │
                              │ router.ts      │                   │
                              │ (claude/opus/  │                   │
                              │  sonnet → A)   │                   │
                              │  (gpt/o* → O)  │                   │
                              └──┬──────────┬──┘                   │
                                 │          │                      │
                                 ▼          ▼                      │
                          ┌──────────┐ ┌───────────┐               │
                          │ openai-  │ │ anthropic-│               │
                          │ client   │ │ client    │               │
                          │          │ │   +       │               │
                          │          │ │ translate │               │
                          └──────────┘ └───────────┘               │
                                 │                                 │
                                 │ all implement                   │
                                 ▼                                 │
                          ┌──────────────────────┐                 │
                          │   ChatClient (iface) │◀────────────────┘
                          └──────────┬───────────┘    injected
                                     │ injected
                                     ▼
                          ┌─────────────────────────────────────┐
                          │           agent/loop.ts             │
                          │                                     │
                          │  runAgent({ chat, registry,         │
                          │    prompt, model,                   │
                          │    reasoningEffort })               │
                          │      depends only on interfaces     │
                          └─────────────────────────────────────┘
```

The loop has no compile-time knowledge of the OpenAI SDK, the
Anthropic SDK, or any specific tool. Everything is injected at boot.

## Terminal Markdown rendering

Assistant messages are stored and sent to providers as raw text. Only
the human-facing TUI transcript renders Markdown. This keeps provider
round-trips lossless while allowing the terminal UI to use rich
formatting.

```diagram
╭────────────────────╮
│ assistant text      │  raw transcript/provider payload
╰─────────┬──────────╯
          │ release TUI rendering only
          ▼
╭────────────────────╮
│ render/markdown.ts  │  mdast + GFM → RenderLine[]
│ TermRenderer        │  headings, lists, tables, code, links
╰─────────┬──────────╯
          │ styled RenderSegment{text, style, link}
          ▼
╭────────────────────╮
│ render/layout.ts    │  grapheme-aware wrap/pad/hard-break
╰─────────┬──────────╯
          │ terminal-cell rows
          ▼
╭────────────────────╮
│ tui/stars-view.ts   │  transcript cache + viewport layout
╰─────────┬──────────╯
          │ cells with style/link metadata
          ▼
╭────────────────────╮
│ tui/screen.ts       │  diff renderer + SGR + OSC-8 links
╰────────────────────╯
```

The render layer deliberately has two outputs:

- `RenderSegment` carries text, terminal `Style`, and optional link
  URI. This is the semantic output used by the TUI so clickable OSC-8
  links survive wrapping and wide-cell layout.
- Plain text helpers such as `renderMarkdownText` and
  `renderedMarkdownToText` exist for tests and non-TTY fallbacks.

`app/render/markdown.ts` owns Markdown semantics: parsing via mdast +
GFM, block rendering, list/table layout decisions, visible URL
fallbacks, and lightweight TypeScript/JavaScript/JSON fenced-code
highlighting. Code highlighting is stateful across physical lines so
block comments and template literals keep their style until the token
actually closes. Product call sites configure the renderer with a
plain `TermRendererOptions` object (`styles`, `wordWrap`,
`preserveNewLines`, `inlineLinks`, `baseUrl`) so rendering policy is
visible at the call site; the older `with*` functional options remain
available for tests and compatibility.

`app/render/layout.ts` owns terminal layout over render segments:
wrapping, hard line breaks, padding, segment compaction, link
preservation, and display-cell measurement. It uses the shared
grapheme helpers in `app/tui/display-width.ts` so CJK text, emoji, and
ZWJ clusters are never split into broken terminal cells.

`app/tui/stars-view.ts` is the integration boundary. It renders
assistant transcript items with `starsDarkStyle` or `starsLightStyle`,
caches rendered Markdown rows by text/width/theme, and leaves user,
command, tool, and error transcript rows on their simpler plain-text
paths. Debug assistant labels also use plain text so diagnostics show
the original payload.

`app/tui/screen.ts` is the final terminal boundary. It stores style
and link metadata per cell, tracks wide-cell continuations, and emits
OSC-8 hyperlink open/close sequences only in the terminal diff. This
keeps terminal-control concerns out of the Markdown renderer.

## The `ChatClient` seam

The loop talks to the LLM through a single interface:

```ts
export interface ChatRequest {
  model: string;
  reasoningEffort?: ReasoningEffort;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  tools:    OpenAI.Chat.ChatCompletionFunctionTool[];
}

export interface ChatClientCapabilities {
  readonly input: Readonly<Record<"text" | "image" | "pdf", boolean>>;
}

export interface ChatClient {
  capabilities?: (model: string) => ChatClientCapabilities;
  chat(request: ChatRequest): Promise<OpenAI.Chat.ChatCompletionMessage>;
}
```

The `ChatClient` speaks the OpenAI shape — messages, tools, and the
returned `ChatCompletionMessage`. Non-OpenAI providers translate at
their own boundaries (see [The Anthropic adapter](#the-anthropic-adapter)).
The optional `capabilities(model)` hook reports provider-boundary input
shapes that callers may safely build before sending a request. Plain test
doubles that omit it are treated as text-only by
`chatClientCapabilities(...)`.

`model` and `reasoningEffort` are part of the request, not the client.
This is deliberate: a single composite `ChatClient` (the router) can
hand each request to a different provider based on the model
identifier, while the mode/config layer can keep reasoning effort out
of the CLI/TUI surface.

The seam exists for four reasons:

- **Testability.** Tests substitute a `ScriptedChatClient` (queue of
  pre-built messages) or a `CallbackChatClient`. The loop runs in
  milliseconds, deterministically, with no network access.
- **Provider portability.** Any new provider is a new file in
  `app/llm/` exporting a function that returns a `ChatClient`.
- **Composition.** A router is itself a `ChatClient` that dispatches
  to others. A retry/caching/telemetry decorator is also a
  `ChatClient`. These compose by simple wrapping.
- **Decoupling concerns.** Retries, caching, telemetry, and rate
  limiting belong in decorators, not inside the loop.

## The router

[app/llm/router.ts](../app/llm/router.ts) is a `ChatClient` that
delegates to one of several inner clients based on each request's
model identifier. The selection rule is a list of `Route` objects:

```ts
export interface Route {
  match:  (model: string) => boolean;
  client: ChatClient;
  rewriteModel?: (model: string) => string;
}
```

Routes are evaluated in declared order; the first match wins. An
optional `fallback` is used when no route matches. With no fallback
and no match, the router throws a clear error.

Capability lookups route through the same matching and `rewriteModel`
logic as chat requests, so future multimodal CLI/TUI code can check the
active provider before constructing image/PDF content.

[app/llm/providers.ts](../app/llm/providers.ts) builds the default
router from a `Config`:

- `claude*`, `opus*`, `sonnet*`, `haiku*`, `anthropic:*`,
  `anthropic/*` → Anthropic
- `gpt*`, `o1*`, `o3*`, `o4*`, `openai:*`, `openai/*` → OpenAI-compatible
- single-provider configurations also set that provider as the
  fallback, so unknown identifiers resolve to it cleanly.

This is the mechanism by which a single agent run can mix providers:
the model name is the dispatch key, set per request.

## The Anthropic adapter

Anthropic's Messages API has a meaningfully different wire format
from OpenAI's chat-completions:

- `system` is a top-level field, not a message role.
- Tool calls live in **content blocks** on the assistant message
  (`tool_use`), not in a separate `tool_calls` array.
- Tool results are content blocks (`tool_result`) on **user**
  messages, and multiple results from the same turn are grouped into
  a single user message.
- `max_tokens` is required.

[app/llm/anthropic-translate.ts](../app/llm/anthropic-translate.ts)
performs the translation in both directions so that the rest of the
system can keep using the OpenAI shape as its canonical format:

- `toAnthropicRequest(messages, tools)` extracts system messages,
  groups consecutive `role:"tool"` messages into a single user turn
  with `tool_result` blocks, maps OpenAI image/PDF user content into
  Anthropic image/document blocks, and reshapes function-tool schemas.
- `fromAnthropicMessage(msg)` collapses Anthropic content blocks back
  into an `OpenAI.Chat.ChatCompletionMessage` with `content` and
  optional `tool_calls`.

The translator is covered by unit tests including a round-trip case
that drives a `tool_use` through both directions.

## The `ToolRegistry` seam

Tools are values, not classes:

```ts
export interface Tool {
  readonly name: string;
  readonly schema: OpenAI.Chat.ChatCompletionFunctionTool;
  execute(argumentsJson: string): string | Promise<string>;
}
```

The registry owns lookup, schema aggregation, async composition, and
the unknown-tool fallback. Details: [Tools](tools.md).

## Design rules

These rules are enforced by code review and by the test suite.

### 1. `app/main.ts` is wiring only

The entrypoint parses arguments, loads config, constructs a chat
client (via `createChatClientFromConfig`) and a tool registry, and
calls `runAgent`. It contains no business logic.

### 2. The agent loop has no side effects except through tools

The loop reads from `ChatClient`, writes to a transcript array, and
calls `ToolRegistry.execute`. It does not touch `fs`, `process`, or
the network directly.

### 3. Provider translation happens at the provider boundary

The canonical internal message format is the OpenAI shape. Non-OpenAI
providers translate inbound and outbound at their own boundaries.
This keeps the rest of the system free of provider conditionals.

### 4. Routing decisions are stateless

A `Route` is a pure function `(model: string) → boolean`. The router
holds no state; conditional logic (cost limits, fallbacks on
provider error, etc.) belongs in a decorator above the router.

### 5. Tools never throw on expected failure

A missing file, a non-zero exit code, a malformed argument — these
are predictable outcomes that the model needs to see. Tools return an
error string in those cases.

### 6. Only `app/main.ts` writes to `stdout`

Tools and the loop emit results into messages and return values. The
single `console.log(result.content)` at the end of `main()` is the
only line that produces user-visible output.

### 7. Rendering never mutates conversation history

The TUI may render assistant Markdown richly, but session transcripts
and provider messages remain raw model text. Rendering-specific data
(`Style`, OSC-8 links, terminal cell widths, caches) stays inside
`app/render/` and `app/tui/`.

### 8. New env vars use a meaningful prefix

Provider-related settings use the provider's prefix (`OPENAI_*`,
`ANTHROPIC_*`). Cross-cutting settings use a project prefix.

## Extending the system

| Goal                                  | Where to make the change                                |
| ------------------------------------- | ------------------------------------------------------- |
| Add a new tool                        | New file in `app/tools/`; register in `builtin.ts`      |
| Support a different LLM provider      | New file in `app/llm/`; return a `ChatClient`           |
| Add a routing rule (e.g. fine-tunes)  | Edit `createChatClientFromConfig` in `providers.ts`     |
| Add a named mode (e.g. `cheap`)       | Add an entry to `Config.modes`; resolver picks it up    |
| Mix models per turn                   | Wrap a `ChatClient` and rewrite `request.model`         |
| Add retries / caching / telemetry     | Decorator around a `ChatClient`                         |
| Change assistant Markdown rendering   | `app/render/` for semantics/layout; `app/tui/` for cells |
| Stream responses                      | Extend `ChatClient` with `chatStream`; update loop      |
| Persist conversations                 | Owner is `app/main.ts`; pass loaded messages to loop    |
| Per-tool authorisation                | Middleware over `ToolRegistry.execute`                  |

When adding a new module, write the test alongside it and keep the
existing rules above.
