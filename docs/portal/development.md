# Portal Development

## TypeScript Checks

Use targeted checks while the platform grows:

```powershell
cd vos
bun run typecheck
bun run test
```

For agent/backend-specific checks:

```powershell
cd vos/apps/vos-agent
bun test
bun run typecheck
```

## vos-portal Frontend Checks (prototype via vos-web)

```powershell
cd vos/apps/vos-web  # prototype implementation path
npm install
npm run lint
npm run build
npm run dev
```

The vos-portal app does not use runtime mock data. It requires the backend API
for login and page data; when the backend is absent it shows a real error state.
Local sample data must be created through the backend demo seed path or a future
PostgreSQL seed adapter.

## Backend Runtime

```powershell
cd vos
bun run dev:agent
```

Environment variables:

- `VOS_AGENT_HOST`, default `127.0.0.1`
- `VOS_AGENT_PORT`, default `8787`
- provider variables documented in `vos/apps/vos-agent/README.md`
- future storage variables such as `DATABASE_URL` should be owned by the
  TypeScript Portal storage adapter

The current backend lives in `vos/apps/vos-agent` and serves both:

- OpenAI-compatible Agent endpoints under `/v1`
- Portal APIs under `/api/v1`

## PostgreSQL Runtime

PostgreSQL is the target production data path, but it should be introduced as a
TypeScript adapter rather than a separate Rust portal service. The adapter must:

- store users, courses, experiments, stage gates, projects, design submissions,
  pipelines, evidence, rubrics, scores, and agent audits
- preserve the demo in-memory store for deterministic local smoke tests
- keep hidden verification data out of student and Agent projections

## Docker Compose

From the repository root:

```powershell
docker compose up postgres vos-agent vos-web  # prototype service name
```

Docker Desktop or another compatible Docker engine must be running before this
command can create containers.

The intended services are:

- PostgreSQL on `127.0.0.1:5432`
- Backend / Agent Gateway on `http://127.0.0.1:8787`
- vos-portal frontend (prototype via vos-web) on `http://127.0.0.1:5173`

Optional Gitea services are present behind the `integrations` profile:

```powershell
docker compose --profile integrations up
```

The Portal still uses local demo adapters until the Gitea/runner providers are
implemented.

## Editing Rules

- Keep shared course/platform entities in target `vos-core` package types.
- Keep evidence persistence in target `vos-evidence`.
- Keep policy and visibility checks in target `vos-policy`.
- Keep Portal HTTP handlers in `apps/vos-agent` until they are extracted.
- Keep OS-specific behavior behind an `ExperimentAdapter`.
- Do not expose hidden verification rules through student or Agent projections.
