# Repository Guidelines

## Project Structure & Module Organization

This repository is a spec-first OS lab platform. The student contract is the v2 five-file-family model: `spec/design.yaml`, `spec/modules/*.yaml`, `spec/interfaces/*.yaml`, optional `spec/goals/*.yaml`, and handwritten `spec/patches/*.yaml`. `vos.yaml` is the structured execution projection and must never be treated as a shell script. `examples/xv6-spec/` is a complete-source reference submodule; its local source is not a security boundary. `vos/` is the Bun workspace. Active apps are `vos/apps/vos-cli` for the command entrypoint, `vos/apps/vos-agent` for the in-process headless/TUI backend and temporary internal HTTP service, and `vos/apps/vos-portal` for the retained frozen Portal API, worker, Web UI, and isolated static Demo build. Do not reintroduce the retired Portal prototype or promise the old connected teaching loop. Shared packages are limited to `vos-core`, `vos-runtime`, `vos-kb`, `vos-spec`, and `vos-server`.

## Build, Test, and Development Commands

Run workspace commands from `vos/`:

```sh
bun install --ignore-scripts # install workspace dependencies
bun run typecheck    # typecheck all workspace packages and apps
bun run test         # run all workspace tests
bun run build        # build workspace applications locally
bun run vos -- --help # run the CLI entrypoint
bun run dev:agent    # start vos-agent HTTP server on 127.0.0.1:8787
```

For focused work, run `bun test` or `bun run typecheck` inside `vos/packages/<pkg>` or `vos/apps/<app>`.

The supported CLI installation path is `bun link` from `vos/apps/vos-cli`. The linked `vos` command always targets this checkout. Do not add a second root package, release downloader, prebuilt binary path, or runtime update mechanism.

## Coding Style & Naming Conventions

Use TypeScript ESM with explicit `.ts` imports and `import type` for type-only imports. Follow the existing style: two-space indentation, double quotes, and trailing commas. Keep modules narrowly scoped: `vos-cli` is a thin entrypoint, shared typed command execution lives in `vos-core`, execution primitives live in `vos-runtime`, and the typed Portal sandbox HTTP API lives in `vos-server`. Prefer deterministic runtime checks over prompt-only enforcement.

## Testing Guidelines

Tests use Bun’s built-in test runner. Name tests `*.test.ts` and place them under the owning module’s `tests/` tree, for example `vos/packages/vos-core/tests/xv6-offline-flow.test.ts` or `vos/packages/vos-server/tests/http.test.ts`. Add focused unit tests for parsers, schemas, and policy gates; add integration-style tests for build/run/verify or agent flows. Before handing off code, run `bun run typecheck` and `bun run test` from `vos/`.

## Dirty Worktree & Reproducibility Gates

The public student surface is intentionally small: `init`, `doctor`, `spec check`, the seven `agent` roles (`design`, `spec`, `implement`, `debug`, `verify`, `kb`, `review`), `build`, `run qemu`, `run hardware`, `verify`, `report`, and `submit`. Keep clean tree and current `HEAD` ledger gates for `verify`, `agent implement`, authoritative hardware evidence, and `submit`. Dirty `build` and development QEMU/hardware runs are allowed but their evidence is marked non-submittable. `design` and `spec` require confirmation before an atomic commit. `debug`, `verify`, `review`, and `kb` must not modify project files.

The Agent implementation worktree is a detached linked Git worktree. It protects the original tree from failed patches and ownership violations; it is not a process, network, credentials, or host-filesystem sandbox. Host commands inherit the current user and network by design. Keep this limitation explicit in code, tests, and docs.

## Commit & Pull Request Guidelines

Recent commits use bracketed scopes such as `[vos][cli] Simplify student workflow` and `[docs][spec] Document ModuleSpec v2`. Use the same pattern: `[area][component] Imperative summary`. This branch is pushed without creating or merging a PR. Describe the behavioral change, list tests run, note affected docs/specs, and call out generated `.vos/` artifacts or local-only files.

## Agent-Specific Instructions

The root guide applies repo-wide. For `vos/apps/vos-agent`, also follow the more detailed local guide at `vos/apps/vos-agent/AGENTS.md`, especially provider, tool, and headless API rules.

When editing existing Chinese documentation with `humanizer-zh`, default to a light language pass. Preserve technical facts, examples, section structure, information density, and the author’s level of certainty. Fix translationese, mechanical phrasing, punctuation, and local repetition only. Do not delete or reorganize substantive content unless the task explicitly requests structural rewriting; if a contract has changed, migrate the affected explanation instead of replacing an entire chapter with a summary.
