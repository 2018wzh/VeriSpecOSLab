# VOS Portal Development Docs

`vos-portal` is the course platform surface for VeriSpecOSLab and the future
SpecLab platform family. It connects course rules, staged projects, VOS evidence,
scoring, and Agent audit into one workflow.

The current implementation is a full skeleton rather than the final production
platform:

- `vos/crates/vos-course`: shared course/domain model and adapter traits.
- `vos/crates/vos-portal`: Axum backend with demo in-memory store and SQL
  migrations for PostgreSQL.
- `vos/apps/vos-web`: React/Vite portal UI for student and teacher workflows.

Older blueprints are retained under `docs/vos/portal/spec/` and remain useful
for detailed design notes. This directory is the implementation-facing entry.

## Local Quick Start

Backend:

```powershell
cd vos
cargo run -p vos-portal
```

Frontend:

```powershell
cd vos/apps/vos-web
npm install
npm run dev
```

Demo credentials:

- `student` / `student`
- `teacher` / `teacher`
- `ta` / `ta`

The frontend proxies `/api` and `/v1` to `http://127.0.0.1:8080`. If the backend
is not running, the UI shows an error state. Runtime mock/fallback data is not
used; demo data is inserted by the backend seed path.

Docker/PostgreSQL:

```powershell
docker compose up postgres vos-portal vos-web
```

The Compose path uses PostgreSQL, runs migrations automatically, and seeds the
same demo course when `VOS_PORTAL_DEMO=1`.

## Documents

- [Architecture](architecture.md)
- [Data Model](data-model.md)
- [API](api.md)
- [Development](development.md)
- [TODO](todo.md)
