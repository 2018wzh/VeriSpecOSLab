# Portal Architecture

## Service Layout

```text
vos-course
  -> platform-neutral course, stage, evidence, score, audit models
  -> pure workflow functions
  -> Repo/Pipeline/Experiment/Agent adapter traits

vos-portal
  -> Axum HTTP API
  -> auth and RBAC boundary
  -> demo in-memory store
  -> PostgreSQL migrations and SQLx store behind the postgres feature
  -> local demo adapters

vos-web
  -> React/Vite app
  -> student dashboard
  -> architecture, evidence, audit, teacher, score views
```

`vos-platform` remains the lower-level host/fs/command adapter crate. Course and
Portal concepts intentionally live in `vos-course` to avoid overloading that
existing crate.

## Adapter Boundary

The backend uses replaceable adapter traits from `vos-course`:

- `RepoProvisioner`: creates or binds repositories/workspaces.
- `PipelineOrchestrator`: derives and queues VOS verification runs.
- `ExperimentAdapter`: projects domain-specific spec and verification rules.
- `AgentGateway`: routes OpenAI-compatible calls and returns auditable summaries.

The current `vos-portal` implementation ships local demo adapters. Production
Gitea, Runner, Artifact Store, and model gateway integrations should replace
these implementations without changing API shape.

## SpecLab Extensibility

Core entities avoid OS-specific fields. OS/QEMU details live in
`Project.adapter_profile`, `Experiment.config`, evidence records, and the
`ExperimentAdapter`. Future SpecDBLab or SpecCompilerLab implementations should
provide new adapters and rubric templates while reusing the same stage/evidence
and score model.

## Runtime Modes

- Default: in-memory demo store, no external services.
- `postgres` feature: enables the SQLx/PostgreSQL store. Startup runs migrations
  from `vos/crates/vos-portal/migrations`; `VOS_PORTAL_DEMO=1` seeds the demo
  course, stages, project, evidence, rubric, and score into PostgreSQL.
