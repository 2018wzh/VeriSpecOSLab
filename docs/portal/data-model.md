# Portal Data Model

## Crate Boundary

`vos-course` defines the public Rust data model:

- identity: `User`, `ExternalIdentity`, `UserRole`, `UserStatus`
- course setup: `Course`, `Experiment`, `StageGate`
- student work: `Project`, `DesignSubmission`, `PipelineRun`
- verification: `EvidenceRecord`, `PublicSummary`
- scoring: `EvaluationRubric`, `ScoreItem`, `ScoreSummary`
- audit: `AgentAuditRecord`, risk flags, events

The model is serialized through JSON APIs and is also the target shape for the
PostgreSQL schema.

## StageGate

Each gate carries:

- stable `key` and display `name`
- `sequence` order
- `gate_type`: `auto`, `manual`, or `hybrid`
- `StageGateConfig` with required artifacts, required evidence, and manual
  review policy

Promotion is computed by `check_stage_promotion` in `vos-course`. It evaluates
the next gate's evidence requirements and review policy, then returns a
structured `StagePromotionDecision`.

## Evidence and Score

Evidence is immutable and append-only. Scores are recomputed from evidence unless
`ScoreItem.is_final` is set.

`recompute_scores` maps evidence to active rubrics by:

- kind
- suite
- case name
- result

Manual scores remain explicit overrides, not evidence replacements.

## Soft Delete and Auditability

PostgreSQL-backed resources use `deleted_at` tombstones instead of physical
deletes. List/get APIs hide tombstoned records by default and staff callers can
request deleted rows where supported.

Evidence and Agent audit records preserve their original result, prompt, and
response fields. Updates are limited to operational metadata such as artifact
links, review state, visibility state, or tombstone status so the teaching
trace remains auditable.

## SSO Readiness

The first implementation uses local demo accounts, but the schema includes
`external_identities`:

```text
provider + subject -> user_id
```

This keeps school SSO/OIDC integration compatible with local accounts.
