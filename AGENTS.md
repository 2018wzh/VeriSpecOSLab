# Repository Guidelines

## Project Structure & Module Organization

This repository is a spec-first OS lab platform. `docs/design/` contains the design source for specs, workflow, platform, toolchain, and agent boundaries. `examples/xv6-spec/` is the reference xv6-style lab project with `spec/`, kernel/user stubs, and `.vos/` runtime artifacts. `vos/` is the Bun workspace. Active apps are `vos/apps/vos-cli` for the command entrypoint, `vos/apps/vos-agent` for the headless/TUI/HTTP agent backend, and `vos/apps/vos-web` for the portal prototype. Package-level logic now also lives in `vos/packages/*` (including the newly split `vos-server` façade).

## Build, Test, and Development Commands

Run workspace commands from `vos/`:

```sh
bun install          # install workspace dependencies
bun run typecheck    # typecheck all workspace packages and apps
bun run test         # run all workspace tests
bun run build        # compile release binaries
bun run vos -- --help # run the CLI entrypoint
bun run dev:agent    # start vos-agent HTTP server on 127.0.0.1:8787
```

For focused work, run `bun test` or `bun run typecheck` inside `vos/packages/<pkg>` or `vos/apps/<app>`.

## Coding Style & Naming Conventions

Use TypeScript ESM with explicit `.ts` imports and `import type` for type-only imports. Follow the existing style: two-space indentation, double quotes, and trailing commas. Keep modules narrowly scoped: command parsing in `app/cli.ts`, bootstrap/dispatch in `app/bootstrap.ts` and `app/dispatch.ts`, command handlers in `app/commands/*`, and package-level boundaries in `vos/packages/*`. Prefer deterministic runtime checks over prompt-only enforcement.

## Testing Guidelines

Tests use Bun’s built-in test runner. Name tests `*.test.ts` and place them under the owning module’s `tests/` tree, for example `vos/apps/vos-cli/tests/xv6-offline-flow.test.ts` or `vos/packages/vos-evidence/tests/writer.test.ts`. Add focused unit tests for parsers, schemas, and policy gates; add integration-style tests for build/run/verify or agent flows. Before handing off code, run `bun run typecheck` and `bun run test` from `vos/`.

## Commit & Pull Request Guidelines

Recent commits use bracketed scopes such as `[vos][cli] Fix xv6 offline runtime` and `[docs][agent] Document headless profile API`. Use the same pattern: `[area][component] Imperative summary`. Pull requests should describe the behavioral change, list tests run, note affected docs/specs, and call out any generated `.vos/` artifacts or local-only files.

## Agent-Specific Instructions

The root guide applies repo-wide. For `vos/apps/vos-agent`, also follow the more detailed local guide at `vos/apps/vos-agent/AGENTS.md`, especially provider, tool, and headless API rules.
