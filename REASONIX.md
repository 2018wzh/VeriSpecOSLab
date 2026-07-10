# REASONIX.md

## Stack

- **Runtime:** Bun ≥1.3, TypeScript ESM, no Node-only deps
- **Framework:** Bun workspaces monorepo (`vos/` root)
- **Validation:** zod v4
- **Config:** yaml
- **Templates:** handlebars
- **Agent LLM:** Anthropic Messages API + OpenAI-compatible endpoints

## Layout

```
docs/                User manual, design docs, portal docs
examples/xv6-spec/   Reference xv6-style OS lab (spec/, kernel/, user/)
vos/
  apps/vos-cli/      CLI entrypoint (`vos` command)
  apps/vos-agent/    Agent backend (TUI + OpenAI-compatible HTTP server)
  apps/vos-web/      Portal prototype
  packages/vos-core/     Shared core (typed commands, build/run/verify)
  packages/vos-runtime/  Execution primitives
  packages/vos-server/   Sandbox HTTP API
  packages/vos-kb/       Knowledge base
  packages/vos-spec/     Spec handling
```

`spec/` is the design truth source inside each lab project.
`.vos/` dirs contain runtime artifacts (cache, runs, policy) — don't
edit by hand.

## Commands

All run from `vos/`:

```sh
bun install                      # install workspace deps
bun run typecheck                # typecheck all packages & apps
bun run test                     # run all workspace tests
bun run build                    # build workspace applications locally
bun link                         # run from apps/vos-cli to link the local CLI
bun run vos -- --help            # CLI entrypoint
bun run dev:agent                # vos-agent HTTP server on 127.0.0.1:8787
bun run dev:web                  # vos-web dev server
```

Per-package (inside `vos/packages/<pkg>` or `vos/apps/<app>`):
```sh
bun test                         # run that package's tests
bunx tsc --noEmit                # typecheck just that package
```

## Conventions

- **Commits:** `[area][component]` prefix (e.g. `[vos][agent]`, `[docs][design]`)
- **Imports:** `.ts` extensions, `import type` for type-only
- **Style:** two-space indent, double quotes, trailing commas
- **TSConfig:** `verbatimModuleSyntax:true`, `moduleResolution:bundler`,
  `strict:true`, `noEmit:true`, target ES2022
- **Tests:** Bun runner, `tests/` subdir per module, `*.test.ts` naming
- **Tool contract:** Agent tools must return a string, never throw on
  expected failures — the agent loop relies on this

## Watch out for

- Bun APIs only — no `node:fs` etc. unless you confirm Bun compat
- Agent loop has `maxIterations` (default 50); raise at call site if
  a task legitimately needs more, never remove the guard
- Tools and the agent loop never print to stdout — only `main.ts` does
- `.vos/` and `.vos-agent/` are generated runtime dirs
- Typecheck before claiming correctness: `bunx tsc --noEmit && bun test`
