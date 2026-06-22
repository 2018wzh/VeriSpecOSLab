# VOS Portal Development Docs

`vos-portal` is the course platform surface for VeriSpecOSLab and the future
SpecLab platform family. It connects course rules, staged projects, VOS evidence,
scoring, and Agent audit into one workflow.

The current implementation is a TypeScript skeleton rather than the final
production platform:

- `vos/apps/vos-agent`: Bun backend that serves the OpenAI-compatible Agent
  Gateway and the Portal REST API with a demo in-memory store.
- `vos/apps/vos-web` (current `vos-portal` prototype): React/Vite portal UI for
  student and teacher workflows.
- Target shared packages such as `vos-core`, `vos-evidence`, `vos-policy`, and
  `vos-runtime` are described in `docs/design/toolchain/03-runtime-modules.md`
  and should be introduced as the course runtime matures.

Older blueprints are retained under `docs/vos/portal/spec/` and remain useful
for detailed design notes. This directory is the implementation-facing entry.

## Local Quick Start

Backend / Agent Gateway:

```powershell
cd vos
bun run dev:agent
```

vos-portal (prototype frontend via `vos-web`):

```powershell
cd vos
bun run dev:web
```

Demo credentials:

- `student` / `student`
- `teacher` / `teacher`
- `ta` / `ta`

The `vos-portal` frontend proxies `/api` and `/v1` to `http://127.0.0.1:8787`. If
the backend is not running, the UI shows an error state. Runtime mock/fallback
data is not
used; demo data is inserted by the backend seed path.

Docker/PostgreSQL:

```powershell
docker compose up postgres vos-agent vos-web  # prototype service name
```

The Compose path should use PostgreSQL adapters once the TypeScript storage
layer is introduced. Until then, the demo in-memory store remains the local
smoke-test path.

## Documents

- [Architecture](architecture.md)
- [Data Model](data-model.md)
- [API](api.md)
- [Development](development.md)
- [TODO](todo.md)
