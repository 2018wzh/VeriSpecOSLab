FROM oven/bun:1.3.14-alpine AS build
WORKDIR /workspace/vos
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
RUN bun install --frozen-lockfile --ignore-scripts --registry https://registry.npmjs.org
COPY packages ./packages
COPY apps ./apps
RUN bun run --cwd apps/vos-portal build

FROM oven/bun:1.3.14-alpine
RUN addgroup -S portal && adduser -S portal -G portal
WORKDIR /workspace/vos
COPY --from=build /workspace/vos /workspace/vos
USER portal
EXPOSE 8787
ENTRYPOINT ["bun", "run", "apps/vos-portal/server/main.ts"]
CMD ["serve"]
