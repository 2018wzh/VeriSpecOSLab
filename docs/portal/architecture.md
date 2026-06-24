# Portal Architecture

## Service Layout

```text
vos-core
  -> platform-neutral course, stage, evidence, score, audit models
  -> pure workflow functions
  -> shared JSON contracts for CLI, backend, and `vos-portal` frontend

vos-core
  -> RunManifest and events.jsonl persistence
  -> evidence indexes and report inputs

vos-core
  -> role, stage, visibility, path, and tool policies

apps/vos-agent
  -> Bun HTTP API
  -> OpenAI-compatible Agent Gateway
  -> Portal REST API
  -> demo in-memory store
  -> future storage adapter host

packages/vos-server
  -> sandbox-local typed VOS HTTP API
  -> SSE run progress
  -> generated OpenAPI contract
  -> read-only run manifest/artifact access

apps/vos-portal（prototype: vos-web）
  -> React/Vite app
  -> student dashboard
  -> architecture, evidence, audit, teacher, score views
```

The current implementation keeps Portal handlers and the demo store inside
`apps/vos-agent`. Shared packages should be introduced incrementally as the
course runtime becomes real, using the target boundaries in
`docs/design/toolchain/03-runtime-modules.md`.

Portal runners call `vos-server` inside a single-project sandbox for VOS
toolchain operations. `vos-server` does not proxy `vos-agent` chat endpoints;
VOS agent subcommands exposed through HTTP still execute through `vos-core` and
produce evidence/progress like CLI runs.

## Adapter Boundary

The backend should use replaceable TypeScript adapter interfaces:

- `RepoProvisioner`: creates or binds repositories/workspaces.
- `PipelineOrchestrator`: derives and queues VOS verification runs.
- `ExperimentAdapter`: projects domain-specific spec and verification rules.
- `AgentGateway`: routes OpenAI-compatible calls and returns auditable summaries.
- `PortalStore`: persists users, courses, projects, evidence, scores, and audits.

The current `apps/vos-agent` implementation ships local demo adapters.
Production Gitea, Runner, Artifact Store, PostgreSQL, and model gateway
integrations should replace these implementations without changing API shape.

## SpecLab Extensibility

Core entities avoid OS-specific fields. OS/QEMU details live in
`Project.adapter_profile`, `Experiment.config`, evidence records, and the
`ExperimentAdapter`. Future SpecDBLab or SpecCompilerLab implementations should
provide new adapters and rubric templates while reusing the same stage/evidence
and score model.

## Runtime Modes

- Default: in-memory demo store, no external services.
- PostgreSQL adapter: future production store for Portal data.
- Integrations profile: optional Gitea/runner/artifact services for pipeline
  orchestration.

Every runtime mode must preserve the same visibility boundary: hidden tests,
staff-only rubrics, and other students' projects never enter student-facing or
Agent-facing projections.
