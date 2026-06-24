# VOS Server HTTP API

`vos-server` is the sandbox-local HTTP façade for Portal-triggered VOS
toolchain work. It is single-project bound at startup and does not accept
`project_root`, `portal_url`, `project_id`, or shell command strings in request
bodies.

## Public Contract

- `GET /health`
- `GET /api/v1/openapi.json`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `POST /api/v1/runs/{run_id}/cancel`
- `GET /api/v1/runs/{run_id}/manifest`
- `GET /api/v1/runs/{run_id}/artifacts?path=<relative-artifact-path>`

Short operations return JSON directly. Long operations return `202` with
`run_id` and stream progress over SSE.

## Long-Running Endpoints

- `POST /api/v1/build/runs`
- `POST /api/v1/build/generate-runs`
- `POST /api/v1/run/qemu-runs`
- `POST /api/v1/test/runs`
- `POST /api/v1/verify/runs`
- `POST /api/v1/trace/syscall-runs`
- `POST /api/v1/debug/explain-log-runs`
- `POST /api/v1/spec/patch/apply-runs`
- `POST /api/v1/kb/add-runs`
- `POST /api/v1/agent/*-runs`
- `POST /api/v1/report/generate-runs`
- `POST /api/v1/submit/pack-runs`

Run request bodies share `requested_by`, `reason`, and `agent_session_id`.
Command options use typed JSON fields such as `dry_run`, `timeout_ms`, `scope`,
`target`, and `suites`.

## SSE

SSE uses browser-native event names:

```text
event: progress
data: {"run_id":"run-...","type":"progress","payload":{"stage":"verify"}}
```

`staff-only` events are not streamed. Bearer tokens are passed only in memory to
core auth/policy checks and must not appear in responses, events, manifests, or
logs.
