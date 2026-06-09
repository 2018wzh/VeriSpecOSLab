# Stream JSON automation

Stars supports newline-delimited JSON output for automation and a JSONL
input mode for scripted multi-turn sessions.

## Output mode

Use `--stream-json` with execute mode:

```sh
stars --stream-json -p "inspect README.md"
```

When enabled, `stdout` contains JSONL only. Human diagnostics and the
`thread: ...` line used by normal execute mode are suppressed. Errors are
reported as structured `result` events.

Stars emits complete assistant messages rather than token deltas. The
current event types are compatible with Claude/Amp-style consumers:

### `system` / `init`

Emitted once when the local thread is created or loaded.

```json
{"type":"system","subtype":"init","cwd":"/repo","session_id":"T-...","tools":["Read","Write","Edit","Glob","Grep","Bash","WebFetch","WebSearch","TodoRead","TodoWrite","Task"],"mcp_servers":[],"model":"opus4.7","agent_mode":"smart"}
```

`mcp_servers` contains the names of active MCP servers loaded from
`.agents/plugins/*.json`; it is an empty array when no plugin MCP
servers are configured.

### `user` text

Emitted for each user turn.

```json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"inspect README.md"}]},"parent_tool_use_id":null,"session_id":"T-..."}
```

### `assistant`

Assistant text and tool-use requests are emitted as one assistant message
per model round-trip. If the model asks for tools, all tool uses from
that model message are grouped into the same event.

```json
{"type":"assistant","message":{"type":"message","role":"assistant","content":[{"type":"text","text":"I will read it."},{"type":"tool_use","id":"call_1","name":"Read","input":{"file_path":"README.md"}}],"stop_reason":"tool_use"},"parent_tool_use_id":null,"session_id":"T-..."}
```

### `user` tool result

Tool results are returned as user messages containing `tool_result`
blocks.

```json
{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_1","content":"# Stars\n...","is_error":false}]},"parent_tool_use_id":null,"session_id":"T-..."}
```

### `result`

Successful runs end with a single result event.

```json
{"type":"result","subtype":"success","duration_ms":1240,"is_error":false,"num_turns":2,"result":"Done.","session_id":"T-..."}
```

Structured errors use the same top-level event type:

```json
{"type":"result","subtype":"error_during_execution","duration_ms":12,"is_error":true,"num_turns":0,"error":"Malformed stream-json-input at line 2: ...","errors":["Malformed stream-json-input at line 2: ..."],"error_code":"malformed_stream_json_input","line":2}
```

## Input mode

Use `--stream-json-input` together with `--stream-json` to read user
messages from stdin:

```sh
printf '%s\n' \
  '{"type":"user","message":{"role":"user","content":"first question"}}' \
  '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"follow up"}]}}' \
  | stars --stream-json --stream-json-input
```

Each valid input line becomes one user turn. Stars reuses one local
thread until stdin closes, then emits one final `result` event for the
whole input session.

Accepted input lines are text-only user messages:

```ts
type StreamJsonInputLine = {
  type: "user";
  message: {
    role: "user";
    content: string | Array<{ type: "text"; text: string }>;
  };
};
```

Multimodal input blocks are still rejected by this stream-json input
surface. The provider layer already exposes capability metadata and can
translate programmatic OpenAI-shaped image/PDF user content where the
provider boundary supports it, but the CLI/TUI/stream-json UX and input
schema are a later roadmap item. Malformed input lines produce structured
`result` errors with `error_code: "malformed_stream_json_input"` and the
failing line number.
