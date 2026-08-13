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
    bun install --frozen-lockfile --ignore-scripts --registry https://registry.npmjs.org --filter vos-cli

FROM oven/bun:1.3.14-debian
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates gcc g++ gcc-riscv64-linux-gnu binutils-riscv64-linux-gnu git make python3 qemu-system-misc xz-utils \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 runner \
  && useradd --uid 10001 --gid runner --no-create-home --home-dir /tmp/runner-home runner
WORKDIR /opt/vos
COPY --from=dependencies /opt/vos /opt/vos
COPY packages ./packages
COPY apps/vos-agent ./apps/vos-agent
COPY apps/vos-cli ./apps/vos-cli
COPY apps/vos-demo ./apps/vos-demo
USER 10001:10001
CMD ["bun", "run", "apps/vos-cli/app/main.ts", "--help"]
