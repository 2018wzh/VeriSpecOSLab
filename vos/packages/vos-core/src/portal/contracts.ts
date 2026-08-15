import { z } from "zod";

export const PortalVisibilitySchema = z.enum([
  "public",
  "student",
  "staff",
  "system",
]);
export type PortalVisibility = z.infer<typeof PortalVisibilitySchema>;

export const PortalRoleSchema = z.enum(["admin", "teacher", "ta", "student"]);
export type PortalRole = z.infer<typeof PortalRoleSchema>;
const OidcCourseRoleSchema = z.enum(["teacher", "ta", "student"]);

export const PortalActorSchema = z
  .object({
    id: z.string().min(1),
    username: z.string().min(1),
    display_name: z.string().min(1),
    role: PortalRoleSchema,
  })
  .strict();
export type PortalActor = z.infer<typeof PortalActorSchema>;

export const ServiceTokenScopeSchema = z.enum([
  "project:read",
  "pipeline:write",
  "evidence:read",
]);
export const ServiceTokenCreateV1Schema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z
      .array(ServiceTokenScopeSchema)
      .min(1)
      .max(3)
      .refine(
        (items) => new Set(items).size === items.length,
        "scopes must be unique",
      ),
    expires_in_minutes: z.number().int().min(5).max(1440),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type ServiceTokenCreateV1 = z.infer<typeof ServiceTokenCreateV1Schema>;
export const ServiceTokenSummaryV1Schema = z
  .object({
    version: z.literal("service-token-summary.v1"),
    id: z.string(),
    name: z.string(),
    scopes: z.array(ServiceTokenScopeSchema),
    expires_at: z.string().datetime(),
    created_at: z.string().datetime(),
    revoked_at: z.string().datetime().optional(),
  })
  .strict();
export type ServiceTokenSummaryV1 = z.infer<typeof ServiceTokenSummaryV1Schema>;
export const ServiceTokenIssuedV1Schema = ServiceTokenSummaryV1Schema.extend({
  version: z.literal("service-token-issued.v1"),
  token: z.string().min(32),
}).strict();
export type ServiceTokenIssuedV1 = z.infer<typeof ServiceTokenIssuedV1Schema>;

export const OidcProviderInputV1Schema = z
  .object({
    version: z.literal("oidc-provider-input.v1"),
    id: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
    name: z.string().min(1).max(100),
    issuer: z
      .string()
      .url()
      .refine(
        (value) => new URL(value).protocol === "https:",
        "issuer must use HTTPS",
      ),
    client_id: z.string().min(1).max(200),
    client_secret: z.string().min(1).max(1000),
    scopes: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]+$/))
      .min(1)
      .max(20),
    username_claim: z.string().min(1).max(100),
    display_name_claim: z.string().min(1).max(100),
    role_claim: z.string().min(1).max(100).optional(),
    role_mappings: z.record(z.string(), OidcCourseRoleSchema),
    default_role: OidcCourseRoleSchema,
    enabled: z.boolean(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type OidcProviderInputV1 = z.infer<typeof OidcProviderInputV1Schema>;
export const OidcProviderSummaryV1Schema = OidcProviderInputV1Schema.omit({
  client_secret: true,
  reason: true,
})
  .extend({
    version: z.literal("oidc-provider-summary.v1"),
    secret_configured: z.literal(true),
    updated_at: z.string().datetime(),
  })
  .strict();
export type OidcProviderSummaryV1 = z.infer<typeof OidcProviderSummaryV1Schema>;

const HttpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "URL must use HTTPS",
  );

/** OAuth 2.0 providers use an explicit user-info endpoint because OAuth 2.0
 * itself does not define an identity token or a discovery document. */
export const OAuthProviderInputV1Schema = z
  .object({
    version: z.literal("oauth-provider-input.v1"),
    id: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
    name: z.string().min(1).max(100),
    issuer: HttpsUrlSchema,
    authorization_endpoint: HttpsUrlSchema,
    token_endpoint: HttpsUrlSchema,
    userinfo_endpoint: HttpsUrlSchema,
    client_id: z.string().min(1).max(200),
    client_secret: z.string().min(1).max(1000),
    scopes: z
      .array(z.string().regex(/^[A-Za-z0-9._:-]+$/))
      .min(1)
      .max(20),
    subject_claim: z.string().min(1).max(100),
    username_claim: z.string().min(1).max(100),
    display_name_claim: z.string().min(1).max(100),
    role_claim: z.string().min(1).max(100).optional(),
    role_mappings: z.record(z.string(), OidcCourseRoleSchema),
    default_role: OidcCourseRoleSchema,
    enabled: z.boolean(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type OAuthProviderInputV1 = z.infer<typeof OAuthProviderInputV1Schema>;
export const OAuthProviderSummaryV1Schema = OAuthProviderInputV1Schema.omit({
  client_secret: true,
  reason: true,
})
  .extend({
    version: z.literal("oauth-provider-summary.v1"),
    secret_configured: z.literal(true),
    updated_at: z.string().datetime(),
  })
  .strict();
export type OAuthProviderSummaryV1 = z.infer<
  typeof OAuthProviderSummaryV1Schema
>;

export const TraceIdSchema = z.string().regex(/^trace-[a-zA-Z0-9_-]+$/);
export const IdempotencyKeySchema = z.string().min(8).max(128);
export const CursorPageSchema = z
  .object({
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  })
  .strict();

export const PortalErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        trace_id: TraceIdSchema,
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type PortalError = z.infer<typeof PortalErrorSchema>;

export const StageGateSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    name: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    status: z.enum([
      "locked",
      "open",
      "submitted",
      "verifying",
      "review",
      "passed",
      "frozen",
    ]),
    required_artifacts: z.array(z.string()),
    required_evidence: z.array(
      z
        .object({
          suite: z.string(),
          case_name: z.string(),
          required_result: z.enum(["pass", "fail", "error", "skipped"]),
        })
        .strict(),
    ),
    required_review_artifacts: z
      .array(z.string().min(1).max(200))
      .max(32)
      .refine((labels) => new Set(labels).size === labels.length, {
        message: "required review artifact labels must be unique",
      }),
    manual_review_required: z.boolean(),
  })
  .strict();
export type StageGate = z.infer<typeof StageGateSchema>;

export const CourseStageV1Schema = StageGateSchema.omit({ status: true })
  .extend({
    source_ref: z
      .string()
      .regex(/^course\/[a-z0-9][a-z0-9-]*-(?:complete|candidate)$/),
    spec_refs: z.array(z.string().min(1)).min(1),
    test_sets: z.array(z.string().min(1)).min(1),
    rubric_ids: z.array(z.string().min(1)).min(1),
    hardware_gate: z.union([
      z.literal("none"),
      z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/),
    ]),
    human_review_required: z.boolean(),
  })
  .strict()
  .superRefine((stage, context) => {
    const candidate = stage.source_ref.endsWith("-candidate");
    if (
      stage.required_review_artifacts.length > 0 &&
      (!stage.human_review_required || !stage.manual_review_required)
    )
      context.addIssue({
        code: "custom",
        message:
          "required review artifacts require human and manual review gates",
      });
    if (
      candidate &&
      (stage.hardware_gate === "none" ||
        !stage.human_review_required ||
        !stage.manual_review_required ||
        stage.required_review_artifacts.length === 0)
    )
      context.addIssue({
        code: "custom",
        message:
          "candidate stages require a hardware gate, human/manual review gates and review artifacts",
      });
  });

export const CourseManifestV1Schema = z
  .object({
    version: z.literal("course-manifest.v1"),
    course: z
      .object({ code: z.string(), name: z.string(), term: z.string() })
      .strict(),
    experiment: z
      .object({ id: z.string(), title: z.string(), spec_version: z.string() })
      .strict(),
    stages: z.array(CourseStageV1Schema),
    rubric: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          weight: z.number().nonnegative(),
        })
        .strict(),
    ),
    ai_policy: z
      .object({
        allowed_models: z.array(z.string()),
        monthly_budget: z.number().nonnegative(),
        allow_byok: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type CourseManifestV1 = z.infer<typeof CourseManifestV1Schema>;

export const CourseManifestDryRunV1Schema = z
  .object({
    version: z.literal("course-manifest-dry-run.v1"),
    valid: z.boolean(),
    course_id: z.string().optional(),
    next_manifest_version: z.number().int().positive().optional(),
    checksum: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    changes: z.array(z.string()),
    issues: z.array(
      z.object({ path: z.string(), message: z.string() }).strict(),
    ),
  })
  .strict();
export type CourseManifestDryRunV1 = z.infer<
  typeof CourseManifestDryRunV1Schema
>;

export const CourseManifestVersionV1Schema = z
  .object({
    version: z.literal("course-manifest-version.v1"),
    course_id: z.string(),
    manifest_version: z.number().int().positive(),
    state: z.enum(["draft", "published", "superseded"]),
    manifest: CourseManifestV1Schema,
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    rollback_of: z.number().int().positive().optional(),
    created_at: z.string().datetime(),
    published_at: z.string().datetime().optional(),
  })
  .strict();
export type CourseManifestVersionV1 = z.infer<
  typeof CourseManifestVersionV1Schema
>;

export const CourseManifestImportV1Schema = z
  .object({
    manifest: CourseManifestV1Schema,
    reason: z.string().min(10).max(500),
  })
  .strict();
export type CourseManifestImportV1 = z.infer<
  typeof CourseManifestImportV1Schema
>;
export const CourseManifestPublishV1Schema = z
  .object({
    manifest_version: z.number().int().positive(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const CourseManifestRollbackV1Schema = z
  .object({
    target_manifest_version: z.number().int().positive(),
    reason: z.string().min(10).max(500),
  })
  .strict();

export const EnrollmentCsvImportV1Schema = z
  .object({
    course_id: z.string(),
    csv: z.string().min(1).max(2_000_000),
    dry_run: z.boolean(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const EnrollmentImportResultV1Schema = z
  .object({
    version: z.literal("enrollment-import-result.v1"),
    course_id: z.string(),
    dry_run: z.boolean(),
    accepted: z.number().int().nonnegative(),
    created_users: z.number().int().nonnegative(),
    updated_memberships: z.number().int().nonnegative(),
    issues: z.array(
      z
        .object({ row: z.number().int().positive(), message: z.string() })
        .strict(),
    ),
  })
  .strict();
export type EnrollmentCsvImportV1 = z.infer<typeof EnrollmentCsvImportV1Schema>;
export type EnrollmentImportResultV1 = z.infer<
  typeof EnrollmentImportResultV1Schema
>;
export const EnrollmentInviteCreateV1Schema = z
  .object({
    course_id: z.string().min(1),
    role: z.enum(["student", "ta"]),
    expires_at: z.string().datetime(),
    max_uses: z.number().int().min(1).max(500),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const EnrollmentInviteSummaryV1Schema = z
  .object({
    version: z.literal("enrollment-invite-summary.v1"),
    id: z.string(),
    course_id: z.string(),
    role: z.enum(["student", "ta"]),
    expires_at: z.string().datetime(),
    max_uses: z.number().int().positive(),
    uses: z.number().int().nonnegative(),
    revoked: z.boolean(),
    created_at: z.string().datetime(),
  })
  .strict();
export const EnrollmentInviteIssuedV1Schema =
  EnrollmentInviteSummaryV1Schema.extend({
    version: z.literal("enrollment-invite-issued.v1"),
    code: z.string().min(20),
  }).strict();
export const EnrollmentInviteRedeemV1Schema = z
  .object({
    code: z.string().min(20).max(200),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const EnrollmentInviteRedemptionV1Schema = z
  .object({
    version: z.literal("enrollment-invite-redemption.v1"),
    invite_id: z.string(),
    course_id: z.string(),
    user_id: z.string(),
    role: z.enum(["student", "ta"]),
    redeemed_at: z.string().datetime(),
  })
  .strict();
export type EnrollmentInviteCreateV1 = z.infer<
  typeof EnrollmentInviteCreateV1Schema
>;
export type EnrollmentInviteSummaryV1 = z.infer<
  typeof EnrollmentInviteSummaryV1Schema
>;
export type EnrollmentInviteIssuedV1 = z.infer<
  typeof EnrollmentInviteIssuedV1Schema
>;
export type EnrollmentInviteRedeemV1 = z.infer<
  typeof EnrollmentInviteRedeemV1Schema
>;
export type EnrollmentInviteRedemptionV1 = z.infer<
  typeof EnrollmentInviteRedemptionV1Schema
>;

export const CourseGroupV1Schema = z
  .object({
    version: z.literal("course-group.v1"),
    id: z.string(),
    course_id: z.string(),
    name: z.string(),
    member_ids: z.array(z.string()),
    revision: z.number().int().positive(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type CourseGroupV1 = z.infer<typeof CourseGroupV1Schema>;
export const CourseGroupMutationV1Schema = z
  .object({
    name: z.string().min(1).max(100),
    member_ids: z
      .array(z.string())
      .min(1)
      .max(20)
      .refine(
        (items) => new Set(items).size === items.length,
        "member_ids must be unique",
      ),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type CourseGroupMutationV1 = z.infer<typeof CourseGroupMutationV1Schema>;

export const PolicySnapshotV1Schema = z
  .object({
    version: z.literal("policy-snapshot.v1"),
    ref: z.string().min(1),
    project_id: z.string().min(1),
    user_id: z.string().min(1),
    stage_key: z.string().min(1),
    allowed_commands: z.array(z.string()),
    allowed_paths: z.array(z.string()),
    visibility: z.array(PortalVisibilitySchema),
    expires_at: z.string().datetime(),
  })
  .strict();
export type PolicySnapshotV1 = z.infer<typeof PolicySnapshotV1Schema>;

export const ProjectBindingV1Schema = z
  .object({
    version: z.literal("project-binding.v1"),
    project_id: z.string(),
    course_id: z.string(),
    experiment_id: z.string(),
    repo_url: z.string().url(),
    member_ids: z.array(z.string()).min(1),
    current_stage: StageGateSchema,
    policy_snapshot_ref: z.string(),
  })
  .strict();
export type ProjectBindingV1 = z.infer<typeof ProjectBindingV1Schema>;

const GiteaNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]{1,100}$/)
  .refine((value) => value !== "." && value !== "..", "invalid Gitea name");
export const ProjectProvisionRequestV1Schema = z
  .object({
    version: z.literal("project-provision-request.v1"),
    experiment_id: z.string().min(1),
    member_ids: z.array(z.string().min(1)).min(1).max(20),
    owner: GiteaNameSchema,
    repository: GiteaNameSchema,
    template_owner: GiteaNameSchema,
    template_repository: GiteaNameSchema,
    description: z.string().min(1).max(255),
    private: z.literal(true),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type ProjectProvisionRequestV1 = z.infer<
  typeof ProjectProvisionRequestV1Schema
>;

export const ProjectProvisionStatusV1Schema = z
  .object({
    version: z.literal("project-provision-status.v1"),
    project_id: z.string().min(1),
    status: z.enum(["queued", "provisioning", "active", "failed"]),
    owner: GiteaNameSchema,
    repository: GiteaNameSchema,
    repo_url: z.string().url().optional(),
    attempts: z.number().int().nonnegative(),
    last_error: z.string().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type ProjectProvisionStatusV1 = z.infer<
  typeof ProjectProvisionStatusV1Schema
>;

export const ProjectProvisionOptionsV1Schema = z
  .object({
    version: z.literal("project-provision-options.v1"),
    experiments: z.array(
      z
        .object({
          id: z.string(),
          course_id: z.string(),
          title: z.string(),
          spec_version: z.string(),
        })
        .strict(),
    ),
    members: z.array(
      z
        .object({
          id: z.string(),
          course_id: z.string(),
          username: z.string(),
          display_name: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectProvisionOptionsV1 = z.infer<
  typeof ProjectProvisionOptionsV1Schema
>;

export const PipelineStatusSchema = z.enum([
  "queued",
  "leased",
  "running",
  "passed",
  "failed",
  "cancelled",
  "timed_out",
]);
export const PipelineRequestV1Schema = z
  .object({
    version: z.literal("pipeline-request.v1"),
    project_id: z.string(),
    commit_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    stage_key: z.string(),
    scope: z.enum(["public", "staff", "final"]),
    retry_of: z.string().optional(),
    model_credential_id: z.string().min(1).optional(),
    reason: z.string().min(10),
  })
  .strict();
export type PipelineRequestV1 = z.infer<typeof PipelineRequestV1Schema>;

export const PipelineEventV1Schema = z
  .object({
    version: z.literal("pipeline-event.v1"),
    run_id: z.string(),
    sequence: z.number().int().nonnegative(),
    type: z.enum([
      "queued",
      "leased",
      "step_started",
      "log",
      "step_finished",
      "finished",
    ]),
    visibility: PortalVisibilitySchema,
    occurred_at: z.string().datetime(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PipelineEventV1 = z.infer<typeof PipelineEventV1Schema>;

export const PipelineSummaryV1Schema = z
  .object({
    version: z.literal("pipeline-summary.v1"),
    id: z.string(),
    project_id: z.string(),
    commit_sha: z.string(),
    stage_key: z.string(),
    status: PipelineStatusSchema,
    passed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    failure_class: z.string().optional(),
    public_message: z.string(),
    created_at: z.string().datetime(),
    finished_at: z.string().datetime().optional(),
    retry_of: z.string().optional(),
  })
  .strict();
export type PipelineSummaryV1 = z.infer<typeof PipelineSummaryV1Schema>;

export const AssessmentSubmissionRequestV1Schema = z
  .object({
    version: z.literal("assessment-submission-request.v1"),
    project_id: z.string().min(1),
    commit_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    stage_key: z.string().min(1),
    spec_hash: z.string().regex(/^[0-9a-f]{64}$/),
    config_hash: z.string().regex(/^[0-9a-f]{64}$/),
    manifest_hash: z.string().regex(/^[0-9a-f]{64}$/),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type AssessmentSubmissionRequestV1 = z.infer<
  typeof AssessmentSubmissionRequestV1Schema
>;

export const AssessmentSubmissionV1Schema = z
  .object({
    version: z.literal("assessment-submission.v1"),
    id: z.string().min(1),
    project_id: z.string().min(1),
    run_id: z.string().min(1),
    commit_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
    stage_key: z.string().min(1),
    spec_hash: z.string().regex(/^[0-9a-f]{64}$/),
    config_hash: z.string().regex(/^[0-9a-f]{64}$/),
    manifest_hash: z.string().regex(/^[0-9a-f]{64}$/),
    policy_snapshot_ref: z.string().min(1),
    status: z.enum(["queued", "evaluating", "candidate", "complete", "failed"]),
    submitted_by: z.string().min(1),
    submitted_at: z.string().datetime(),
    completed_at: z.string().datetime().optional(),
  })
  .strict();
export type AssessmentSubmissionV1 = z.infer<
  typeof AssessmentSubmissionV1Schema
>;

export const AssessmentReviewV1Schema = z
  .object({
    version: z.literal("assessment-review.v1"),
    submission_id: z.string().min(1),
    decision: z.enum(["approve", "reject"]),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type AssessmentReviewV1 = z.infer<typeof AssessmentReviewV1Schema>;

export const WorkerLeaseRequestV1Schema = z
  .object({
    version: z.literal("worker-lease-request.v1"),
    worker_id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
  })
  .strict();
export type WorkerLeaseRequestV1 = z.infer<typeof WorkerLeaseRequestV1Schema>;
export const WorkerPipelineLeaseV1Schema = z
  .object({
    version: z.literal("worker-pipeline-lease.v1"),
    worker_id: z.string(),
    lease_expires_at: z.string().datetime(),
    run: z
      .object({
        id: z.string(),
        project_id: z.string(),
        commit_sha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
        stage_key: z.string(),
        scope: z.enum(["public", "staff", "final"]),
        policy_snapshot_ref: z.string(),
        requested_by: z.string(),
        reason: z.string(),
        course_adapter: z.enum(["xv6-spec", "glenda-spec"]).optional(),
      })
      .strict(),
    repository: z.object({ url: z.string().url() }).strict(),
    actor: z
      .object({ id: z.string(), username: z.string(), role: PortalRoleSchema })
      .strict(),
    commit_ledger: z
      .object({
        delivery_id: z.string(),
        before_sha: z.string().optional(),
        after_sha: z.string(),
        pusher_username: z.string().optional(),
        received_at: z.string().datetime(),
      })
      .strict(),
  })
  .strict();
export type WorkerPipelineLeaseV1 = z.infer<typeof WorkerPipelineLeaseV1Schema>;
export const WorkerHeartbeatV1Schema = z
  .object({
    version: z.literal("worker-heartbeat.v1"),
    worker_id: z.string().regex(/^[a-zA-Z0-9_.:-]{1,128}$/),
    run_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type WorkerHeartbeatV1 = z.infer<typeof WorkerHeartbeatV1Schema>;
export const WorkerHeartbeatResultV1Schema = z
  .object({
    version: z.literal("worker-heartbeat-result.v1"),
    accepted: z.literal(true),
    run_status: PipelineStatusSchema.optional(),
    lease_expires_at: z.string().datetime().optional(),
  })
  .strict();
export type WorkerHeartbeatResultV1 = z.infer<
  typeof WorkerHeartbeatResultV1Schema
>;
export const WorkerRunStartV1Schema = z
  .object({
    version: z.literal("worker-run-start.v1"),
    worker_id: z.string(),
    remote_run_id: z.string(),
  })
  .strict();
export type WorkerRunStartV1 = z.infer<typeof WorkerRunStartV1Schema>;
const WorkerStoredObjectV1Schema = z
  .object({
    id: z.string(),
    key: z.string().min(1),
    uri: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.number().int().nonnegative().max(262_144_000),
    content_type: z.string().min(1).max(255),
    visibility: z.enum(["student", "staff"]),
    label: z.string().min(1).max(1000),
    lineage: z.record(z.string(), z.string()),
  })
  .strict();
const WorkerEvidenceRecordV1Schema = z
  .object({
    id: z.string(),
    suite: z.string().min(1).max(100),
    case_name: z.string().min(1).max(200),
    result: z.enum(["pass", "fail"]),
    visibility: z.enum(["student", "staff"]),
    metrics: z.record(z.string(), z.unknown()),
    public_message: z.string().max(1000),
  })
  .strict();
export const WorkerEvidenceReportV1Schema = z
  .object({
    version: z.literal("worker-evidence-report.v1"),
    worker_id: z.string(),
    remote_run_id: z.string(),
    objects: z.array(WorkerStoredObjectV1Schema).max(101),
    evidence: z.array(WorkerEvidenceRecordV1Schema).max(1000),
  })
  .strict();
export type WorkerEvidenceReportV1 = z.infer<
  typeof WorkerEvidenceReportV1Schema
>;
export const WorkerRunCompleteV1Schema = z
  .object({
    version: z.literal("worker-run-complete.v1"),
    worker_id: z.string(),
    remote_run_id: z.string(),
    status: z.enum(["passed", "failed", "cancelled", "timed_out"]),
    failure_class: z.enum(["verification_failure", "infra_failure"]).optional(),
    runner_error: z.string().max(8000).optional(),
    manifest_status: z.string().max(100).optional(),
    manifest_message: z.string().max(4000).optional(),
    evidence_records: z.number().int().nonnegative(),
    objects: z.number().int().nonnegative(),
    runner_image_id: z.string(),
    runner_container_id: z.string(),
  })
  .strict();
export type WorkerRunCompleteV1 = z.infer<typeof WorkerRunCompleteV1Schema>;
export const WorkerAckV1Schema = z
  .object({ version: z.literal("worker-ack.v1"), accepted: z.literal(true) })
  .strict();
export type WorkerAckV1 = z.infer<typeof WorkerAckV1Schema>;

export const RunReproductionV1Schema = z
  .object({
    version: z.literal("run-reproduction.v1"),
    run_id: z.string(),
    project_id: z.string(),
    commit_sha: z.string(),
    stage_key: z.string(),
    scope: z.enum(["public", "staff", "final"]),
    policy_snapshot_ref: z.string(),
    command: z
      .object({ program: z.literal("vos"), arguments: z.array(z.string()) })
      .strict(),
    runner_image_id: z.string().optional(),
    artifacts: z.array(
      z
        .object({
          id: z.string(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          size_bytes: z.number().int().nonnegative(),
          label: z.string(),
        })
        .strict(),
    ),
    created_at: z.string().datetime(),
    finished_at: z.string().datetime().optional(),
  })
  .strict();
export type RunReproductionV1 = z.infer<typeof RunReproductionV1Schema>;

export const ReviewActionV1Schema = z
  .object({
    version: z.literal("review-action.v1").optional(),
    run_id: z.string().min(1),
    action: z.enum(["assign", "rerun", "escalate", "approve"]),
    reason: z.string().min(10),
  })
  .strict();
export type ReviewActionV1 = z.infer<typeof ReviewActionV1Schema>;

export const ArtifactRefV1Schema = z
  .object({
    id: z.string(),
    uri: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.number().int().nonnegative(),
    content_type: z.string(),
    visibility: PortalVisibilitySchema,
    label: z.string(),
  })
  .strict();
export type ArtifactRefV1 = z.infer<typeof ArtifactRefV1Schema>;

export const EvidenceRecordV1Schema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    suite: z.string(),
    case_name: z.string(),
    result: z.enum(["pass", "fail", "error", "skipped"]),
    visibility: PortalVisibilitySchema,
    metrics: z.record(z.string(), z.unknown()),
    public_message: z.string().optional(),
    artifact_ids: z.array(z.string()),
  })
  .strict();

export const EvidenceBundleV1Schema = z
  .object({
    version: z.literal("evidence-bundle.v1"),
    run: PipelineSummaryV1Schema,
    evidence: z.array(EvidenceRecordV1Schema),
    artifacts: z.array(ArtifactRefV1Schema),
  })
  .strict();
export type EvidenceBundleV1 = z.infer<typeof EvidenceBundleV1Schema>;

export const ObjectManifestV1Schema = z
  .object({
    version: z.literal("object-manifest.v1"),
    project_id: z.string(),
    objects: z.array(ArtifactRefV1Schema),
  })
  .strict();
export type ObjectManifestV1 = z.infer<typeof ObjectManifestV1Schema>;

export const ObjectUploadRequestV1Schema = z
  .object({
    run_id: z.string().min(1).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size_bytes: z.number().int().nonnegative().max(2_147_483_648),
    content_type: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\r\n]+$/),
    visibility: z.enum(["public", "student", "staff"]),
    label: z.string().min(1).max(200),
    lineage: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type ObjectUploadRequestV1 = z.infer<typeof ObjectUploadRequestV1Schema>;

export const PresignedObjectRequestSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
    expires_at: z.string().datetime(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type PresignedObjectRequest = z.infer<
  typeof PresignedObjectRequestSchema
>;

export const ObjectUploadResponseV1Schema = z
  .object({
    object_id: z.string().min(1),
    upload: PresignedObjectRequestSchema,
  })
  .strict();
export type ObjectUploadResponseV1 = z.infer<
  typeof ObjectUploadResponseV1Schema
>;

export const MemberAdjustmentV1Schema = z
  .object({
    member_id: z.string(),
    delta: z.number(),
    reason: z.string().min(10),
    evidence_refs: z.array(z.string()).min(1),
  })
  .strict();
export type MemberAdjustmentV1 = z.infer<typeof MemberAdjustmentV1Schema>;

export const ScoreSnapshotV1Schema = z
  .object({
    version: z.literal("score-snapshot.v1"),
    id: z.string(),
    project_id: z.string(),
    baseline: z.number(),
    adjustments: z.array(MemberAdjustmentV1Schema),
    final_score: z.number(),
    state: z.enum(["draft", "frozen", "published"]),
    evidence_refs: z.array(z.string()),
    snapshot_version: z.number().int().nonnegative(),
    previous_snapshot_id: z.string().optional(),
    created_at: z.string().datetime(),
  })
  .strict();
export type ScoreSnapshotV1 = z.infer<typeof ScoreSnapshotV1Schema>;

export const ScoreCalculationV1Schema = z
  .object({
    project_id: z.string().min(1),
    reason: z.string().min(10),
  })
  .strict();
export type ScoreCalculationV1 = z.infer<typeof ScoreCalculationV1Schema>;

export const ScoreAdjustmentInputV1Schema = z
  .object({
    project_id: z.string().min(1),
    member_id: z.string().min(1),
    delta: z.number().finite().min(-100).max(100),
    reason: z.string().min(10),
    evidence_refs: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ScoreAdjustmentInputV1 = z.infer<
  typeof ScoreAdjustmentInputV1Schema
>;

export const ScoreTransitionV1Schema = z
  .object({
    score_snapshot_id: z.string().min(1),
    target_state: z.enum(["frozen", "published"]),
    reason: z.string().min(10),
  })
  .strict();
export type ScoreTransitionV1 = z.infer<typeof ScoreTransitionV1Schema>;

export const AppealRecordV1Schema = z
  .object({
    version: z.literal("appeal.v1"),
    id: z.string(),
    project_id: z.string(),
    member_id: z.string(),
    status: z.enum(["submitted", "fact_check", "decision", "closed"]),
    statement: z.string().min(20),
    evidence_refs: z.array(z.string()),
    score_snapshot_id: z.string(),
    resolved_score_snapshot_id: z.string().optional(),
    decision: z.string().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type AppealRecordV1 = z.infer<typeof AppealRecordV1Schema>;

const DesignAuditReasonSchema = z.string().min(10).max(500);
const DesignInterfaceV1Schema = z
  .object({
    name: z.string().min(1).max(120),
    contract: z.string().min(5).max(2000),
  })
  .strict();
export const DesignSubmissionInputV1Schema = z
  .object({
    version: z.literal("design-submission-input.v1"),
    project_id: z.string(),
    stage_key: z.string().min(1),
    commit_sha: z.string().regex(/^[0-9a-f]{40,64}$/),
    title: z.string().min(3).max(200),
    summary: z.string().min(20).max(10_000),
    invariants: z.array(z.string().min(5).max(1000)).min(1).max(50),
    interfaces: z.array(DesignInterfaceV1Schema).max(50),
    evidence_refs: z.array(z.string()).max(100),
    reason: DesignAuditReasonSchema,
  })
  .strict();
export type DesignSubmissionInputV1 = z.infer<
  typeof DesignSubmissionInputV1Schema
>;
export const DesignSubmissionV1Schema = DesignSubmissionInputV1Schema.omit({
  reason: true,
})
  .extend({
    version: z.literal("design-submission.v1"),
    id: z.string(),
    revision: z.number().int().positive(),
    status: z.enum([
      "submitted",
      "review",
      "passed",
      "changes_requested",
      "frozen",
    ]),
    submitted_by: z.string(),
    reviewed_by: z.string().optional(),
    review_feedback: z.string().optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type DesignSubmissionV1 = z.infer<typeof DesignSubmissionV1Schema>;
export const DesignReviewInputV1Schema = z
  .object({
    version: z.literal("design-review-input.v1"),
    submission_id: z.string(),
    target_status: z.enum(["review", "passed", "changes_requested", "frozen"]),
    feedback: z.string().min(10).max(10_000),
    reason: DesignAuditReasonSchema,
  })
  .strict();
export type DesignReviewInputV1 = z.infer<typeof DesignReviewInputV1Schema>;

export const AppealSubmitV1Schema = z
  .object({
    project_id: z.string().min(1),
    statement: z.string().min(20),
    evidence_refs: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type AppealSubmitV1 = z.infer<typeof AppealSubmitV1Schema>;

export const AppealTransitionV1Schema = z
  .object({
    appeal_id: z.string().min(1),
    target_status: z.enum(["fact_check", "decision", "closed"]),
    reason: z.string().min(10),
    decision: z.string().min(20).optional(),
    score_delta: z.number().finite().min(-100).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.target_status === "decision" && !value.decision)
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "decision is required",
      });
    if (
      value.target_status !== "decision" &&
      (value.decision !== undefined || value.score_delta !== undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "decision and score_delta are only valid for a decision transition",
      });
  });
export type AppealTransitionV1 = z.infer<typeof AppealTransitionV1Schema>;

export const QaThreadV1Schema = z
  .object({
    version: z.literal("qa-thread.v1"),
    id: z.string(),
    project_id: z.string(),
    stage_key: z.string(),
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["user", "assistant", "system"]),
          content: z.string(),
          object_refs: z.array(z.string()),
          created_at: z.string().datetime(),
        })
        .strict(),
    ),
  })
  .strict();
export type QaThreadV1 = z.infer<typeof QaThreadV1Schema>;

export const AgentAuditV1Schema = z
  .object({
    version: z.literal("agent-audit.v1"),
    id: z.string(),
    project_id: z.string(),
    actor_id: z.string(),
    model: z.string(),
    task_kind: z.string(),
    risk_level: z.enum(["low", "medium", "high", "critical"]),
    risk_flags: z.array(z.string()),
    prompt_summary: z.string(),
    response_summary: z.string().optional(),
    provider: z.string().optional(),
    provider_session_id: z.string().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
    actual_cost_usd: z.number().nonnegative().optional(),
    created_at: z.string().datetime(),
  })
  .strict();
export type AgentAuditV1 = z.infer<typeof AgentAuditV1Schema>;

export const ModelCredentialInputV1Schema = z
  .object({
    version: z.literal("model-credential-input.v1"),
    provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/),
    label: z.string().min(1).max(100),
    secret: z.string().min(16).max(8192),
    reason: z.string().min(10).max(1000),
  })
  .strict();
export type ModelCredentialInputV1 = z.infer<
  typeof ModelCredentialInputV1Schema
>;

export const ModelCredentialRefV1Schema = z
  .object({
    version: z.literal("model-credential-ref.v1"),
    id: z.string(),
    owner_id: z.string(),
    provider: z.string(),
    label: z.string(),
    last_four: z.string().length(4),
    created_at: z.string().datetime(),
    revoked_at: z.string().datetime().optional(),
  })
  .strict();
export type ModelCredentialRefV1 = z.infer<typeof ModelCredentialRefV1Schema>;

export const ModelProviderKindSchema = z.enum([
  "openai",
  "openai-compatible",
  "anthropic",
  "deepseek",
  "ollama",
]);
export type ModelProviderKind = z.infer<typeof ModelProviderKindSchema>;

const ModelProviderBaseUrlSchema = z.string().url().max(500);
const ModelProviderInputFieldsV1Schema = z
  .object({
    version: z.literal("model-provider-input.v1"),
    id: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/),
    name: z.string().min(1).max(100),
    kind: ModelProviderKindSchema,
    base_url: ModelProviderBaseUrlSchema,
    models: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/))
      .min(1)
      .max(100),
    default_model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/),
    secret: z.string().min(16).max(8192).optional(),
    input_cost_per_million_usd: z.number().nonnegative().max(10000),
    output_cost_per_million_usd: z.number().nonnegative().max(10000),
    max_output_tokens: z.number().int().min(256).max(131072),
    enabled: z.boolean(),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export const ModelProviderInputV1Schema =
  ModelProviderInputFieldsV1Schema.superRefine((value, context) => {
    if (!value.models.includes(value.default_model))
      context.addIssue({
        code: "custom",
        path: ["default_model"],
        message: "default_model must be listed in models",
      });
    const url = new URL(value.base_url);
    const internalHttp =
      value.kind === "ollama" &&
      url.protocol === "http:" &&
      /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+|[a-z0-9.-]+\.internal)$/i.test(
        url.hostname,
      );
    if (url.protocol !== "https:" && !internalHttp)
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message:
          "provider base_url must use HTTPS; Ollama may use an internal HTTP host",
      });
  });
export type ModelProviderInputV1 = z.infer<typeof ModelProviderInputV1Schema>;

export const ModelProviderSummaryV1Schema =
  ModelProviderInputFieldsV1Schema.omit({
    secret: true,
    reason: true,
    expected_revision: true,
  })
    .extend({
      version: z.literal("model-provider-summary.v1"),
      secret_configured: z.boolean(),
      revision: z.number().int().positive(),
      updated_at: z.string().datetime(),
    })
    .strict();
export type ModelProviderSummaryV1 = z.infer<
  typeof ModelProviderSummaryV1Schema
>;

export const ModelQuotaPolicyInputV1Schema = z
  .object({
    version: z.literal("model-quota-policy-input.v1"),
    course_id: z.string().min(1),
    user_id: z.string().min(1).optional(),
    monthly_request_limit: z.number().int().min(1).max(1_000_000),
    monthly_token_limit: z.number().int().min(1_000).max(10_000_000_000),
    monthly_cost_limit_usd: z.number().positive().max(1_000_000),
    enabled: z.boolean(),
    expected_revision: z.number().int().nonnegative(),
    reason: z.string().min(10).max(500),
  })
  .strict();
export type ModelQuotaPolicyInputV1 = z.infer<
  typeof ModelQuotaPolicyInputV1Schema
>;

export const ModelQuotaPolicyV1Schema = ModelQuotaPolicyInputV1Schema.omit({
  reason: true,
  expected_revision: true,
})
  .extend({
    version: z.literal("model-quota-policy.v1"),
    id: z.string(),
    revision: z.number().int().positive(),
    period: z.string().regex(/^\d{4}-\d{2}$/),
    used_requests: z.number().int().nonnegative(),
    used_tokens: z.number().int().nonnegative(),
    used_cost_usd: z.number().nonnegative(),
    reserved_requests: z.number().int().nonnegative(),
    reserved_tokens: z.number().int().nonnegative(),
    reserved_cost_usd: z.number().nonnegative(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type ModelQuotaPolicyV1 = z.infer<typeof ModelQuotaPolicyV1Schema>;

export const AdminSystemStatusV1Schema = z
  .object({
    version: z.literal("admin-system-status.v1"),
    checked_at: z.string().datetime(),
    overall: z.enum(["healthy", "degraded", "unavailable"]),
    services: z.array(
      z
        .object({
          id: z.enum(["postgres", "gitea", "minio"]),
          status: z.enum(["healthy", "unavailable"]),
          detail: z.string().max(500),
        })
        .strict(),
    ),
    workers: z.array(
      z
        .object({
          id: z.string(),
          status: z.enum(["online", "stale"]),
          last_heartbeat: z.string().datetime(),
          current_run_id: z.string().optional(),
        })
        .strict(),
    ),
    queues: z
      .object({
        pipeline_queued: z.number().int().nonnegative(),
        pipeline_active: z.number().int().nonnegative(),
        outbox_pending: z.number().int().nonnegative(),
        provisioning_pending: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type AdminSystemStatusV1 = z.infer<typeof AdminSystemStatusV1Schema>;
export const RetentionPolicyV1Schema = z
  .object({
    version: z.literal("retention-policy.v1"),
    ordinary_days: z.number().int().min(1).max(365),
    records_days: z.number().int().min(30).max(3650),
    revision: z.number().int().positive(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type RetentionPolicyV1 = z.infer<typeof RetentionPolicyV1Schema>;
export const RetentionPolicyUpdateV1Schema = z
  .object({
    ordinary_days: z.number().int().min(1).max(365),
    records_days: z.number().int().min(30).max(3650),
    expected_revision: z.number().int().positive(),
    reason: z.string().min(10).max(500),
  })
  .strict()
  .refine((value) => value.records_days > value.ordinary_days, {
    message: "records_days must be greater than ordinary_days",
    path: ["records_days"],
  });
export type RetentionPolicyUpdateV1 = z.infer<
  typeof RetentionPolicyUpdateV1Schema
>;

export const NotificationV1Schema = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    read: z.boolean(),
    created_at: z.string().datetime(),
  })
  .strict();
export type NotificationV1 = z.infer<typeof NotificationV1Schema>;

export const NotificationReadV1Schema = z
  .object({ notification_id: z.string(), read: z.boolean() })
  .strict();
export type NotificationReadV1 = z.infer<typeof NotificationReadV1Schema>;

export const PortalContextV1Schema = z
  .object({
    version: z.literal("portal-context.v1"),
    course: z
      .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        term: z.string(),
      })
      .strict(),
    project: z
      .object({
        id: z.string(),
        status: z.enum([
          "provisioning",
          "active",
          "frozen",
          "graded",
          "archived",
        ]),
        experiment_id: z.string(),
        stage_key: z.string(),
        stage_name: z.string(),
      })
      .strict(),
  })
  .strict();
export type PortalContextV1 = z.infer<typeof PortalContextV1Schema>;

export const PortalDashboardSchema = z
  .object({
    actor: PortalActorSchema,
    course: z
      .object({
        id: z.string(),
        code: z.string(),
        name: z.string(),
        term: z.string(),
        status: z.string(),
      })
      .strict(),
    project: ProjectBindingV1Schema,
    stages: z.array(StageGateSchema),
    runs: z.array(PipelineSummaryV1Schema),
    score: ScoreSnapshotV1Schema,
    notifications: z.array(NotificationV1Schema),
  })
  .strict();
export type PortalDashboard = z.infer<typeof PortalDashboardSchema>;
export const CourseOperationsV2Schema = z
  .object({
    version: z.literal("course-operations.v2"),
    course_id: z.string(),
    generated_at: z.string().datetime(),
    projects: z.array(
      z
        .object({
          project_id: z.string(),
          status: z.enum([
            "provisioning",
            "active",
            "frozen",
            "graded",
            "archived",
          ]),
          stage_key: z.string(),
          stage_name: z.string(),
          member_names: z.array(z.string()),
          latest_run: z
            .object({
              id: z.string(),
              status: z.enum([
                "queued",
                "leased",
                "running",
                "passed",
                "failed",
                "cancelled",
                "timed_out",
              ]),
              stage_key: z.string(),
              created_at: z.string().datetime(),
              passed: z.number().int().nonnegative(),
              total: z.number().int().nonnegative(),
              failure_class: z.string().optional(),
              public_message: z.string().optional(),
            })
            .strict()
            .optional(),
          score_state: z.enum(["draft", "frozen", "published"]).optional(),
          final_score: z.number().optional(),
          failed_runs: z.number().int().nonnegative(),
          open_appeals: z.number().int().nonnegative(),
          design_status: z
            .enum([
              "submitted",
              "review",
              "passed",
              "changes_requested",
              "frozen",
            ])
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type CourseOperationsV2 = z.infer<typeof CourseOperationsV2Schema>;

export const PortalContractSchemas = {
  CourseManifestV1: CourseManifestV1Schema,
  CourseManifestDryRunV1: CourseManifestDryRunV1Schema,
  CourseManifestVersionV1: CourseManifestVersionV1Schema,
  CourseManifestImportV1: CourseManifestImportV1Schema,
  CourseManifestPublishV1: CourseManifestPublishV1Schema,
  CourseManifestRollbackV1: CourseManifestRollbackV1Schema,
  EnrollmentCsvImportV1: EnrollmentCsvImportV1Schema,
  EnrollmentImportResultV1: EnrollmentImportResultV1Schema,
  EnrollmentInviteCreateV1: EnrollmentInviteCreateV1Schema,
  EnrollmentInviteSummaryV1: EnrollmentInviteSummaryV1Schema,
  EnrollmentInviteIssuedV1: EnrollmentInviteIssuedV1Schema,
  EnrollmentInviteRedeemV1: EnrollmentInviteRedeemV1Schema,
  EnrollmentInviteRedemptionV1: EnrollmentInviteRedemptionV1Schema,
  CourseGroupV1: CourseGroupV1Schema,
  CourseGroupMutationV1: CourseGroupMutationV1Schema,
  OidcProviderInputV1: OidcProviderInputV1Schema,
  OidcProviderSummaryV1: OidcProviderSummaryV1Schema,
  OAuthProviderInputV1: OAuthProviderInputV1Schema,
  OAuthProviderSummaryV1: OAuthProviderSummaryV1Schema,
  PolicySnapshotV1: PolicySnapshotV1Schema,
  ProjectBindingV1: ProjectBindingV1Schema,
  ProjectProvisionRequestV1: ProjectProvisionRequestV1Schema,
  ProjectProvisionStatusV1: ProjectProvisionStatusV1Schema,
  ProjectProvisionOptionsV1: ProjectProvisionOptionsV1Schema,
  PipelineRequestV1: PipelineRequestV1Schema,
  PipelineEventV1: PipelineEventV1Schema,
  PipelineSummaryV1: PipelineSummaryV1Schema,
  AssessmentSubmissionRequestV1: AssessmentSubmissionRequestV1Schema,
  AssessmentSubmissionV1: AssessmentSubmissionV1Schema,
  WorkerLeaseRequestV1: WorkerLeaseRequestV1Schema,
  WorkerPipelineLeaseV1: WorkerPipelineLeaseV1Schema,
  WorkerHeartbeatV1: WorkerHeartbeatV1Schema,
  WorkerHeartbeatResultV1: WorkerHeartbeatResultV1Schema,
  WorkerRunStartV1: WorkerRunStartV1Schema,
  WorkerEvidenceReportV1: WorkerEvidenceReportV1Schema,
  WorkerRunCompleteV1: WorkerRunCompleteV1Schema,
  WorkerAckV1: WorkerAckV1Schema,
  RunReproductionV1: RunReproductionV1Schema,
  ReviewActionV1: ReviewActionV1Schema,
  EvidenceBundleV1: EvidenceBundleV1Schema,
  ArtifactRefV1: ArtifactRefV1Schema,
  ObjectManifestV1: ObjectManifestV1Schema,
  ObjectUploadRequestV1: ObjectUploadRequestV1Schema,
  PresignedObjectRequest: PresignedObjectRequestSchema,
  ObjectUploadResponseV1: ObjectUploadResponseV1Schema,
  ScoreSnapshotV1: ScoreSnapshotV1Schema,
  ScoreCalculationV1: ScoreCalculationV1Schema,
  ScoreAdjustmentInputV1: ScoreAdjustmentInputV1Schema,
  ScoreTransitionV1: ScoreTransitionV1Schema,
  MemberAdjustmentV1: MemberAdjustmentV1Schema,
  AppealRecordV1: AppealRecordV1Schema,
  AppealSubmitV1: AppealSubmitV1Schema,
  AppealTransitionV1: AppealTransitionV1Schema,
  DesignSubmissionInputV1: DesignSubmissionInputV1Schema,
  DesignSubmissionV1: DesignSubmissionV1Schema,
  DesignReviewInputV1: DesignReviewInputV1Schema,
  QaThreadV1: QaThreadV1Schema,
  AgentAuditV1: AgentAuditV1Schema,
  ModelCredentialInputV1: ModelCredentialInputV1Schema,
  ModelCredentialRefV1: ModelCredentialRefV1Schema,
  ModelProviderInputV1: ModelProviderInputV1Schema,
  ModelProviderSummaryV1: ModelProviderSummaryV1Schema,
  ModelQuotaPolicyInputV1: ModelQuotaPolicyInputV1Schema,
  ModelQuotaPolicyV1: ModelQuotaPolicyV1Schema,
  NotificationV1: NotificationV1Schema,
  NotificationReadV1: NotificationReadV1Schema,
  PortalError: PortalErrorSchema,
  PortalActor: PortalActorSchema,
  PortalContextV1: PortalContextV1Schema,
  PortalDashboard: PortalDashboardSchema,
} as const;

function portalOpenApiDocumentLegacy(): Record<string, unknown> {
  const schemas = Object.fromEntries(
    Object.entries(PortalContractSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { unrepresentable: "any" }),
    ]),
  );
  const json = (schema: string) => ({
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  });
  return {
    openapi: "3.1.0",
    info: { title: "VOS Portal API", version: "1.0.0" },
    paths: {
      "/api/v1/auth/me": {
        get: {
          responses: {
            "200": {
              description: "Current actor",
              content: json("PortalActor"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/binding": {
        get: {
          parameters: [
            {
              name: "project_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Project binding",
              content: json("ProjectBindingV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/vos-policy": {
        get: {
          parameters: [
            {
              name: "project_id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Effective policy",
              content: json("PolicySnapshotV1"),
            },
          },
        },
      },
      "/api/v1/pipelines": {
        post: {
          requestBody: { required: true, content: json("PipelineRequestV1") },
          responses: {
            "202": {
              description: "Queued run",
              content: json("PipelineSummaryV1"),
            },
          },
        },
      },
      "/api/v1/pipelines/{run_id}": {
        get: {
          responses: {
            "200": {
              description: "Run summary",
              content: json("PipelineSummaryV1"),
            },
          },
        },
      },
      "/api/v1/pipelines/{run_id}/events": {
        get: {
          responses: {
            "200": {
              description: "SSE stream",
              content: {
                "text/event-stream": {
                  schema: { $ref: "#/components/schemas/PipelineEventV1" },
                },
              },
            },
          },
        },
      },
      "/api/v1/pipelines/{run_id}/evidence": {
        get: {
          responses: {
            "200": {
              description: "Evidence projection",
              content: json("EvidenceBundleV1"),
            },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        cookieSession: { type: "apiKey", in: "cookie", name: "vos_session" },
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ cookieSession: [] }, { bearerAuth: [] }],
  };
}

export function portalOpenApiDocument(): Record<string, unknown> {
  const legacy = portalOpenApiDocumentLegacy() as {
    paths: Record<string, unknown>;
  };
  const schemas = Object.fromEntries(
    [
      ...Object.entries(PortalContractSchemas),
      ["AssessmentReviewV1", AssessmentReviewV1Schema] as const,
      ["ServiceTokenCreateV1", ServiceTokenCreateV1Schema] as const,
      ["ServiceTokenSummaryV1", ServiceTokenSummaryV1Schema] as const,
      ["ServiceTokenIssuedV1", ServiceTokenIssuedV1Schema] as const,
      ["AdminSystemStatusV1", AdminSystemStatusV1Schema] as const,
      ["RetentionPolicyV1", RetentionPolicyV1Schema] as const,
      ["RetentionPolicyUpdateV1", RetentionPolicyUpdateV1Schema] as const,
      ["CourseOperationsV2", CourseOperationsV2Schema] as const,
    ].map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { unrepresentable: "any" }),
    ]),
  );
  const json = (schema: string) => ({
    "application/json": { schema: { $ref: `#/components/schemas/${schema}` } },
  });
  const parameter = (name: string) => [
    { name, in: "path", required: true, schema: { type: "string" } },
  ];
  return {
    ...legacy,
    paths: {
      ...legacy.paths,
      "/api/v1/auth/login": {
        post: {
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  additionalProperties: false,
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Authenticated actor and secure session cookies",
              content: json("PortalActor"),
            },
          },
        },
      },
      "/api/v1/auth/device/code": {
        post: {
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["client_name"],
                  additionalProperties: false,
                  properties: { client_name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": { description: "Short-lived CLI device authorization" },
          },
        },
      },
      "/api/v1/auth/device/token": {
        post: {
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["device_code"],
                  additionalProperties: false,
                  properties: { device_code: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Approved short-lived CLI bearer token" },
            "428": { description: "Authorization is pending" },
          },
        },
      },
      "/api/v1/auth/device/approve": {
        post: {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["user_code"],
                  additionalProperties: false,
                  properties: { user_code: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Device authorization approved" },
          },
        },
      },
      "/api/v1/auth/logout": {
        post: {
          responses: {
            "200": { description: "Web session revoked and cookie cleared" },
          },
        },
      },
      "/api/v1/auth/revoke": {
        post: {
          responses: {
            "200": { description: "Current session or CLI token revoked" },
          },
        },
      },
      "/api/v1/auth/service-tokens": {
        get: {
          responses: {
            "200": {
              description:
                "Administrator service-token metadata without secrets",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ServiceTokenSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            required: true,
            content: json("ServiceTokenCreateV1"),
          },
          responses: {
            "201": {
              description: "One-time service-token issuance",
              content: json("ServiceTokenIssuedV1"),
            },
          },
        },
      },
      "/api/v1/auth/service-tokens/{token_id}/revoke": {
        post: {
          parameters: parameter("token_id"),
          responses: {
            "200": {
              description: "Service token revoked",
              content: json("ServiceTokenSummaryV1"),
            },
          },
        },
      },
      "/api/v1/contexts": {
        get: {
          responses: {
            "200": {
              description: "Accessible course and project contexts",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/PortalContextV1" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/dashboard": {
        get: {
          parameters: [
            {
              name: "project_id",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Role-projected Portal dashboard",
              content: json("PortalDashboard"),
            },
          },
        },
      },
      "/api/v1/internal/gitea/webhook": {
        post: {
          security: [{ giteaWebhook: [] }],
          responses: {
            "202": { description: "Signed Gitea push accepted" },
            "200": { description: "Duplicate delivery ignored" },
          },
        },
      },
      "/api/v1/internal/worker/lease": {
        post: {
          security: [{ workerBearer: [] }],
          requestBody: {
            required: true,
            content: json("WorkerLeaseRequestV1"),
          },
          responses: {
            "200": {
              description: "Leased pipeline context or null",
              content: json("WorkerPipelineLeaseV1"),
            },
          },
        },
      },
      "/api/v1/internal/worker/heartbeat": {
        post: {
          security: [{ workerBearer: [] }],
          requestBody: { required: true, content: json("WorkerHeartbeatV1") },
          responses: {
            "200": {
              description: "Worker and optional run lease renewed",
              content: json("WorkerHeartbeatResultV1"),
            },
          },
        },
      },
      "/api/v1/internal/worker/runs/{run_id}/start": {
        post: {
          security: [{ workerBearer: [] }],
          parameters: parameter("run_id"),
          requestBody: { required: true, content: json("WorkerRunStartV1") },
          responses: {
            "200": {
              description: "Leased run entered running state",
              content: json("WorkerAckV1"),
            },
          },
        },
      },
      "/api/v1/internal/worker/runs/{run_id}/evidence": {
        post: {
          security: [{ workerBearer: [] }],
          parameters: parameter("run_id"),
          requestBody: {
            required: true,
            content: json("WorkerEvidenceReportV1"),
          },
          responses: {
            "200": {
              description: "Verified evidence and object metadata committed",
              content: json("WorkerAckV1"),
            },
          },
        },
      },
      "/api/v1/internal/worker/runs/{run_id}/complete": {
        post: {
          security: [{ workerBearer: [] }],
          parameters: parameter("run_id"),
          requestBody: { required: true, content: json("WorkerRunCompleteV1") },
          responses: {
            "200": {
              description: "Owned run committed to a terminal state",
              content: json("WorkerAckV1"),
            },
          },
        },
      },
      "/api/v1/auth/oidc/providers": {
        get: {
          security: [],
          responses: {
            "200": {
              description: "Enabled OIDC providers without credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/OidcProviderSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/auth/oidc/{provider_id}/start": {
        get: {
          security: [],
          parameters: parameter("provider_id"),
          responses: {
            "302": {
              description: "Redirect to the provider authorization endpoint",
            },
          },
        },
      },
      "/api/v1/auth/oidc/{provider_id}/callback": {
        get: {
          security: [],
          parameters: parameter("provider_id"),
          responses: {
            "302": { description: "Create a web session and redirect locally" },
          },
        },
      },
      "/api/v1/auth/oauth/providers": {
        get: {
          security: [],
          responses: {
            "200": {
              description: "Enabled OAuth 2.0 providers without credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/OAuthProviderSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/auth/oauth/{provider_id}/start": {
        get: {
          security: [],
          parameters: parameter("provider_id"),
          responses: {
            "302": {
              description: "Redirect to the OAuth 2.0 authorization endpoint",
            },
          },
        },
      },
      "/api/v1/auth/oauth/{provider_id}/callback": {
        get: {
          security: [],
          parameters: parameter("provider_id"),
          responses: {
            "302": { description: "Create a web session and redirect locally" },
          },
        },
      },
      "/api/v1/admin/oidc/providers": {
        get: {
          responses: {
            "200": {
              description: "OIDC provider configurations without credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/OidcProviderSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: { required: true, content: json("OidcProviderInputV1") },
          responses: {
            "200": {
              description: "Encrypted OIDC provider configuration",
              content: json("OidcProviderSummaryV1"),
            },
          },
        },
      },
      "/api/v1/admin/oauth/providers": {
        get: {
          responses: {
            "200": {
              description: "OAuth 2.0 provider configurations without credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/OAuthProviderSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: { required: true, content: json("OAuthProviderInputV1") },
          responses: {
            "200": {
              description: "Encrypted OAuth 2.0 provider configuration",
              content: json("OAuthProviderSummaryV1"),
            },
          },
        },
      },
      "/api/v1/admin/system/status": {
        get: {
          responses: {
            "200": {
              description: "Administrator service, worker, and queue status",
              content: json("AdminSystemStatusV1"),
            },
          },
        },
      },
      "/api/v1/admin/retention": {
        get: {
          responses: {
            "200": {
              description: "Active retention policy",
              content: json("RetentionPolicyV1"),
            },
          },
        },
        put: {
          requestBody: {
            required: true,
            content: json("RetentionPolicyUpdateV1"),
          },
          responses: {
            "200": {
              description: "Updated retention policy",
              content: json("RetentionPolicyV1"),
            },
          },
        },
      },
      "/api/v1/admin/model-providers": {
        get: {
          responses: {
            "200": {
              description: "Model provider metadata without credentials",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ModelProviderSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
        put: {
          requestBody: {
            required: true,
            content: json("ModelProviderInputV1"),
          },
          responses: {
            "200": {
              description: "Encrypted model provider configuration",
              content: json("ModelProviderSummaryV1"),
            },
          },
        },
      },
      "/api/v1/admin/model-quotas": {
        get: {
          responses: {
            "200": {
              description:
                "Course and user model quotas with current-period usage",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/ModelQuotaPolicyV1" },
                  },
                },
              },
            },
          },
        },
        put: {
          requestBody: {
            required: true,
            content: json("ModelQuotaPolicyInputV1"),
          },
          responses: {
            "200": {
              description: "Updated model quota policy",
              content: json("ModelQuotaPolicyV1"),
            },
          },
        },
      },
      "/api/v1/courses/import/dry-run": {
        post: {
          responses: {
            "200": {
              description: "Validated manifest diff",
              content: json("CourseManifestDryRunV1"),
            },
          },
        },
      },
      "/api/v1/courses/import": {
        post: {
          requestBody: {
            required: true,
            content: json("CourseManifestImportV1"),
          },
          responses: {
            "201": {
              description: "Immutable draft manifest",
              content: json("CourseManifestVersionV1"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/versions": {
        get: {
          parameters: parameter("course_id"),
          responses: {
            "200": {
              description: "Manifest history",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/CourseManifestVersionV1",
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/operations": {
        get: {
          parameters: parameter("course_id"),
          responses: {
            "200": {
              description:
                "Staff class-level project, stage, run, grade, appeal and design projection",
              content: json("CourseOperationsV2"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/publish": {
        post: {
          parameters: parameter("course_id"),
          requestBody: {
            required: true,
            content: json("CourseManifestPublishV1"),
          },
          responses: {
            "200": {
              description: "Published manifest snapshot",
              content: json("CourseManifestVersionV1"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/rollback": {
        post: {
          parameters: parameter("course_id"),
          requestBody: {
            required: true,
            content: json("CourseManifestRollbackV1"),
          },
          responses: {
            "200": {
              description: "New published rollback snapshot",
              content: json("CourseManifestVersionV1"),
            },
          },
        },
      },
      "/api/v1/enrollment/csv": {
        post: {
          requestBody: {
            required: true,
            content: json("EnrollmentCsvImportV1"),
          },
          responses: {
            "200": {
              description: "Enrollment dry-run or import result",
              content: json("EnrollmentImportResultV1"),
            },
          },
        },
      },
      "/api/v1/enrollment/invites": {
        get: {
          responses: {
            "200": {
              description: "Course-scoped enrollment invites",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/EnrollmentInviteSummaryV1",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            required: true,
            content: json("EnrollmentInviteCreateV1"),
          },
          responses: {
            "201": {
              description: "Issued invite; plaintext code is returned once",
              content: json("EnrollmentInviteIssuedV1"),
            },
          },
        },
      },
      "/api/v1/enrollment/invites/redeem": {
        post: {
          requestBody: {
            required: true,
            content: json("EnrollmentInviteRedeemV1"),
          },
          responses: {
            "200": {
              description: "Invite redemption and course membership",
              content: json("EnrollmentInviteRedemptionV1"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/groups": {
        get: {
          parameters: parameter("course_id"),
          responses: {
            "200": {
              description: "Course groups and their active student members",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/CourseGroupV1" },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: parameter("course_id"),
          requestBody: {
            required: true,
            content: json("CourseGroupMutationV1"),
          },
          responses: {
            "201": {
              description: "Created course group",
              content: json("CourseGroupV1"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/groups/{group_id}": {
        put: {
          parameters: [...parameter("course_id"), ...parameter("group_id")],
          requestBody: {
            required: true,
            content: json("CourseGroupMutationV1"),
          },
          responses: {
            "200": {
              description: "Updated course group membership",
              content: json("CourseGroupV1"),
            },
          },
        },
      },
      "/api/v1/projects": {
        post: {
          requestBody: {
            required: true,
            content: json("ProjectProvisionRequestV1"),
          },
          responses: {
            "202": {
              description: "Project provisioning queued",
              content: json("ProjectProvisionStatusV1"),
            },
          },
        },
      },
      "/api/v1/projects/provisioning/options": {
        get: {
          responses: {
            "200": {
              description: "Published experiments and eligible members",
              content: json("ProjectProvisionOptionsV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/provisioning": {
        get: {
          parameters: parameter("project_id"),
          responses: {
            "200": {
              description: "Project provisioning status",
              content: json("ProjectProvisionStatusV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/provision/retry": {
        post: {
          parameters: parameter("project_id"),
          responses: {
            "202": {
              description: "Project provisioning requeued",
              content: json("ProjectProvisionStatusV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/objects/manifest": {
        get: {
          parameters: parameter("project_id"),
          responses: {
            "200": {
              description: "Verified object projection",
              content: json("ObjectManifestV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/design-submissions": {
        get: {
          parameters: parameter("project_id"),
          responses: {
            "200": {
              description: "Visible immutable design submission revisions",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/DesignSubmissionV1" },
                  },
                },
              },
            },
          },
        },
        post: {
          parameters: parameter("project_id"),
          requestBody: {
            required: true,
            content: json("DesignSubmissionInputV1"),
          },
          responses: {
            "201": {
              description: "Submitted design revision",
              content: json("DesignSubmissionV1"),
            },
          },
        },
      },
      "/api/v1/design-submissions/{submission_id}/review": {
        post: {
          parameters: parameter("submission_id"),
          requestBody: { required: true, content: json("DesignReviewInputV1") },
          responses: {
            "200": {
              description: "Reviewed design revision",
              content: json("DesignSubmissionV1"),
            },
          },
        },
      },
      "/api/v1/pipelines/{run_id}/reproduction": {
        get: {
          parameters: parameter("run_id"),
          responses: {
            "200": {
              description:
                "Immutable commit, policy, runner image and artifact checksums needed to reproduce a run",
              content: json("RunReproductionV1"),
            },
          },
        },
      },
      "/api/v1/pipelines/{run_id}/cancel": {
        post: {
          parameters: parameter("run_id"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["reason"],
                  additionalProperties: false,
                  properties: {
                    reason: { type: "string", minLength: 10, maxLength: 500 },
                  },
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Cancellation requested",
              content: json("PipelineSummaryV1"),
            },
          },
        },
      },
      "/api/v1/submissions": {
        post: {
          requestBody: {
            required: true,
            content: json("AssessmentSubmissionRequestV1"),
          },
          responses: {
            "202": {
              description: "Authoritative assessment submission queued",
              content: json("AssessmentSubmissionV1"),
            },
          },
        },
      },
      "/api/v1/submissions/{submission_id}": {
        get: {
          parameters: parameter("submission_id"),
          responses: {
            "200": {
              description: "Authoritative assessment submission",
              content: json("AssessmentSubmissionV1"),
            },
          },
        },
      },
      "/api/v1/submissions/{submission_id}/review": {
        post: {
          parameters: parameter("submission_id"),
          requestBody: { required: true, content: json("AssessmentReviewV1") },
          responses: {
            "200": {
              description: "Teacher human-gate decision",
              content: json("AssessmentSubmissionV1"),
            },
          },
        },
      },
      "/api/v1/projects/{project_id}/objects/uploads": {
        post: {
          parameters: parameter("project_id"),
          requestBody: {
            required: true,
            content: json("ObjectUploadRequestV1"),
          },
          responses: {
            "201": {
              description: "Pending object and signed upload",
              content: json("ObjectUploadResponseV1"),
            },
          },
        },
      },
      "/api/v1/objects/{object_id}/complete": {
        post: {
          parameters: parameter("object_id"),
          responses: { "200": { description: "Object verified" } },
        },
      },
      "/api/v1/objects/{object_id}/download": {
        post: {
          parameters: parameter("object_id"),
          responses: {
            "200": {
              description: "Authorized signed download",
              content: json("PresignedObjectRequest"),
            },
          },
        },
      },
      "/api/v1/courses/{course_id}/state": {
        post: {
          parameters: parameter("course_id"),
          responses: {
            "200": { description: "Validated course state transition" },
          },
        },
      },
      "/api/v1/reviews": {
        post: {
          requestBody: { required: true, content: json("ReviewActionV1") },
          responses: {
            "200": { description: "Persisted review action or approved rerun" },
          },
        },
      },
      "/api/v1/grades/calculate": {
        post: {
          requestBody: { required: true, content: json("ScoreCalculationV1") },
          responses: {
            "201": {
              description: "Immutable automatic score snapshot",
              content: json("ScoreSnapshotV1"),
            },
          },
        },
      },
      "/api/v1/grades/adjust": {
        post: {
          requestBody: {
            required: true,
            content: json("ScoreAdjustmentInputV1"),
          },
          responses: {
            "201": {
              description: "Immutable adjusted score snapshot",
              content: json("ScoreSnapshotV1"),
            },
          },
        },
      },
      "/api/v1/grades/transition": {
        post: {
          requestBody: { required: true, content: json("ScoreTransitionV1") },
          responses: {
            "201": {
              description: "Frozen or published score snapshot",
              content: json("ScoreSnapshotV1"),
            },
          },
        },
      },
      "/api/v1/appeals": {
        get: {
          responses: {
            "200": {
              description: "Visible appeal records",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AppealRecordV1" },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: { required: true, content: json("AppealSubmitV1") },
          responses: {
            "201": {
              description: "Submitted appeal",
              content: json("AppealRecordV1"),
            },
          },
        },
      },
      "/api/v1/appeals/{appeal_id}/transition": {
        post: {
          parameters: parameter("appeal_id"),
          requestBody: { required: true, content: json("AppealTransitionV1") },
          responses: {
            "201": {
              description: "Fact check, decision, or closed appeal snapshot",
              content: json("AppealRecordV1"),
            },
          },
        },
      },
      "/api/v1/ai/qa": {
        post: {
          responses: {
            "202": {
              description: "Queued course Q&A request",
              content: json("QaThreadV1"),
            },
          },
        },
      },
      "/api/v1/ai/qa/{thread_id}": {
        get: {
          parameters: parameter("thread_id"),
          responses: {
            "200": {
              description: "Visible Q&A transcript",
              content: json("QaThreadV1"),
            },
          },
        },
      },
      "/api/v1/ai/qa/{thread_id}/events": {
        get: {
          parameters: parameter("thread_id"),
          responses: {
            "200": {
              description: "Q&A SSE transcript updates",
              content: {
                "text/event-stream": {
                  schema: { $ref: "#/components/schemas/QaThreadV1" },
                },
              },
            },
          },
        },
      },
      "/api/v1/ai/audits": {
        get: {
          responses: {
            "200": {
              description: "Staff Agent audit projection",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/AgentAuditV1" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/ai/credentials": {
        get: {
          responses: {
            "200": {
              description:
                "Credential metadata visible to its owner; secrets are never returned",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      $ref: "#/components/schemas/ModelCredentialRefV1",
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            required: true,
            content: json("ModelCredentialInputV1"),
          },
          responses: {
            "201": {
              description: "Encrypted owner credential metadata",
              content: json("ModelCredentialRefV1"),
            },
          },
        },
      },
      "/api/v1/ai/credentials/{credential_id}/revoke": {
        post: {
          parameters: parameter("credential_id"),
          responses: {
            "200": {
              description: "Revoked credential metadata",
              content: json("ModelCredentialRefV1"),
            },
          },
        },
      },
      "/api/v1/notifications/{notification_id}": {
        patch: {
          parameters: parameter("notification_id"),
          requestBody: { required: true, content: json("NotificationReadV1") },
          responses: {
            "200": {
              description: "Updated notification read state",
              content: json("NotificationV1"),
            },
          },
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        cookieSession: { type: "apiKey", in: "cookie", name: "vos_session" },
        bearerAuth: { type: "http", scheme: "bearer" },
        workerBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "Daily rotating worker-control token bound to X-VOS-Worker-ID",
        },
        giteaWebhook: {
          type: "apiKey",
          in: "header",
          name: "X-Gitea-Signature",
        },
      },
    },
  };
}
