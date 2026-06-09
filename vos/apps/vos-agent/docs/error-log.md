# Error logbook

This log captures implementation errors or review findings encountered
while building Stars, plus the diagnosis and fix applied.

## 2026-06-04 — P0 stream JSON automation

### Missing implementation after writing tests

- **Symptom:** Targeted tests failed with missing `StreamJsonEncoder`,
  `createStreamJsonErrorEvent`, `stream-json-input.ts`, and
  `--stream-json-input` parsing.
- **Diagnosis:** Expected red state from the test-first step; the output
  adapter and JSONL input runner did not exist yet.
- **Fix:** Added the stream JSON encoder, structured error event helper,
  `--stream-json-input` parser/runner, and CLI wiring.
- **Verification:** `bun test tests/output/stream-json.test.ts tests/cli.test.ts tests/session/stream-json-input.test.ts` passed.

### Assistant tool-use events were not grouped

- **Symptom:** Review found that tool calls would be emitted as separate
  assistant events, losing Claude/Amp-style grouping for text plus
  multiple tool uses in one assistant message.
- **Diagnosis:** `runSessionTurn` exposed only assistant text and each
  `tool.call` event independently, so the stream boundary could not see
  the original assistant message's full tool-call list.
- **Fix:** Added function tool-call metadata to `assistant.message`
  session events and changed the stream encoder to emit one grouped
  assistant event. Internal `tool.call` events remain available for other
  consumers but no longer produce duplicate stream assistant events.
- **Verification:** Added a regression test for assistant text plus two
  tool uses; targeted tests passed.

### Stream input resume ignored explicit model overrides

- **Symptom:** Review found `--stream-json-input --thread ... --model ...`
  would keep the stored thread model instead of honoring the explicit
  override.
- **Diagnosis:** The stream input runner only passed model/mode settings
  on newly created threads.
- **Fix:** Passed model, mode, and reasoning effort through every turn;
  callers still pass `undefined` when they want stored thread settings.
- **Verification:** Added a regression test for overriding model/mode on
  a resumed stream-input thread; targeted tests passed.

### OpenAI tool-call union type error

- **Symptom:** `bunx tsc --noEmit` failed because
  `ChatCompletionMessageToolCall` can be a custom tool call without a
  `.function` field.
- **Diagnosis:** The session event mapping accessed `.function` before
  narrowing to `type: "function"`.
- **Fix:** Narrowed tool calls to function calls before copying name and
  arguments into the session event.
- **Verification:** `bunx tsc --noEmit` passed after the fix.

## 2026-06-04 — P1 local thread workflow

### Fork test required an explicit undefined property

- **Symptom:** The new fork test failed even though the forked thread was
  active, because `toMatchObject` expected an `archivedAt: undefined`
  property to exist.
- **Diagnosis:** Active threads omit `archivedAt`; requiring the property
  was a test-shape bug rather than an implementation bug.
- **Fix:** Asserted `fork.archivedAt` separately with `toBeUndefined()`.
- **Verification:** Targeted `ThreadStore` tests passed after the test
  correction.

### Archived threads could still be resumed

- **Symptom:** Review found that `archive()` hid a thread from the
  default list, but `runSessionTurn` would still load and mutate it by
  ID.
- **Diagnosis:** The archived marker was only used by list filtering.
- **Fix:** Added `assertThreadCanContinue`, used it in `runSessionTurn`,
  and validated initial/thread-switched interactive threads before
  selecting them.
- **Verification:** Added run-turn and REPL tests for archived-thread
  rejection; targeted tests passed.

### Archive/fork allowed cross-workspace thread operations

- **Symptom:** Review found a thread file from another workspace could be
  archived or forked by a store for the current workspace.
- **Diagnosis:** `archive()` and `fork()` loaded by thread ID without the
  workspace ownership check used by normal resume.
- **Fix:** Added workspace ownership checks before archive and fork.
- **Verification:** Added ThreadStore cross-workspace rejection tests;
  targeted tests passed.

### Piped stdin resume overrode stored thread model

- **Symptom:** Review found `stars --thread T < prompt` would parse as
  interactive-with-stdin, resolve the default model, and override the
  stored thread model/mode.
- **Diagnosis:** The stored-thread model helper only covered execute mode.
- **Fix:** Moved the logic into `shouldUseStoredThreadModel` and made it
  cover both execute and interactive stdin turns.
- **Verification:** Added resolver coverage for resumed execute and
  piped-interactive turns; targeted tests passed.

## 2026-06-04 — P1 settings and tool policy

### Settings and tool-policy tests failed before implementation

- **Symptom:** The test-first pass failed with missing
  `app/settings.ts`, ignored settings defaults, advertised disabled
  tools, and policy-denied `Bash` calls executing normally.
- **Diagnosis:** Expected red state for the new P1 slice; config loading
  had no settings layer and `ToolRegistry` had no policy hook.
- **Fix:** Added user/workspace settings loading, settings-aware config
  merging, disabled-tool policy filtering, and session/main propagation.
- **Verification:** Targeted settings/config/registry/session tests
  passed after implementation.

### Required `Config.tools` broke programmatic test configs

- **Symptom:** `bunx tsc --noEmit` failed because provider and REPL tests
  constructed `Config` objects without the new `tools` field.
- **Diagnosis:** `tools` is now a required part of `Config`, so direct
  programmatic configs need an explicit policy section even when empty.
- **Fix:** Added `tools: { disabled: [] }` to direct test configs and
  documented the field in programmatic examples.
- **Verification:** `bunx tsc --noEmit` passed after the fix.

### Resumed explicit overrides inherited stale mode metadata

- **Symptom:** Review found that resuming a `rush`/`deep` thread with
  `--mode smart` or raw `--model` could keep the old reasoning effort
  and mode metadata.
- **Diagnosis:** `runSessionTurn` treated `undefined` as both “inherit
  stored setting” and “override with no reasoning effort”.
- **Fix:** Made resolved model settings carry the selected mode name,
  passed resolved mode metadata from the CLI, and changed resumed turns
  to inherit only when no explicit model override is provided.
- **Verification:** Added regression tests for clearing stale reasoning
  effort and raw-model metadata; targeted tests passed.

### Lowercase disabled tool names did not match built-ins

- **Symptom:** A review follow-up test with `disabledTools: ["bash"]`
  still advertised `Bash`.
- **Diagnosis:** The disabled-tool policy matched tool names exactly.
- **Fix:** Normalized disabled-tool names and called tool names
  case-insensitively in the policy hook.
- **Verification:** Updated the registry regression test; it passed.

## 2026-06-07 — P2 interactive TUI polish

### Mouse-wheel transcript scrolling regressed after copyability cleanup

- **Symptom:** In tmux, the transcript no longer scrolled with the mouse
  wheel. PageUp/PageDown moved too little, often making history review
  feel like it only hopped between submitted user prompt blocks.
- **Diagnosis:** PR #2 commit `84b64e7` intentionally enabled SGR mouse
  reporting in the raw TUI. The later copyability cleanup removed that
  lifecycle, so wheel events stopped reaching `StarsTuiPromptInput`.
  The active tmux server also had `mouse off`, which prevents tmux from
  forwarding wheel events reliably even when the app requests them.
- **Fix:** Restored TUI mouse-reporting setup/teardown, split scroll
  inputs into incremental wheel/Ctrl-Up rows vs PageUp/PageDown page
  jumps, and documented that tmux users need `set -g mouse on` for
  mouse-wheel transcript scrolling.
- **Verification:** Added raw TUI mouse lifecycle, parser, prompt-input,
  and page-scroll regressions; ran focused TUI/repl tests, typecheck,
  and the full test suite.

### Right-side prompt labels broke the border line and history controls were unclear

- **Symptom:** Human testing showed the shifted `smart` mode label and
  cwd label left blank gaps before the right prompt border. Transcript
  history also felt broken after normal mouse selection/copy was restored.
- **Diagnosis:** The right-side prompt gutter was implemented as spaces
  inside the label instead of border line cells. Disabling mouse reporting
  preserved drag-to-select behavior but meant wheel events no longer
  reliably reached the raw TUI.
- **Fix:** Rendered line cells after right-side prompt labels, preserving
  the inset while keeping the border continuous. Added Ctrl-Up/Ctrl-Down
  transcript scrolling alongside PageUp/PageDown as keyboard history
  controls.
- **Verification:** Added renderer and input regressions; ran the TUI
  tests, typecheck, and full test suite.

### Routine metadata crowded the TUI transcript and user/assistant colors were unclear

- **Symptom:** Human testing found blue status rows for thread, mode,
  model, tools, turn completion, and saved-thread events distracting in
  the normal TUI. User prompts also needed a clearer but not oversized
  rail, assistant responses should not repeat `assistant:` labels in
  release UI, and smart/deep modes needed different colors.
- **Diagnosis:** `StarsTuiInteractiveView` appended routine lifecycle
  events as `status` transcript rows, and the renderer colored assistant
  text green while submitted user text stayed neutral.
- **Fix:** Kept routine metadata out of the normal TUI transcript and
  left live mode/tool/cwd state in the prompt border. Submitted user
  turns now use a slim green rail plus green italic text, assistant
  output uses the terminal default foreground without repeated release
  labels, and prompt-border mode labels color smart/deep differently.
- **Verification:** Updated TUI renderer, interactive-view, raw TTY, and
  ANSI style regressions.

### Prompt input panel felt too short compared with Amp

- **Symptom:** Human comparison screenshots showed Stars' bottom input
  panel was shorter than Amp's, leaving the prompt area feeling cramped.
- **Diagnosis:** The TUI prompt box reserved only two content rows when
  the draft was short.
- **Fix:** Raised the default prompt content area to three rows while
  preserving the compact fallback for very small terminal heights.
- **Verification:** Updated renderer cursor/viewport regressions.

### Static welcome screen looked shabby compared with Amp

- **Symptom:** The first-start Stars welcome only showed a small static
  dot mark, while Amp presents a more vivid animated splash.
- **Diagnosis:** The renderer had no notion of welcome animation frames,
  and the interactive TUI rendered only one static welcome state.
- **Fix:** Added multiple galloping-horse welcome frames, a short
  startup animation for the normal CLI TTY path, and a deterministic
  opt-in animation path for tests/embedders.
- **Verification:** Added renderer and interactive-view regressions for
  horse frame rendering and animation playback.

### UTF-8/Chinese input was preserved but not rendered correctly

- **Symptom:** Human testing found Chinese prompt input could be
  submitted, but the TUI displayed unsupported glyphs as spaces and the
  one-cell renderer could not safely lay out wide characters.
- **Diagnosis:** Raw input already used UTF-8 and preserved Unicode text,
  but `ScreenBuffer` intentionally allowed only ASCII plus a few
  single-cell UI glyphs. Prompt wrapping and cursor placement also used
  JavaScript string length instead of terminal display width.
- **Fix:** Added terminal-cell width helpers, made `ScreenBuffer`
  represent wide characters with continuation cells, and updated prompt,
  transcript, palette, border, truncation, and cursor layout to use
  display-cell width. The evaluation guide now expects Chinese text to
  display rather than degrade to spaces.
- **Verification:** Added TUI regressions for UTF-8 prompt submission,
  Chinese prompt/transcript rendering, wide-character wrapping, and wide
  cell diff clearing.

### Neutral TUI text was hard to read on light terminal backgrounds

- **Symptom:** Human testing found the command palette and prompt looked
  clear on dark themes but low-contrast on light terminal themes.
- **Diagnosis:** Neutral UI elements such as prompt text, borders, and
  palette body text were hardcoded to ANSI white.
- **Fix:** Changed neutral UI styles to use the terminal default
  foreground while keeping semantic accents for rails, titles, errors,
  tools, and selected palette rows.
- **Verification:** Added a renderer regression that checks neutral TUI
  cells use the default foreground.

### Command palette could not be controlled by keyboard

- **Symptom:** Human testing found the slash-command palette was visible
  but could not be navigated with arrow keys.
- **Diagnosis:** Raw Up/Down input was still reserved for prompt history,
  and Left/Right only moved the prompt cursor; the prompt layer had no
  palette-specific key path.
- **Fix:** Added palette navigation before history/edit handling. When
  the palette is open, Up/Left select the previous entry, Down/Right
  select the next entry, and Enter activates the selected command.
  Argument-taking entries fill the prompt prefix instead of submitting.
- **Verification:** Added prompt-input and interactive-view regressions.

### Command palette and user turns were not visually Amp-like

- **Symptom:** Human testing found the slash-command surface still felt
  far from Amp, and submitted user prompts were too easy to confuse with
  agent output.
- **Diagnosis:** `/help` was rendered as plain transcript text and user
  turns used a textual `user:` prefix instead of a visual rail.
- **Fix:** Added a centered command palette overlay that appears while
  typing `/` and when `/help` is submitted. User transcript entries now
  render with a green left rail and white prompt text.
- **Verification:** Added TUI renderer and interactive-view regression
  tests for the palette and user rail.

## 2026-06-04 — P2 interactive TUI

### TUI clipped long content and exited on a single Ctrl-C

- **Symptom:** Human testing found long TUI rows disappeared past the
  right edge, the prompt did not visually match the Amp-style bottom
  input box, and an empty-prompt Ctrl-C exited too easily.
- **Diagnosis:** The initial view had a single clipped status/transcript
  line model and a one-line prompt viewport. Raw input treated empty
  Ctrl-C as immediate EOF.
- **Fix:** Reworked the pure TUI view around an Amp-inspired welcome
  area, wrapped transcript rows, and a bottom bordered prompt box that
  wraps prompt drafts. Ctrl-C now arms a second-press exit hint; the
  second Ctrl-C exits.
- **Verification:** Updated TUI/terminal regression tests and ran
  `bunx tsc --noEmit` plus `bun test`.

### Buffered REPL input closed readline between questions

- **Symptom:** New REPL tests that supplied multiple lines through a
  `PassThrough` failed with `readline was closed` after the first line.
- **Diagnosis:** `rl.question("stars> ")` can throw synchronously when
  the stream has already ended, so the previous `.catch()` only handled
  some close paths. The test exposed a brittle prompt loop.
- **Fix:** Switched the REPL to readline's async iterator and
  readline-owned prompt state (`setPrompt`/`prompt`), which handles
  buffered line input while keeping prompt rendering under readline.
- **Verification:** Added REPL tests for multi-command input and error
  recovery; targeted terminal tests passed.

### Raw-model sessions displayed misleading mode state

- **Symptom:** Review found `/mode` and `/mode <name>` looked successful
  when interactive mode was started with a raw `--model`, even though
  raw model pins bypass mode selection.
- **Diagnosis:** The REPL tracked a default mode string for display even
  when `opts.model` was the actual active selection.
- **Fix:** Made raw-model status explicit (`mode: raw model (<id>)`) and
  rejected `/mode <name>` with a clear error while `--model` is pinned.
- **Verification:** Added a regression test for raw model pins and mode
  commands; targeted terminal tests passed.

### Stored thread mode was rendered as raw model

- **Symptom:** Review found a resumed stored thread with both `mode` and
  `model` was shown as `raw model` in the welcome status.
- **Diagnosis:** The line renderer treated any visible model as a raw
  pin, including a model loaded from thread metadata.
- **Fix:** Tracked mode/model selection separately in the REPL and made
  the renderer show `mode` when present and `model` as additional
  context.
- **Verification:** Added a regression test for stored thread mode/model
  welcome status; targeted terminal tests passed.

## 2026-06-04 — P2 project custom commands

### Project commands were parsed as unknown slash commands

- **Symptom:** The first REPL test for `/review app/main.ts` failed with
  `stars: unknown command: /review`.
- **Diagnosis:** Expected red state from the test-first step; unknown
  slash commands were not yet routed through a project command loader.
- **Fix:** Added `app/terminal/project-commands.ts` and made the REPL
  expand matching `.agents/commands/*.md` files before falling back to
  the existing unknown-command error.
- **Verification:** Project command loader and REPL tests passed.

### Refactor left a stale `command.prompt` reference

- **Symptom:** After adding a shared prompt runner, normal prompts and
  project commands failed with `command is not defined`.
- **Diagnosis:** The extracted helper still referenced the outer
  `command.prompt` variable instead of its `prompt` parameter.
- **Fix:** Changed the helper to pass the prompt parameter through to
  `runSessionTurn` and normalized its indentation.
- **Verification:** Targeted terminal tests passed after the fix.

### Invalid command reporting could depend on directory order

- **Symptom:** Review noted that multiple invalid files could produce
  nondeterministic first-error ordering.
- **Diagnosis:** `readdirSync` entries were validated before sorting.
- **Fix:** Filtered and sorted markdown command entries before validation
  and added invalid filename/built-in-conflict tests.
- **Verification:** Targeted project-command and REPL tests passed.

## 2026-06-05 — P3 plugin and MCP integration

### Local `mcp_gdb` command was not available for integration testing

- **Symptom:** The server was expected to have `mcp_gdb`, but probes for
  `mcp_gdb`, `mcp-gdb`, and common Python modules returned no runnable
  executable/module.
- **Diagnosis:** The Amp environment exposes GDB MCP tools to this agent,
  but the Stars process under test still needs a local stdio MCP server
  command. No such command was visible on `PATH` or importable by Python.
- **Fix:** Used deterministic local fake stdio MCP servers in tests so
  plugin/MCP behavior is covered without depending on machine-local
  third-party installation state. Documented the manifest shape so a real
  `mcp_gdb` command can be configured when installed.
- **Verification:** `tests/mcp/tools.test.ts` and the session integration
  test exercise initialize, `tools/list`, `tools/call`, and shutdown.

### MCP tests failed before plugin/MCP implementation existed

- **Symptom:** The test-first pass failed because
  `app/plugins/manifest.ts`, `app/mcp/client.ts`, and MCP session wiring
  were missing.
- **Diagnosis:** Expected red state for the P3 slice.
- **Fix:** Added plugin manifest loading, stdio MCP JSON-RPC client,
  MCP-to-`Tool` adapter, built-in registry extension hook, and session
  wiring with `mcp_servers` stream metadata.
- **Verification:** Targeted plugin/MCP/session tests passed after the
  implementation.

### MCP subprocess close did not wait for process exit

- **Symptom:** Review found `mcpProvider.close()` returned after sending
  SIGTERM, so slow or signal-ignoring MCP servers could leak beyond a
  session turn.
- **Diagnosis:** `McpStdioClient.close()` was synchronous and did not wait
  for child `close`/`exit` events.
- **Fix:** Made MCP close asynchronous, ending stdin, sending SIGTERM,
  waiting briefly for close, and falling back to SIGKILL. The session
  turn awaits provider shutdown in `finally`.
- **Verification:** Added a fake server that writes a marker during its
  delayed SIGTERM handler; provider close waits until the marker exists.

### Malformed MCP tool results could violate the string-return contract

- **Symptom:** Review found `JSON.stringify(undefined)` could make an MCP
  tool adapter resolve to `undefined` instead of a string.
- **Diagnosis:** Non-standard or empty `tools/call` results flowed through
  a generic stringifier without a fallback.
- **Fix:** Changed the fallback to `JSON.stringify(value) ?? String(value)`
  and kept malformed MCP responses as tool-result text.
- **Verification:** Added a regression test where the fake MCP server
  returns a JSON-RPC response with no `result`; the tool returns the
  string `"undefined"`.

### MCP names could exceed provider tool-name limits or collide silently

- **Symptom:** Review found `mcp__<server>__<tool>` could exceed the
  OpenAI-compatible 64-character function-name limit, and duplicate MCP
  server names across manifests were ambiguous.
- **Diagnosis:** Names were sanitized but not bounded; plugin server names
  were flattened without a global duplicate check.
- **Fix:** Added deterministic hash-suffix truncation for long MCP tool
  names, fail-fast duplicate exposed-tool detection, and duplicate MCP
  server-name rejection across manifests.
- **Verification:** Added long-name, missing-schema-`required`, and
  duplicate-server manifest tests; targeted tests passed.

## 2026-06-05 — P3 web fetch/search tools

### Web tool tests failed before implementation existed

- **Symptom:** The test-first pass failed with missing
  `app/tools/web-fetch.ts`, `app/tools/web-search.ts`, and missing
  `WebFetch`/`WebSearch` entries in the built-in registry.
- **Diagnosis:** Expected red state for the P3 external-context slice.
- **Fix:** Added explicit-schema `WebFetch` and `WebSearch` tools and
  registered them in the built-in registry.
- **Verification:** Targeted web-tool and registry tests passed after the
  implementation.

### Review found timeouts did not cover response body reads

- **Symptom:** Review found `fetch()` timeouts were cleared after headers,
  so a server could send headers and then stall the body stream forever.
- **Diagnosis:** Body consumption happened after `fetchWithTimeout` had
  returned and cleared its abort timer.
- **Fix:** Moved timeout ownership around the full fetch + body-read path
  for both `WebFetch` and `WebSearch`.
- **Verification:** Added slow-stream tests for both tools; targeted tests
  passed.

### WebSearch read unbounded endpoint responses

- **Symptom:** Review found `WebSearch` used `response.text()` before
  truncation, so very large or never-ending responses could consume
  unbounded memory/time.
- **Diagnosis:** Output truncation happened after loading the full search
  response body.
- **Fix:** Added bounded stream reading before JSON parsing and an error
  path for responses exceeding the parse cap.
- **Verification:** Added a large-response regression test; targeted tests
  passed.

### Default WebFetch could reach private network targets

- **Symptom:** Review found enabling `WebFetch` by default allowed model
  requests to loopback/private/link-local targets, including via redirects.
- **Diagnosis:** URL validation only checked scheme and credentials.
- **Fix:** Blocked private, loopback, and link-local host literals by
  default and followed redirects manually so redirect targets are checked
  with the same policy. Local tests opt in through factory options.
- **Verification:** Added private-target and redirect-to-private tests;
  targeted tests passed.

### IPv4-mapped IPv6 literals bypassed private-network checks

- **Symptom:** Post-fix review found `::ffff:127.0.0.1`-style IPv6
  literals could bypass the host-literal private-network block.
- **Diagnosis:** The policy checked ordinary IPv4 literals and IPv6 local
  ranges separately, but did not convert IPv4-mapped IPv6 addresses back
  to IPv4 bytes before range checks.
- **Fix:** Added IPv4-mapped IPv6 parsing and reused the IPv4 private
  range predicate in both `WebFetch` and `WebSearch` endpoint validation.
- **Verification:** Added mapped-IPv6 regression tests for fetch URLs and
  search endpoints; targeted tests passed.

### Slow-stream test fixture raised after client abort

- **Symptom:** Full-suite run failed after a slow stream test because a
  delayed `ReadableStream` enqueue fired after the client abort had closed
  the controller.
- **Diagnosis:** The product code correctly aborted; the fake server timer
  did not tolerate that abort.
- **Fix:** Wrapped delayed enqueue/close calls in the test fixtures with a
  catch-only guard.
- **Verification:** Targeted tests, typecheck, and full suite passed.

## 2026-06-05 — P3 multimodal capability foundation

### Capability tests failed before provider metadata existed

- **Symptom:** The test-first pass failed because `ChatClient` had no
  capability hook or text-only fallback helper.
- **Diagnosis:** Expected red state for the provider capability slice;
  future image/PDF input needs a routable way to ask what the active
  provider boundary accepts before CLI/TUI code builds multimodal blocks.
- **Fix:** Added optional `ChatClient.capabilities(model)`, text-only
  fallback helpers, provider capability metadata, and router capability
  lookup through the same match/rewrite path as chat requests.
- **Verification:** Targeted LLM router/provider tests passed.

### Anthropic translation silently dropped multimodal user content

- **Symptom:** New translation tests showed OpenAI-shaped image/PDF user
  content collapsed to text-only Anthropic messages, and `file_id` parts
  were ignored.
- **Diagnosis:** `toAnthropicRequest` used a text stringifier for user
  messages, so non-text content parts were intentionally skipped.
- **Fix:** Added user-content translation for text, image URLs/data URLs,
  and PDF `file_data` blocks. Unsupported OpenAI file references now fail
  before network instead of being silently dropped.
- **Verification:** Targeted Anthropic translation tests passed.

### Capability lookup hid missing-provider configuration errors

- **Symptom:** Review found capability lookups for known-but-unconfigured
  providers would return text-only fallback metadata instead of the clear
  provider-not-configured error used by `chat()`.
- **Diagnosis:** Missing-provider route clients implemented `chat()` only,
  so the router's capability helper treated them like plain text-only test
  doubles.
- **Fix:** Added `capabilities()` to missing-provider clients so capability
  lookups throw the same configuration error as chat requests. Capability
  constants are now frozen/readonly to avoid accidental mutation.
- **Verification:** Added a provider regression test for missing-provider
  capability lookup.

## 2026-06-05 — P3 swappable web provider seams

### Web provider injection tests failed before the seam existed

- **Symptom:** New tests passed `provider` objects to `createWebFetchTool`
  and `createWebSearchTool`, but the tools ignored them and still ran the
  default network code path.
- **Diagnosis:** The earlier web-tool implementation supported endpoint and
  `fetchImpl` injection for tests, but the tool execution logic was still
  tightly coupled to the built-in HTTP/DuckDuckGo implementations.
- **Fix:** Added `WebFetchProvider` and `WebSearchProvider` interfaces,
  moved the existing network implementations into default HTTP providers,
  and kept parsing, validation, timeout signaling, deterministic formatting,
  and model-visible schemas in the tool factories.
- **Verification:** Targeted web fetch/search tests and `bunx tsc --noEmit`
  passed after the refactor.

### Review found provider paths bypassed shared safety invariants

- **Symptom:** Review found injected `WebFetch` providers could receive
  non-HTTP, credentialed, or private-network URLs, and could return bodies
  larger than `max_bytes`. Injected `WebSearch` providers also bypassed
  the default deduplication path.
- **Diagnosis:** The first provider-seam refactor moved too much behavior
  into providers; the model-visible contract should remain enforced by the
  tool factory regardless of backend.
- **Fix:** Moved `WebFetch` URL policy back before provider calls, added
  final fetch-body cap enforcement after provider responses, hard-raced
  provider calls against `timeout_ms`, and deduped provider search results
  before formatting.
- **Verification:** Added injected-provider regression coverage for URL
  policy, output caps, and search deduplication; targeted tests and
  typecheck passed.
