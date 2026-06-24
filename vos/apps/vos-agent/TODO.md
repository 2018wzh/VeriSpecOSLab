# VOS Agent Roadmap TODOs

This checklist captures the remaining Amp-like roadmap after the current
VOS Agent milestones. Keep each item agent-friendly: start with tests, make
the smallest correct implementation, run validation, review, update docs,
then mark the checkbox.

## P0 — VOS course runtime integration

- [ ] Add the TypeScript `vos` package boundary described in
      `docs/design/toolchain/03-runtime-modules.md`.
  - [ ] Keep the shared package set limited to `vos-core`, `vos-runtime`,
        `vos-kb`, `vos-spec`, and `vos-server`.
  - [ ] Keep shared contracts such as `RunManifest`, `CommandOutcome`,
        `ContextBundle`, `PlanDraft`, and `AICollaborationLog` in
        `vos-core`.
- [ ] Implement deterministic `vos agent context`.
  - [ ] Load project, stage, policy, spec snippets, and recent evidence.
  - [ ] Return a visibility-scoped `ContextBundle` without calling the LLM.
  - [ ] Exclude hidden tests, staff-only rubrics, and other students' code.
- [ ] Implement deterministic `vos agent log`.
  - [ ] Record fixed prompt id/version, context refs, tool calls, patch refs,
        evidence refs, and risk flags.
  - [ ] Store records in `.vos/runs/<run-id>/` and the project audit index.
- [ ] Add a course-mode tool registry.
  - [ ] Hide free `Bash`, `Write`, and `Edit` from the model.
  - [ ] Expose only read-only context tools and a policy-checked `Vos` tool.

## P1 — `vos agent` wrapper and fixed prompts

- [ ] Implement `vos agent plan` as a wrapper around `vos-agent`.
  - [ ] Build `PromptEnvelope` from `ContextBundle`.
  - [ ] Use versioned `GatewayAgent` / `SpecAssistant` fixed prompts.
  - [ ] Validate and return `PlanDraft`.
- [ ] Implement `vos agent generate` as patch proposal generation.
  - [ ] Use versioned `SpecCompiler` fixed prompts.
  - [ ] Require operation or module-slice spec bindings.
  - [ ] Validate `changed_paths`, `bound_clauses`, and output schema.
  - [ ] Do not apply files by default.
- [ ] Implement deterministic `vos agent apply-patch`.
  - [ ] Check policy, spec binding, allowed paths, and patch impact.
  - [ ] Apply accepted diffs only after gate success.
  - [ ] Run the minimum validation DAG and write evidence.
- [ ] Implement `vos agent debug` as a wrapper around `vos-agent`.
  - [ ] Feed `DiagnosticReport`, recent evidence, related specs, and recent
        patch refs into a versioned `DebugAgent` fixed prompt.
  - [ ] Validate the returned failure class, suspected clauses, and next
        command suggestion.

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
