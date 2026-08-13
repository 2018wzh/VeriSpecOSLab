# Repository Guidelines

## Project Structure & Module Organization

This repository is a spec-first OS lab platform. The student contract is the v2 five-file-family model: `spec/design.yaml`, `spec/modules/*.yaml`, `spec/interfaces/*.yaml`, optional `spec/goals/*.yaml`, and handwritten `spec/patches/*.yaml`. `vos.yaml` is the structured execution projection and must never be treated as a shell script. `examples/xv6-spec/` is a complete-source reference submodule; its local source is not a security boundary. `vos/` is the Bun workspace. Active apps are `vos/apps/vos-cli` for the command entrypoint, `vos/apps/vos-agent` for the in-process headless/TUI backend and temporary internal HTTP service, and `vos/apps/vos-portal` for the production Portal API, worker, Web UI, Runner and isolated static Demo build. Public online operations exist only below `vos portal`; do not restore retired top-level online aliases. Shared packages are limited to `vos-core`, `vos-runtime`, `vos-kb`, `vos-spec`, and `vos-server`.

The `examples/xv6-spec` main branch is an orphan-root Lab 1-10 course history. Preserve annotated `course/lab1-complete` through `course/lab8-complete` and the explicitly unaccepted `course/lab9-candidate` / `course/lab10-candidate` boundary. A course tag must not contain future paths, identifiers, tests, placeholders, or terminology; run the submodule history audit after any rewrite. Physical VisionFive 2 four-hart `usertests` plus human review are required before candidate tags can become complete.

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

The public student surface is intentionally small: `init`, `doctor`, deterministic `spec lint [<Spec ID|path|design|all>]`, command-managed knowledge through `kb add/list/search/remove/clear/export-manifest/import-manifest`, `agent config`, and the `agent` roles `implement`, `debug`, `verify`, `ask`, and `review`, plus `build`, `run qemu`, `run hardware`, `verify [--hidden]`, `report`, and `submit`. Students discuss choices with `agent ask`, handwrite Specs, run lint and read-only `agent review`, revise them, and commit with ordinary Git commands. Keep clean tree and current `HEAD` ledger gates for `verify`, `agent implement`, authoritative hardware evidence, and `submit`. Dirty `build` and development QEMU/hardware runs are allowed but their evidence is marked non-submittable. `debug`, `verify`, `review`, and `ask` must not modify project files. Doctor invokes the Debug Agent to derive and probe project tools but treats provider unavailability as a warning.

The Agent implementation worktree is a detached linked Git worktree. It protects the original tree from failed patches and ownership violations; it is not a process, network, credentials, or host-filesystem sandbox. Host commands inherit the current user and network by design. Keep this limitation explicit in code, tests, and docs.

`vos portal bind` is the only student command that makes the online project binding durable: it
tracks `.vos/project.yaml` by narrowing the `.vos/*` ignore rule and requires the student to
commit that file. The binding metadata never changes the offline student-v2 command path; only
the explicit `vos portal` namespace may contact Portal.

Portal authentication supports local accounts, OIDC, and standard OAuth 2.0 Authorization Code +
PKCE. OAuth providers use explicit HTTPS authorization/token/UserInfo endpoints; access tokens stay
server-side and roles are limited to teacher, TA, or student. Do not add frontend token storage,
implicit/password grants, or Demo OAuth credentials.

Structured Agent results must be submitted through the declared runtime tool. A rejected schema or semantic submission is returned to the same model thread as a tool error, with the normal tools restored so the Agent can inspect, repair, and resubmit. Do not treat `failed`, `partial`, or `blocked` implementation payloads as successful completion, and do not bypass this loop by parsing prose.

A committed SpecPatch grants each affected module one cross-module `owns` implementation. Landing a module consumes that module's grant without preventing the remaining affected modules from being implemented. Historical patches must not accumulate into a permanent writable-path union; a later change to an already implemented module requires a new handwritten and committed SpecPatch. Stable target IDs declared in ModuleSpec property text or `check` fields are mandatory structured-result bindings, not optional suggestions.

## Commit & Pull Request Guidelines

Recent commits use bracketed scopes such as `[vos][cli] Simplify student workflow` and `[docs][spec] Document ModuleSpec v2`. Use the same pattern: `[area][component] Imperative summary`. This branch is pushed without creating or merging a PR. Describe the behavioral change, list tests run, note affected docs/specs, and call out generated `.vos/` artifacts or local-only files.

## Agent-Specific Instructions

The root guide applies repo-wide. For `vos/apps/vos-agent`, also follow the more detailed local guide at `vos/apps/vos-agent/AGENTS.md`, especially provider, tool, and headless API rules.

When editing existing Chinese documentation with `humanizer-zh`, default to a light language pass. Preserve technical facts, examples, section structure, information density, and the author’s level of certainty. Fix translationese, mechanical phrasing, punctuation, and local repetition only. Do not delete or reorganize substantive content unless the task explicitly requests structural rewriting; if a contract has changed, migrate the affected explanation instead of replacing an entire chapter with a summary.
