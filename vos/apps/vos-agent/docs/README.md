# Documentation

This directory contains the formal documentation for VOS Agent.
The documents are intended to be read in order on first contact, but
each one stands on its own as a reference.

## Contents

1. [**Getting started**](getting-started.md) — install, configure, run
   interactive/headless VOS Agent, and write a custom tool in fewer than
   fifty lines.
2. [**Architecture**](architecture.md) — module layout, dependency
   graph, and the design rules that keep the agent loop testable.
3. [**The agent loop**](agent-loop.md) — semantics of the conversation
   loop, message lifecycle, termination conditions, and safety bounds.
4. [**Tools and the registry**](tools.md) — the `Tool` contract, schema
   requirements, error policy, and the built-in tool reference.
5. [**Configuration**](configuration.md) — settings files, plugin/MCP
   manifests, environment variables, provider compatibility, and
   programmatic configuration.
6. [**Local thread workflow**](threads.md) — list, continue, archive,
   and fork local conversation threads.
7. [**Stream JSON automation**](stream-json.md) — JSONL output/input
   schemas for scripted integrations.
8. [**Error logbook**](error-log.md) — implementation errors and fixes
   recorded during agent build loops.
9. [**Testing**](testing.md) — strategy, the four test layers, and the
   stub `ChatClient` helpers used to drive scenarios deterministically.
10. [**TUI evaluation**](tui-evaluation.md) — tmux setup, manual UX
    checklist, latency benchmarks, and feedback template for the VOS Agent
    terminal UI.
11. [**TypeScript CLI wrapper design**](../../../../docs/design/agent/10-typescript-cli-wrapper.md)
    — how `vos agent <subcommand>` should call VOS Agent through
    versioned fixed prompts while keeping policy, patch gates, and
    evidence deterministic.

## Conventions used in these docs

- Code paths are written relative to the repository root and link to
  the actual file: e.g. [app/main.ts](../app/main.ts).
- Example shell sessions use `$` to denote the prompt.
- Type names refer to the exports in the source unless noted otherwise.
