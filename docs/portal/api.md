# Portal API

All application APIs are versioned under `/api/v1`. OpenAI-compatible Agent
entrypoints live under `/v1`.

## Auth

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

The skeleton accepts bearer tokens. Demo tokens include `demo-student` and
`demo-teacher`.

## Course Setup

```http
GET  /api/v1/courses
POST /api/v1/courses
GET  /api/v1/courses/{id}
PATCH /api/v1/courses/{id}
DELETE /api/v1/courses/{id}
GET  /api/v1/experiments
POST /api/v1/experiments
GET  /api/v1/experiments/{id}
PATCH /api/v1/experiments/{id}
DELETE /api/v1/experiments/{id}
GET  /api/v1/experiments/{id}/stage-gates
POST /api/v1/experiments/{id}/stage-gates
GET  /api/v1/stage-gates/{id}
PATCH /api/v1/stage-gates/{id}
DELETE /api/v1/stage-gates/{id}
```

Staff roles may create courses, experiments, and stage gates.

## Projects and Progress

```http
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/{id}
PATCH /api/v1/projects/{id}
DELETE /api/v1/projects/{id}
GET  /api/v1/projects/{id}/progress
GET  /api/v1/projects/{id}/projections/{scope}
POST /api/v1/projects/{id}/submit-design
GET  /api/v1/design-submissions
POST /api/v1/design-submissions
GET  /api/v1/design-submissions/{id}
PATCH /api/v1/design-submissions/{id}
DELETE /api/v1/design-submissions/{id}
POST /api/v1/design-submissions/{id}/review
POST /api/v1/projects/{id}/freeze
```

Scopes are `student-public`, `agent-public`, and `staff-full`.

## Pipeline and Evidence

```http
GET  /api/v1/projects/{id}/pipelines
POST /api/v1/projects/{id}/pipelines
GET  /api/v1/pipelines
POST /api/v1/pipelines
GET  /api/v1/pipelines/{id}
PATCH /api/v1/pipelines/{id}
DELETE /api/v1/pipelines/{id}
GET  /api/v1/projects/{id}/evidence
GET  /api/v1/evidence
POST /api/v1/evidence
GET  /api/v1/evidence/{id}
PATCH /api/v1/evidence/{id}
DELETE /api/v1/evidence/{id}
POST /api/v1/internal/evidence
```

`POST /api/v1/internal/evidence` accepts `IncomingEvidenceReport` and returns
inserted records, updated pipeline summary, promotion result, and recomputed
scores. It requires `Authorization: Bearer $VOS_PORTAL_INTERNAL_TOKEN`, except
when demo mode is enabled and no internal token is configured.

## Scores and Teacher Views

```http
GET  /api/v1/projects/{id}/scores
GET  /api/v1/rubrics
POST /api/v1/rubrics
GET  /api/v1/rubrics/{id}
PATCH /api/v1/rubrics/{id}
DELETE /api/v1/rubrics/{id}
GET  /api/v1/scores
POST /api/v1/scores
GET  /api/v1/scores/{id}
PATCH /api/v1/scores/{id}
DELETE /api/v1/scores/{id}
GET  /api/v1/teacher/experiments/{id}/students
GET  /api/v1/teacher/projects/{id}/scores
POST /api/v1/teacher/projects/{id}/grade
```

## Agent Gateway

```http
GET  /v1/models
POST /v1/chat/completions
GET  /api/v1/projects/{id}/agent-audit
GET  /api/v1/agent-audits
POST /api/v1/agent-audits
GET  /api/v1/agent-audits/{id}
PATCH /api/v1/agent-audits/{id}
DELETE /api/v1/agent-audits/{id}
```

The current gateway is a local auditable skeleton. It records project, user,
model, prompt summary, response summary, context summary, tool calls, and risk
flags.

## Users and Deletes

```http
GET  /api/v1/users
POST /api/v1/users
GET  /api/v1/users/{id}
PATCH /api/v1/users/{id}
DELETE /api/v1/users/{id}
```

Delete endpoints are soft deletes. List/get endpoints hide deleted records by
default and staff callers can request `?include_deleted=true` where supported.
