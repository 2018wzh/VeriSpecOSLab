# Tools and the registry

Tools are the mechanism by which the language model affects the outside
world: filesystem reads, file writes, shell commands, network calls,
and anything else you choose to expose. This document specifies the
`Tool` contract, the rules a tool must obey, the role of the
`ToolRegistry`, and the built-in tools.

## The `Tool` interface

```ts
// app/tools/types.ts
export interface Tool {
  readonly name: string;
  readonly schema: OpenAI.Chat.ChatCompletionFunctionTool;
  execute(argumentsJson: string): string | Promise<string>;
}
```

A `Tool` is a value, not a class. It exposes:

- **`name`** — both the dispatch key in the registry and the
  `function.name` advertised to the model. They must match.
- **`schema`** — a complete OpenAI function-tool descriptor. The
  `parameters` field is a JSON Schema object; declare `required`
  parameters explicitly.
- **`execute(argumentsJson)`** — receives the raw `function.arguments`
  string from the model and returns the text to send back as the
  `tool` message content.

## The contract

Every tool must obey the following rules.

### 1. Return a string, never throw on expected failure

A tool's purpose is to give the model new information. Failures the
model can reason about — missing files, malformed input, non-zero
exit codes, parse errors — must be returned as descriptive strings,
not thrown.

```ts
execute(argumentsJson: string): string {
  try {
    const args = JSON.parse(argumentsJson) as { file_path: string };
    return readFileSync(args.file_path, "utf8");
  } catch (e) {
    return `Error reading file: ${(e as Error).message}`;
  }
}
```

`ToolRegistry.execute` has a final safety net that converts thrown
tool errors into `Error executing tool "<name>": ...` strings. Do not
rely on that for normal failures: expected problems should still be
handled inside the tool so the result can be specific and actionable.
Reserve throwing for genuinely unrecoverable conditions (programmer
bug, out-of-memory, denied permission on `mkdtemp`).

### 2. Parse arguments yourself

The registry passes the raw `function.arguments` JSON string. Each
tool decides how strictly to validate, but built-ins parse and validate
malformed JSON, missing required fields, and wrong primitive types so
the model gets a repairable error message instead of a crashed turn.
Shared helpers for that pattern live in
[app/tools/common.ts](../app/tools/common.ts).

### 3. The schema is the source of truth

The model only sees `schema`. If you change the parameter shape,
update both `schema` and the parser in `execute`. The TypeScript
types in `execute` are not visible to the model and cannot enforce
parameter constraints.

### 4. Names must be valid JSON identifiers

OpenAI requires tool names to match `^[a-zA-Z0-9_-]+$`. Stick to
PascalCase (`Read`, `Write`, `WebFetch`) for consistency with the
built-ins.

### 5. Output should be deterministic where possible

Tools are called inside an LLM loop. Non-determinism (random IDs,
timestamps, hash orderings) makes runs hard to debug and harder to
reproduce in tests. When a tool is unavoidably non-deterministic
(`Now`, `Random`), document it.

## The `ToolRegistry`

```ts
export class ToolRegistry {
  constructor(tools?: readonly Tool[], opts?: { policy?: ToolPolicy });
  register(tool: Tool): void;
  has(name: string): boolean;
  names(): string[];
  schemas(): OpenAI.Chat.ChatCompletionFunctionTool[];
  execute(name: string, argumentsJson: string): Promise<string>;
}
```

Responsibilities:

- **Dispatch.** `execute(name, args)` looks the tool up by name and
  invokes it. Async handlers are awaited transparently.
- **Schema aggregation.** `schemas()` returns the array that the
  agent loop passes to the model on every request. A policy can hide a
  registered tool from this list.
- **Policy checks.** `execute()` consults an optional policy hook before
  calling the tool. Denials return strings such as
  `Tool "Bash" denied by policy: disabled by settings` instead of
  throwing, so the model can recover in the same loop.
- **Unknown-tool policy.** `execute()` returns the string
  `"Unknown tool: <name>"` rather than throwing. This keeps the loop
  alive: the model receives the error as a `tool` result and can
  retry with a correct name.
- **Throwing-tool policy.** If a registered tool throws, `execute()`
  returns a string beginning with `"Error executing tool"` so one bad
  tool call does not abort the whole agent run.
- **Duplicate-registration policy.** `register()` throws on duplicate
  names. This is a programmer error and should fail fast at boot.

The built-in registry uses this policy hook for settings-driven disabled
tools. Tool names in the disabled list are matched case-insensitively.
Disabled tools are both hidden from schemas and denied if an older model
message or malformed provider response still calls them.

## Built-in tools

### `Read`

[app/tools/read.ts](../app/tools/read.ts)

| Parameter   | Type     | Required | Description                       |
| ----------- | -------- | -------- | --------------------------------- |
| `file_path` | `string` | yes      | Path to the file to read (UTF-8). |

Returns the file contents as a string, or an error string beginning
with `"Error reading file: "` on failure.

Relative paths resolve under the workspace root captured by
`createReadTool({ rootDir })` / `createBuiltinToolRegistry({ rootDir })`.
Absolute paths are allowed only if they remain inside that root. Large
files are truncated with an explicit omitted-byte marker before being
sent back to the model.

### `Write`

[app/tools/write.ts](../app/tools/write.ts)

| Parameter   | Type     | Required | Description                             |
| ----------- | -------- | -------- | --------------------------------------- |
| `file_path` | `string` | yes      | Destination path. Created if missing.   |
| `content`   | `string` | yes      | UTF-8 content to write.                 |

Creates parent directories as needed. Overwrites existing files.
Returns `"OK"` on success, or an error string on failure.

Like `Read`, `Write` rejects paths that escape the configured
workspace root before touching the filesystem.

### `Edit`

[app/tools/edit.ts](../app/tools/edit.ts)

| Parameter     | Type      | Required | Description                         |
| ------------- | --------- | -------- | ----------------------------------- |
| `file_path`   | `string`  | yes      | Existing file to edit.              |
| `old_str`     | `string`  | yes      | Exact text to replace.              |
| `new_str`     | `string`  | yes      | Replacement text; may be empty.     |
| `replace_all` | `boolean` | no       | Replace all matches instead of one. |

`Edit` is the preferred code-modification tool when the model can name
an exact replacement. It refuses missing matches and ambiguous matches
unless `replace_all` is true, which keeps accidental broad rewrites
repairable.

### `Glob`

[app/tools/glob.ts](../app/tools/glob.ts)

| Parameter     | Type      | Required | Description                    |
| ------------- | --------- | -------- | ------------------------------ |
| `pattern`     | `string`  | yes      | Glob relative to workspace.    |
| `max_results` | `integer` | no       | Cap returned matches.          |

Returns deterministic JSON: `{ matches, count, truncated }` with
workspace-relative POSIX paths.

### `Grep`

[app/tools/grep.ts](../app/tools/grep.ts)

| Parameter        | Type      | Required | Description                      |
| ---------------- | --------- | -------- | -------------------------------- |
| `pattern`        | `string`  | yes      | Literal text or regex.           |
| `path`           | `string`  | no       | File/dir under workspace root.   |
| `regex`          | `boolean` | no       | Treat pattern as JavaScript regex. |
| `case_sensitive` | `boolean` | no       | Defaults to true.                |
| `max_results`    | `integer` | no       | Cap returned matches.            |

Returns deterministic JSON with `file_path`, `line`, `column`, and
`text` for each matching line. Common generated directories such as
`.git`, `.stars`, `node_modules`, `dist`, and `coverage` are skipped.

### `TodoRead` / `TodoWrite`

[app/tools/todo.ts](../app/tools/todo.ts)

Todo tools are enabled by the session layer and persist on the current
thread. `TodoRead` returns the current list. `TodoWrite` replaces it
with an array of `{ id, content, status }`, where status is one of
`pending`, `in_progress`, or `completed`; an empty list clears todos.

### `Task`

[app/tools/task.ts](../app/tools/task.ts)

| Parameter     | Type     | Required | Description                         |
| ------------- | -------- | -------- | ----------------------------------- |
| `description` | `string` | yes      | Short label for the delegated task. |
| `prompt`      | `string` | yes      | Detailed subagent instructions.     |

`Task` is enabled by the session layer. It launches a nested agent run
using the same `ChatClient` and model but a fresh tool registry. The
fresh registry intentionally omits `Task` to keep first-cut delegation
bounded and avoid accidental recursive fan-out. Settings-driven disabled
tools are inherited by the subagent registry, so disabling `Bash`
applies to both parent and delegated work. Use `Task` for focused
investigation, review, verification, or independent implementation
subtasks, and return compact findings to the parent agent.

### `Bash`

[app/tools/bash.ts](../app/tools/bash.ts)

| Parameter | Type     | Required | Description                  |
| --------- | -------- | -------- | ---------------------------- |
| `command` | `string` | yes      | Shell command, passed to `sh -c`. |

Returns combined `stdout + stderr` as a string regardless of exit
code. The default per-command timeout is 30 seconds; use
`createBashTool({ timeoutMs })` to override.

Non-zero exits, timeouts, signals, and spawn errors append explicit
diagnostics such as `[Command exited with status 1]`. Large outputs are
truncated with an omitted-byte marker.

The built-in registry runs Bash with the configured workspace root as
its cwd. A standalone `createBashTool()` without `cwd` uses the current
process cwd at execution time. The tool inherits the process environment.

### `WebFetch`

[app/tools/web-fetch.ts](../app/tools/web-fetch.ts)

| Parameter    | Type      | Required | Description                                      |
| ------------ | --------- | -------- | ------------------------------------------------ |
| `url`        | `string`  | yes      | HTTP or HTTPS URL to fetch.                      |
| `max_bytes`  | `integer` | no       | Maximum body bytes returned; default 200 KB.     |
| `timeout_ms` | `integer` | no       | Request and body-read timeout; default 10 s.     |

Returns response metadata plus a text body:

```text
URL: https://example.com/page
Status: 200 OK
Content-Type: text/html; charset=utf-8
Body:
...
```

Expected failures return strings beginning with `Error fetching URL:`.
Only `http` and `https` schemes are allowed, URLs with embedded
credentials are rejected, and loopback/private/link-local hosts are
blocked by default. Redirects are followed manually so redirect targets
are validated with the same policy. Tool factories can opt into private
network access for local tests or controlled labs with
`createWebFetchTool({ allowPrivateNetwork: true })`; the built-in
registry does not enable that opt-in.

Large bodies are read with a hard byte cap and end with an explicit
`[web response truncated ...]` marker. The timeout covers both the
initial request and streaming body reads.

The public tool schema is intentionally separate from the fetch backend.
`createWebFetchTool({ provider })` accepts a `WebFetchProvider`, while
`createHttpWebFetchProvider(...)` is the default HTTP implementation. A
future provider-backed fetch service can implement the same provider
interface and return `{ url, status, contentType, body }` without
changing model-visible tool parameters or registry wiring. The tool
factory still enforces URL policy, timeout racing, and final body caps
around injected providers.

### `WebSearch`

[app/tools/web-search.ts](../app/tools/web-search.ts)

| Parameter     | Type      | Required | Description                                  |
| ------------- | --------- | -------- | -------------------------------------------- |
| `query`       | `string`  | yes      | Search query text.                           |
| `max_results` | `integer` | no       | Number of results to return; default 5, max 20. |
| `timeout_ms`  | `integer` | no       | Request and body-read timeout; default 10 s. |

The default provider is `createHttpWebSearchProvider(...)`, which queries
DuckDuckGo's Instant Answer JSON API. It is a small no-key search/answer
source rather than a full commercial search index, so some ordinary
queries may return no results.

The public tool schema is intentionally separate from the search backend.
`createWebSearchTool({ provider })` accepts a `WebSearchProvider` that
returns normalized `SearchResult` objects; the tool still owns argument
validation, deduplication, result limiting, timeout racing,
deterministic formatting, and output truncation. Provider-backed APIs
such as Parallel can plug in by mapping their response into
`SearchResult[]` without changing model-visible tool parameters.

Output is deterministic text:

```text
Search query: stars agent
Results:
1. Stars agent
   URL: https://example.com/stars
   Snippet: A coding agent project.
```

The search response body is bounded before JSON parsing, HTTP and JSON
parse failures are returned as strings beginning with `Error searching
web:`, and the timeout covers body reads. Custom endpoints are validated
like fetch URLs and block loopback/private/link-local hosts unless a test
factory opts in with `allowPrivateEndpoint: true`.

## Plugin-provided MCP tools

Project plugin manifests can contribute stdio MCP servers. During a
session turn, Stars loads `.agents/plugins/*.json`, starts each MCP
server, calls `tools/list`, and registers every MCP tool as a normal
Stars `Tool`.

Exposed tool names use this namespace:

```text
mcp__<server>__<tool>
```

For example, an MCP server named `gdb` with an MCP tool named
`gdb_command` is advertised as `mcp__gdb__gdb_command`. Names are
sanitized to provider-compatible characters and truncated with a stable
hash suffix when necessary. Duplicate exposed names fail fast during
tool-provider creation.

MCP tool adapters obey the same contract as built-ins:

- malformed tool-call JSON returns a parse/validation string;
- MCP `tools/call` errors return `Error calling MCP tool "...": ...`;
- text content blocks are joined with newlines;
- non-text or malformed MCP results are stringified instead of thrown;
- large outputs are truncated with an explicit `MCP output` marker;
- processes are closed after the turn, with a SIGKILL fallback if a
  server ignores shutdown.

Settings-driven disabled tool policy applies to MCP tools too. A hidden
MCP tool is omitted from model-visible schemas, and any attempted call
returns policy-denied text rather than executing.

Plugin/MCP tests should use local fake stdio servers, not network or
third-party services. See [tests/mcp/tools.test.ts](../tests/mcp/tools.test.ts)
and [tests/session/run-turn.test.ts](../tests/session/run-turn.test.ts)
for deterministic server fixtures.

## Adding a tool

Step-by-step in [Getting started](getting-started.md#6-write-a-custom-tool).

Checklist:

- [ ] File at `app/tools/<name>.ts` exports a `Tool` (or a factory).
- [ ] `schema.function.name` equals `name`.
- [ ] `execute` returns a string on every code path; no unhandled throws.
- [ ] Tool is registered in `app/tools/builtin.ts`.
- [ ] Unit test in `tests/tools/<name>.test.ts` using a tmp dir if the
      tool touches the filesystem.
- [ ] If the tool composes meaningfully with another, add a scenario
      in `tests/scenarios/`.

## Patterns for production tools

These document the intended direction beyond the built-in disabled-tool
policy.

- **Authorisation.** Extend the policy hook with richer permissions
  (read-only mode, sandboxed paths, allowlisted shell commands).
- **Sandboxing.** A `Bash` variant that runs commands inside a
  container or chroot would be a separate tool, not a flag on the
  existing one.
- **Idempotency keys.** Tools with external side-effects (HTTP POST,
  database writes) can accept an `idempotency_key` parameter that the
  model includes; the tool deduplicates.
- **Observability.** A decorator around `ToolRegistry.execute` remains
  the natural place for structured logging, OpenTelemetry spans, and
  per-tool latency histograms.
