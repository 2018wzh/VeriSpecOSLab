# VOS Portal Delivery Status

> 冻结快照：下面的勾选项记录 Portal 冻结前的实现与历史验收，不能据此声称当前学生 v2 主链仍接入 connected teaching loop。本阶段只重新验证 Portal/Demo 的 typecheck、build 和 unit test。

## Implemented in the new application

- [x] Independent React/Vite Portal with student, TA, teacher and administrator workspaces.
- [x] Compile-time-separated Production HTTP and static localStorage Demo transports.
- [x] Versioned shared Portal contracts and fail-fast domain state machines.
- [x] PostgreSQL migration foundation, indexed foreign keys, queue indexes, outbox and audit tables.
- [x] Local Argon2id login, opaque sessions, same-origin/CSRF checks and role projection.
- [x] CLI device authorization, Bearer policy/binding APIs, token revoke, pipeline SSE lifecycle, verified artifact download and reproduction metadata.
- [x] Short-lived scoped service-token issue/list/revoke API with hash-only persistence, secret-safe idempotency and route-level scope enforcement.
- [x] Core dashboard, evidence, pipeline, review, score adjustment, appeal and Q&A APIs.
- [x] Commit-ledger-bound design revisions, auditable staff review state machine and interactive Production/Demo architecture workspace.
- [x] Browser EventSource Q&A updates and persistent per-user notification acknowledgement UI/API.
- [x] SKIP LOCKED worker lease and frozen typed runner-service invocation with no host fallback.
- [x] Immutable course manifest dry-run/import/publish/rollback, grouped CSV enrollment and course-scoped project membership gates.
- [x] Role-bound, expiring, bounded-use course invitation codes with hash-only Production persistence, one-time secret display, transactional redemption/audit, and versioned Demo persistence.
- [x] Accessible course/project context enumeration and selection across API, Production transport, Demo adapter and shared shell; Q&A is explicitly bound to the selected project.
- [x] Course-scoped group editor with active-student validation, one-group membership, optimistic revisions, idempotency and audit history in Production and Demo.
- [x] Course publication outbox notifications with lease, backoff, terminal failure and audit records.
- [x] OIDC provider control plane, encrypted credentials, PKCE/state/nonce flow and administrator configuration UI.
- [x] Course-policy-gated BYOK credential create/list/revoke API and UI with envelope encryption, no secret echo and Demo hard-disable.
- [x] Short-lived BYOK runner lease, encrypted exec-envelope projection, expiry deletion, revoke and expired-worker recovery implementation.
- [x] Administrator PostgreSQL/Gitea/MinIO health, worker heartbeat and queue-depth projection; Demo reports production services unavailable.
- [x] Administrator retention-policy revisions with optimistic concurrency, audit trail, GC integration and Demo persistence.
- [x] Course-policy-gated Q&A outbox, authenticated vos-agent dispatch, persisted answers and staff Agent audit projection.
- [x] Encrypted school model Provider control plane, course/member monthly quota policy, concurrent reservation/settlement ledger, usage audit and Demo metadata projection without secret persistence.
- [x] Bounded runner manifest/artifact collection with PostgreSQL evidence projection and verified MinIO upload.
- [x] Persistent review events, controlled rerun approval, immutable score/appeal snapshots and transaction-level mutation idempotency.
- [x] Role-specific grading/appeal UI and repository-level individual-adjustment visibility projection.
- [x] Staff-only class project matrix covering members, StageGate, design, latest run, failures, grade and open appeals.
- [x] Course-membership resource gates for project, run, object, design review, grading, appeal, Q&A and Agent-audit projections, including cross-course denial tests.
- [x] Production and Demo builds, focused tests and retired legacy frontend wiring.

## Connected production verification still required

- [x] Apply migration 017 and run the role-bound invitation issue/replay/redeem integration test against PostgreSQL (hash-only persistence, replay and single-use accounting verified).
- [x] Re-run the multi-project resource-access integration test against PostgreSQL, including explicit dashboard selection and cross-course denial.

- [x] Run all PostgreSQL migrations through service-token migration 016, including hash-only token issuance/replay/revoke, against an isolated Docker PostgreSQL 16 database at current HEAD.
- [x] Re-run the full connected Compose teaching cycle after migration 016, including Gitea push delivery, isolated runner execution, MinIO evidence, immutable grading and appeal closure.
- [x] Verify real Gitea template provisioning/collaborator/webhook configuration and MinIO SigV4/checksum/metadata adapters.
- [x] Verify a signed Gitea push delivery through Portal webhook ingestion, commit ledger update and member notification.
- [x] Verify the frozen per-job Docker runner path: container isolation, checkout/runner network transition, resource limits, authenticated runner service, no-egress and cleanup through the restricted runtime adapter.
- [x] Run CLI device authorization, encrypted credential persistence, online `whoami`, logout and server-side revoke against HTTPS Portal and PostgreSQL.
- [x] Complete OIDC provider integration and replay/issuer/audience/nonce verification.
- [x] Execute a real PostgreSQL 100-student/100-project queue fixture with 20 concurrent isolated runner startups and an explicit readiness threshold.
- [x] Execute PostgreSQL/MinIO backup-and-restore drill and full teaching-cycle E2E.

The connected teaching cycle covers enrollment, Gitea provisioning and push ledger, commit-bound design
review and class operations projection, isolated public verification, MinIO evidence, persisted review, grade freeze/publish, appeal decision, course close,
and object retention GC. It is a Linux Docker Compose proof, not Kubernetes or microVM evidence.

## Remaining product gates

- [x] Complete the mutation-by-mutation idempotency/audit/outbox audit: endpoint-scoped keys, replay-safe local/device auth, course publication/enrollment, pipeline/object/Q&A/session mutations, database-enforced audit outbox, and a route-level regression gate. Signed Gitea delivery, device-token exchange, dry-run and signed-download queries are explicit protocol exemptions with their own replay or no-write semantics.
- [x] Run the pipeline worker lease/heartbeat/start/evidence/complete internal HTTP contract through the isolated runner network. The current-source Compose teaching-cycle E2E covers authenticated worker control, real PostgreSQL and MinIO object metadata checks, Gitea checkout/push, restricted runner execution, evidence projection, immutable grading and appeal in 39 assertions.
- [x] Rebuild the Portal, runner and operations images and re-run the isolated backup/restore drill after migrations 017–019 and the worker-control boundary. The drill restores the current-source backup into an empty PostgreSQL 16 and MinIO pair, verifies all checksums, and confirms schema migration 019. The current-source teaching-cycle E2E separately passes 39 assertions after that boundary.

- [x] Rerun the short-lived authorized BYOK runner unseal lifecycle in the connected teaching-cycle E2E at final HEAD.
- [x] Complete English translation-key coverage for every route.
- [x] Complete independent keyboard and WCAG 2.2 AA review. Automated browser checks cover semantic landmarks, role projection, notification Escape focus restoration and console health; final keyboard and assistive-technology acceptance was completed by human review.
- [x] Re-run four-role browser E2E after the administrator model-control UI change, including role projection, notification keyboard dismissal/focus restoration, language switching, console health, and overflow checks at 1440×1024, 1366×768, tablet and phone viewports.
- [x] Complete visual acceptance against the approved three-screen concepts by human review. The concept source images are not retained in this repository, so this acceptance is recorded as human evidence rather than an image-diff artifact.
- [x] Rebuild Portal and runner production images from the integrity-checked official-registry lockfile at final HEAD.
- [x] Rerun isolated PostgreSQL/MinIO backup and restore after migration 016, including manifest verification and restored-object SHA-256 comparison. Deleted object tombstones are excluded while live verified references remain fail-fast.

These open product gates must not be reported as completed from fixture, build, or local UI evidence.
