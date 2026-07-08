# VOS Portal TODO

## Bootstrap: Skeleton

- [x] Add TypeScript Portal domain models in the backend/API surface.
- [x] Add Bun `apps/vos-agent` backend with Portal REST API and Agent Gateway.
- [x] Add React/Vite `vos-portal` app (prototype implementation: `vos-web`).
- [x] Add PostgreSQL storage contracts in the design docs.
- [x] Add local demo adapters for experiment projection, pipeline, and Agent.
- [x] Add implementation docs under `docs/portal`.

## Phase 1: Local Course Flow

- [x] Seed demo course, experiment, stages, project, evidence, and rubric.
- [x] Implement local auth and role-aware project access.
- [x] Implement course, experiment, stage, project, progress, evidence, score, and audit APIs.
- [x] Add PostgreSQL-backed CRUD for users, courses, experiments, stage gates, projects, design submissions, pipelines, evidence, rubrics, scores, and agent audits.
- [x] Use soft delete/tombstone semantics for mutable teaching records.
- [x] Remove `vos-portal` frontend runtime mock fallback; demo data now comes from backend seed data only.
- [x] Add `vos-portal` frontend login and bearer-token API client.
- [x] Implement `vos-portal` student dashboard and teacher admin views.
- [ ] Replace demo password handling with a real password hash implementation.
- [ ] Add TypeScript PostgreSQL repository implementation behind a storage adapter.
- [ ] Add API integration tests with the Bun router and demo store.
- [ ] Add PostgreSQL CRUD integration tests against a temporary database.

## Phase 2: Evidence and Stage Gates

- [x] Implement evidence ingest.
- [x] Implement StageGate promotion decision.
- [x] Implement basic score recomputation.
- [x] Protect internal evidence ingest with `VOS_PORTAL_INTERNAL_TOKEN` outside unrestricted demo mode.
- [ ] Accept full `vos verify public --json` output in addition to normalized evidence records.
- [ ] Persist artifact index and public summaries separately from raw evidence.
- [ ] Add retry and cancellation APIs for pipeline runs.

## Phase 3: Agent Audit

- [x] Add OpenAI-compatible `/v1/models` and `/v1/chat/completions` skeleton.
- [x] Persist agent audit records in demo store.
- [x] Show audit timeline in the `vos-portal` frontend.
- [ ] Wire `vos-agent` context projection directly into Agent Gateway.
- [ ] Add policy snapshots and risk classification rules.
- [ ] Add teacher review workflow for high-risk audit items.

## Phase 4: Real Integrations

- [ ] Implement Gitea repository provisioner.
- [ ] Implement Gitea webhook validation and branch policy handling.
- [ ] Implement Runner queue and artifact store adapters.
- [ ] Implement real model gateway adapter.
- [ ] Add Judge submission/result APIs.
- [x] Add Docker Compose for Postgres, backend, `vos-portal` frontend, Gitea, and runner.

## Phase 5: Analytics and Scale

- [ ] Course progress analytics.
- [ ] Failure-pattern aggregation.
- [ ] AI risk aggregation.
- [ ] Multi-course and multi-experiment isolation.
- [ ] SpecDBLab or SpecCompilerLab adapter prototype.
