# Minimal `vos` Real Boot Demo

This example is the v0 real-boot target for `vos`.

It contains:

- `spec/modules/boot/...` for operation-bound boot code generation
- `spec/toolchain/toolchain.yaml` for build and run orchestration
- `demo/` as the editable `no_std` boot banner crate
- `boot/` as the bootable RISC-V kernel crate
- `scripts/build-system.ps1` to build a bare-metal ELF artifact
- `.vos/config.toml` for provider and workspace configuration

Typical flow:

```sh
cargo run -p vos-cli -- --project-root ..\examples\xv6-spec --json toolchain lint
cargo run -p vos-cli -- --project-root ..\examples\xv6-spec --json spec lint spec\modules\boot\ops\boot_banner.yaml
cargo run -p vos-cli -- --project-root ..\examples\xv6-spec --json build
cargo run -p vos-cli -- --project-root ..\examples\xv6-spec --json run qemu
```
