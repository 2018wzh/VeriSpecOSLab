# Repository Guidelines

## Project Structure & Module Organization

This repository is a spec-first OS lab platform. `docs/design/` contains the design source for specs, workflow, platform, toolchain, and agent boundaries. `examples/xv6-spec/` is the reference xv6-style lab project with `spec/`, kernel/user stubs, and `.vos/` runtime artifacts. `vos/` is the Bun workspace; active apps are `vos/apps/vos-cli` for the `vos` command and `vos/apps/vos-agent` for the headless/TUI/HTTP agent backend. Tests live beside each app under `tests/`.

## Build, Test, and Development Commands

Run workspace commands from `vos/`:

```sh
bun install          # install workspace dependencies
bun run typecheck    # typecheck vos-cli and vos-agent
bun run test         # run both app test suites
bun run build        # compile release binaries
bun run vos -- --help # run the CLI entrypoint
bun run dev:agent    # start vos-agent HTTP server on 127.0.0.1:8787
```

For focused work, run `bun test` or `bun run typecheck` inside `vos/apps/vos-cli` or `vos/apps/vos-agent`.

## Coding Style & Naming Conventions

Use TypeScript ESM with explicit `.ts` imports and `import type` for type-only imports. Follow the existing style: two-space indentation, double quotes, and trailing commas. Keep modules narrowly scoped: CLI parsing in `app/cli.ts`, command orchestration in `app/main.ts`, runtime behavior under `app/runtime/`, and agent integration under `app/agent/`. Prefer deterministic runtime checks over prompt-only enforcement.

## Testing Guidelines

Tests use Bun’s built-in test runner. Name tests `*.test.ts` and place them under the owning app’s `tests/` tree, for example `vos/apps/vos-cli/tests/xv6-offline-flow.test.ts`. Add focused unit tests for parsers, schemas, and policy gates; add integration-style tests for build/run/verify or agent flows. Before handing off code, run `bun run typecheck` and `bun run test` from `vos/`.

## Commit & Pull Request Guidelines

Recent commits use bracketed scopes such as `[vos][cli] Fix xv6 offline runtime` and `[docs][agent] Document headless profile API`. Use the same pattern: `[area][component] Imperative summary`. Pull requests should describe the behavioral change, list tests run, note affected docs/specs, and call out any generated `.vos/` artifacts or local-only files.

## Agent-Specific Instructions

The root guide applies repo-wide. For `vos/apps/vos-agent`, also follow the more detailed local guide at `vos/apps/vos-agent/AGENTS.md`, especially provider, tool, and headless API rules.
