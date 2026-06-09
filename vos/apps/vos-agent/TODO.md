# VOS Agent Roadmap TODOs

This checklist captures the remaining Amp-like roadmap after the current
VOS Agent milestones. Keep each item agent-friendly: start with tests, make
the smallest correct implementation, run validation, review, update docs,
then mark the checkbox.

## P0 — Automation and stream protocol parity

- [x] Implement Claude/Amp-compatible `--stream-json` event shapes.
  - [x] Add tests for init, user, assistant text, tool use, tool result,
        final result, and structured error events.
  - [x] Keep stdout JSONL-only when `--stream-json` is enabled.
  - [x] Document the event schema with examples.
- [x] Add `--stream-json-input` for scripted multi-turn automation.
  - [x] Parse newline-delimited JSON user messages from stdin.
  - [x] Reuse one local thread until stdin closes.
  - [x] Return structured errors for malformed input lines.

## P1 — Local thread workflow parity

- [x] Add `stars threads continue <id>` as a first-class alias for
      resuming a local thread.
- [x] Add `stars threads archive <id>` and list filtering for archived
      threads.
- [x] Add `stars threads fork <id>` to copy a transcript into a new local
      thread.
- [x] Add tests that resumed threads preserve stored model/mode unless an
      explicit override is provided.

## P1 — Settings and tool policy

- [x] Add user/workspace settings loading.
  - [x] Support disabling tools such as `Bash`.
  - [x] Support workspace-local defaults for mode/model.
  - [x] Keep env vars and CLI flags higher precedence than settings.
- [x] Add a tool policy hook around `ToolRegistry.execute`.
  - [x] Return policy-denied strings instead of throwing.
  - [x] Cover policy behavior with deterministic unit tests.

## P2 — Better interactive TUI

- [x] Render assistant/tool/session status in a clearer terminal UI.
- [x] Show current thread, mode, and active tool calls during long runs.
- [x] Add tests for non-network REPL command behavior and error recovery.

## P2 — Project custom commands

- [x] Load project commands from `.agents/commands/*.md`.
- [x] Expand command arguments into prompts.
- [x] Add slash-command tests for success, missing command, and invalid
      command definitions.

## P3 — Plugin and MCP integration

- [x] Design a plugin manifest and loading lifecycle.
- [x] Add MCP server configuration and tool registration.
- [x] Keep plugins testable with local fake servers and no external network.
- [ ] Later validation: add a real `mcp_gdb` integration test when a
      runnable stdio MCP server is installed; keep fake server tests for
      deterministic CI.

## P3 — Richer input and external context tools

- [x] Add web fetch/search tools behind explicit tool schemas.
- [x] Keep `WebFetch`/`WebSearch` provider seams easy to replace.
- [ ] Deferred future work: evaluate a concrete provider-backed search/fetch
      implementation such as Parallel (https://parallel.ai/).
- [x] Add provider capability tests before exposing multimodal input in the
      CLI.
- [x] Add internal image/PDF input handling where provider translation
      supports it.
- [ ] Expose image/PDF input in the CLI/TUI/stream-json surfaces after UX and
      schema design.
