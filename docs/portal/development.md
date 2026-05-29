# Portal Development

## Rust Checks

Use targeted checks while the platform grows:

```powershell
cd vos
cargo check -p vos-course
cargo test -p vos-course
cargo check -p vos-portal
cargo test -p vos-portal
```

`cargo check --workspace` currently fails on this Windows machine before reaching
Portal code because the existing workspace pulls `aws-lc-sys` through Agent
dependencies and NASM/MSVC setup is not healthy. Keep using targeted checks until
the existing dependency issue is resolved.

PostgreSQL support is feature-gated:

```powershell
cargo check -p vos-portal --features postgres
```

## Frontend Checks

```powershell
cd vos/apps/vos-web
npm install
npm run lint
npm run build
npm run dev
```

The app does not use runtime mock data. It requires the backend API for login
and page data; when the backend is absent it shows a real error state. Local
sample data must be created through the in-memory demo seed or PostgreSQL seed.

## Backend Runtime

```powershell
cd vos
cargo run -p vos-portal
```

Environment variables:

- `VOS_PORTAL_HOST`, default `127.0.0.1`
- `VOS_PORTAL_PORT`, default `8080`
- `VOS_PORTAL_SPEC_ROOT`, default `../examples/xv6-spec/spec`
- `VOS_PORTAL_DEMO`, default enabled
- `VOS_PORTAL_INTERNAL_TOKEN`, required for `/api/v1/internal/evidence` unless
  demo mode is enabled without an internal token
- `DATABASE_URL`, optional unless running with `postgres`

## PostgreSQL Runtime

The `postgres` feature enables SQLx storage. On startup the backend connects to
`DATABASE_URL`, runs `vos/crates/vos-portal/migrations`, and seeds the demo
course when `VOS_PORTAL_DEMO=1`.

```powershell
cd vos
$env:DATABASE_URL="postgres://vos:vos@127.0.0.1:5432/vos_portal"
$env:VOS_PORTAL_DEMO="1"
cargo run -p vos-portal --features postgres
```

With PostgreSQL enabled, `/health` should report `"database": true`.

PostgreSQL is the production data path for CRUD endpoints. The in-memory store
remains available for local smoke tests, but generic CRUD endpoints return an
explicit unsupported error unless the backend is running with `--features
postgres` and `DATABASE_URL`.

## Docker Compose

From the repository root:

```powershell
docker compose up postgres vos-portal vos-web
```

Docker Desktop or another compatible Docker engine must be running before this
command can create containers.

This starts:

- PostgreSQL on `127.0.0.1:5432`
- Backend on `http://127.0.0.1:8080`
- Frontend on `http://127.0.0.1:5173`

The compose backend sets `VOS_PORTAL_INTERNAL_TOKEN=dev-internal-token`; local
evidence ingest clients must send `Authorization: Bearer dev-internal-token`.

Optional Gitea services are present behind the `integrations` profile:

```powershell
docker compose --profile integrations up
```

`gitea-runner` requires `GITEA_RUNNER_REGISTRATION_TOKEN` after Gitea is
configured. The Portal still uses local demo adapters until the Gitea/runner
providers are implemented.

## Editing Rules

- Keep course/platform entities in `vos-course`.
- Keep host/fs/command utilities in `vos-platform`.
- Put HTTP handlers and storage concerns in `vos-portal`.
- Keep OS-specific behavior behind `ExperimentAdapter`.
- Do not expose hidden verification rules through student or Agent projections.
