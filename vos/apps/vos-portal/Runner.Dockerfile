FROM oven/bun:1.3.14-debian AS dependencies
WORKDIR /opt/vos
COPY package.json bun.lock bunfig.toml ./
COPY packages/vos-core/package.json ./packages/vos-core/
COPY packages/vos-kb/package.json ./packages/vos-kb/
COPY packages/vos-platform/package.json ./packages/vos-platform/
COPY packages/vos-runtime/package.json ./packages/vos-runtime/
COPY packages/vos-server/package.json ./packages/vos-server/
COPY packages/vos-spec/package.json ./packages/vos-spec/
COPY apps/vos-agent/package.json ./apps/vos-agent/
COPY apps/vos-cli/package.json ./apps/vos-cli/
COPY apps/vos-demo/package.json ./apps/vos-demo/
COPY apps/vos-portal/package.json ./apps/vos-portal/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    sed -i 's#https://registry.npmmirror.com/#https://registry.npmjs.org/#g' bun.lock \
    && bun install --frozen-lockfile --ignore-scripts --registry https://registry.npmjs.org --filter vos-cli

FROM oven/bun:1.3.14-debian
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates clang curl gcc g++ gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu git lld make python3 qemu-system-misc xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 runner \
  && useradd --uid 10001 --gid runner --no-create-home --home-dir /tmp/runner-home runner
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends llvm python-is-python3 \
  && rm -rf /var/lib/apt/lists/*
ENV RUSTUP_HOME=/opt/rustup \
    CARGO_HOME=/opt/cargo \
    CC_riscv64gc_unknown_none_elf=riscv64-unknown-elf-gcc \
    AR_riscv64gc_unknown_none_elf=riscv64-unknown-elf-ar \
    PATH=/opt/cargo/bin:/opt/riscv/bin:$PATH
ARG RUST_TOOLCHAIN=1.88.0
ARG RISCV_XPACK_URL=https://github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack/releases/download/v14.2.0-3/xpack-riscv-none-elf-gcc-14.2.0-3-linux-x64.tar.gz
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "$RUST_TOOLCHAIN" \
  && rustup target add riscv64gc-unknown-none-elf \
  && (rustup toolchain install nightly --profile minimal \
      --component rust-src --component llvm-tools --component rustfmt \
      --target riscv64gc-unknown-none-elf \
    || RUSTUP_DIST_SERVER=https://mirrors.tuna.tsinghua.edu.cn/rustup \
       RUSTUP_UPDATE_ROOT=https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup \
       rustup toolchain install nightly --profile minimal \
      --component rust-src --component llvm-tools --component rustfmt \
      --target riscv64gc-unknown-none-elf) \
  && rustup toolchain list | grep -q nightly \
  && mkdir -p /opt/riscv \
  && curl -fsSL "$RISCV_XPACK_URL" | tar -xz -C /opt/riscv --strip-components=1 \
  && for tool in /opt/riscv/bin/riscv-none-elf-*; do ln -s "$tool" "/usr/local/bin/riscv64-unknown-elf-${tool##*/riscv-none-elf-}"; done \
  && chmod -R a+rX /opt/rustup /opt/cargo /opt/riscv
COPY apps/vos-portal/runner-cache/glenda-cargo-registry.tar.gz /tmp/glenda-cargo-registry.tar.gz
RUN tar -xzf /tmp/glenda-cargo-registry.tar.gz -C /opt/cargo \
  && rm /tmp/glenda-cargo-registry.tar.gz \
  && chmod -R a+rX /opt/cargo
ENV CARGO_NET_OFFLINE=true
WORKDIR /opt/vos
COPY --from=dependencies /opt/vos /opt/vos
COPY packages ./packages
COPY apps/vos-agent ./apps/vos-agent
COPY apps/vos-cli ./apps/vos-cli
COPY apps/vos-demo ./apps/vos-demo
USER 10001:10001
CMD ["bun", "run", "apps/vos-cli/app/main.ts", "--help"]
