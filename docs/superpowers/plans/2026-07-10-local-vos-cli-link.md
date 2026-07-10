# Local vos-cli Link Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the root CLI release/distribution pipeline and make the workspace `vos/apps/vos-cli` package the only installable CLI through `bun link`.

**Architecture:** Keep the `vos/` Bun workspace and its internal development/test/build scripts. Delete the root npm wrapper, `vos-bin` release downloader, release workflow, and release-only tests/scripts. Update all user and contributor documentation to install from `vos/apps/vos-cli` with `bun link`.

**Tech Stack:** Bun workspaces, TypeScript, Markdown, GitHub Actions configuration, Bun test.

## Global Constraints

- Do not alter the project’s internal OS build/run/test/verify commands.
- Do not retain silent fallback from the CLI to a downloaded or prebuilt binary.
- Installation documentation must use `bun link` from `vos/apps/vos-cli`.
- Preserve unrelated pre-existing worktree changes.
- Do not embed machine-specific absolute paths in repository files.

---

### Task 1: Remove the release/distribution surface

**Files:**
- Delete: `package.json`
- Delete: `bin/vos.js`
- Delete: `scripts/build.ts`
- Delete: `scripts/tests/build.test.ts`
- Delete: `scripts/tests/release-package.test.mjs`
- Delete: `vos/packages/vos-bin/package.json`
- Delete: `vos/packages/vos-bin/scripts/install.mjs`
- Delete: `vos/packages/vos-bin/scripts/runtime.mjs`
- Delete: `vos/packages/vos-bin/tests/install.test.mjs`
- Delete: `.github/workflows/stable.yml`
- Modify: `vos/package.json`

**Interfaces:**
- Consumes: Existing workspace package graph.
- Produces: A workspace with `vos/apps/vos-cli` as the only CLI package and no release downloader/package dependency.

- [ ] Remove the root package and release-only files listed above.
- [ ] Remove `packages/vos-bin` from the Bun workspace package list.
- [ ] Confirm no remaining package manifest depends on `vos-bin` or exposes a root release entrypoint.

### Task 2: Add regression coverage for the local-link install contract

**Files:**
- Create: `vos/apps/vos-cli/tests/package-contract.test.ts`

**Interfaces:**
- Consumes: `vos/apps/vos-cli/package.json`.
- Produces: A deterministic contract test proving the CLI package name, `vos` binary, and absence of release-only lifecycle hooks.

- [ ] Write a failing test that reads the CLI package manifest and asserts `name === "vos-cli"`, `bin.vos === "./app/main.ts"`, and no `postinstall`/`preinstall` script.
- [ ] Run `bun test apps/vos-cli/tests/package-contract.test.ts` from `vos/` and verify the test fails if the contract is not represented.
- [ ] Keep the test focused on the package contract; do not add a fake installer or downloaded binary fixture.
- [ ] Run the same focused test and verify it passes against the existing `vos-cli` manifest.

### Task 3: Rewrite installation and contributor documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `REASONIX.md`
- Modify: `docs/manual/README.md` and the manual pages that describe CLI installation.
- Modify: `docs/manual/vos/01-overview.md`
- Modify: `docs/manual/labs/lab1-seed.md`
- Modify: `docs/manual/appendices/dev-environment.md`

**Interfaces:**
- Consumes: The local-link installation contract from Task 1.
- Produces: Consistent user-facing instructions: install workspace dependencies from `vos/`, then run `bun link` in `vos/apps/vos-cli`; no npm/GitHub release/update claims.

- [ ] Replace global package installation examples with the repository-local command:
  `cd vos/apps/vos-cli` followed by `bun link`.
- [ ] Explain that the linked `vos` command follows the current checkout and changes are picked up after restarting the command; do not describe runtime self-update.
- [ ] Remove references to `vos-bin`, prebuilt platform assets, npm publishing, fixed released versions, and release upgrades.
- [ ] Preserve all commands referring to the student project’s internal `vos build`, `run`, `test`, and `verify` operations.
- [ ] Search all tracked documentation for stale release/install claims and update every user-facing occurrence.

### Task 4: Verify the cleaned workspace

**Files:**
- Modify: Any files required to correct verification failures from Tasks 1–3.

**Interfaces:**
- Consumes: Cleaned package graph, documentation, and contract test.
- Produces: Fresh evidence that the workspace is type-safe, tests pass, and release-only references are absent.

- [ ] Run `rg -n -i "vos-bin|npm publish|npm pack|GitHub Release|stable-release|bun add --global vos|VOS_COMMAND_VERSION|release asset|prebuilt"` across tracked source/docs and resolve every release/distribution match outside historical design prose that is intentionally unrelated.
- [ ] Run `bun install --ignore-scripts` from `vos/`.
- [ ] Run `bun run typecheck` from `vos/`.
- [ ] Run `bun run test` from `vos/`.
- [ ] Run `git diff --check` and inspect `git status --short` to ensure only intended changes and the pre-existing untracked files remain.
