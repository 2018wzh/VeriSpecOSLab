# `vos` v0.2 TODO

## Current Goal

Reach a `spec -> codegen -> build -> run qemu` smoke-complete workflow with ToolchainSpec support and CLI progress display.

## P0

- [x] Enforce provider config safety
- [x] Parse `spec/toolchain/toolchain.yaml`
- [x] Implement `vos toolchain lint`
- [x] Make `vos build` ToolchainSpec-first
- [x] Implement `vos run qemu`
- [x] Implement `vos pipeline smoke --apply`
- [x] Add runtime progress events and CLI progress rendering
- [x] Persist `toolchain-resolved.json`, `build.log`, `qemu.log`, `smoke-result.json`
- [x] Replace the shim demo with a real `riscv64` bootable kernel example

## P1

- [x] Upgrade the example into a real boot demo with deterministic artifacts
- [ ] Improve prompt contract with toolchain-aware context
- [ ] Harden generated code extraction and editable-region diagnostics
- [ ] Document end-to-end demo usage

## P2

- [ ] Multi-profile ToolchainSpec support
- [ ] Split `toolchain.yaml` into per-contract files
- [ ] Richer evidence model and manifests
- [ ] Verification DAG and public test orchestration
- [ ] Validator retry loop and repair flow

## Current Blockers

- [x] Real QEMU-backed boot skeleton exists for `riscv64 + OpenSBI default`
- [ ] Provider compatibility is restricted to `openai-compatible` semantics

## Acceptance Checklist

- [x] `vos doctor` validates provider config sanely
- [x] `vos toolchain lint` succeeds on the example
- [x] `vos spec lint --module boot --operation boot_banner` succeeds
- [ ] `vos codegen run --apply --module boot --operation boot_banner` builds the system
- [x] `vos run qemu` detects `VOS_BOOT_OK`
- [ ] `vos pipeline smoke --apply --module boot --operation boot_banner` completes end-to-end

## Known Design Debt

- Build adapter fallback still exists for non-ToolchainSpec projects
- The demo boot path is a minimal real kernel, not yet a full teaching OS
- The runtime still emits minimal evidence rather than the final `RunManifest` model
