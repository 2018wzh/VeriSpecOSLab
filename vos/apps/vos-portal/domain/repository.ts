import type {
  AgentAuditV1, AppealRecordV1, AppealSubmitV1, AppealTransitionV1, CourseManifestDryRunV1, CourseManifestV1, CourseManifestVersionV1, EnrollmentCsvImportV1, EnrollmentImportResultV1, EnrollmentInviteCreateV1, EnrollmentInviteIssuedV1, EnrollmentInviteRedeemV1, EnrollmentInviteRedemptionV1, EnrollmentInviteSummaryV1, EvidenceBundleV1, ModelCredentialInputV1, ModelCredentialRefV1, ModelProviderInputV1, ModelProviderSummaryV1, ModelQuotaPolicyInputV1, ModelQuotaPolicyV1, PipelineRequestV1, PipelineSummaryV1,
  CourseGroupMutationV1, CourseGroupV1, CourseOperationsV1, DesignReviewInputV1, DesignSubmissionInputV1, DesignSubmissionV1, NotificationV1, OidcProviderInputV1, OidcProviderSummaryV1, PortalActor, PortalContextV1, PortalDashboard, PortalRole, ProjectProvisionOptionsV1, ProjectProvisionRequestV1, ProjectProvisionStatusV1, QaThreadV1, RetentionPolicyUpdateV1, RetentionPolicyV1, ScoreAdjustmentInputV1, ScoreCalculationV1, ScoreSnapshotV1, ScoreTransitionV1,
} from "vos-core/portal-contracts";
import type { AdminSystemStatusV1 } from "vos-core/portal-contracts";

export interface LoginInput { username: string; password: string }
export interface ReviewInput { run_id: string; action: "assign" | "rerun" | "escalate" | "approve"; reason: string }

export interface PortalRepository {
  login(input: LoginInput): Promise<PortalActor>;
  logout(): Promise<void>;
  currentActor(): Promise<PortalActor | null>;
  oidcProviders():Promise<OidcProviderSummaryV1[]>;
  adminOidcProviders():Promise<OidcProviderSummaryV1[]>;
  saveOidcProvider(input:OidcProviderInputV1):Promise<OidcProviderSummaryV1>;
  modelProviders():Promise<ModelProviderSummaryV1[]>;
  saveModelProvider(input:ModelProviderInputV1):Promise<ModelProviderSummaryV1>;
  modelQuotas():Promise<ModelQuotaPolicyV1[]>;
  saveModelQuota(input:ModelQuotaPolicyInputV1):Promise<ModelQuotaPolicyV1>;
  adminSystemStatus():Promise<AdminSystemStatusV1>;
  retentionPolicy():Promise<RetentionPolicyV1>;
  updateRetentionPolicy(input:RetentionPolicyUpdateV1):Promise<RetentionPolicyV1>;
  switchDemoRole?(role: PortalRole): Promise<PortalActor>;
  contexts(): Promise<PortalContextV1[]>;
  selectContext(projectId:string): Promise<void>;
  dashboard(): Promise<PortalDashboard>;
  courseOperations(courseId:string):Promise<CourseOperationsV1>;
  setNotificationRead(notificationId:string,read:boolean):Promise<NotificationV1>;
  dryRunCourseManifest(manifest:unknown):Promise<CourseManifestDryRunV1>;
  importCourseManifest(manifest:CourseManifestV1,reason:string):Promise<CourseManifestVersionV1>;
  courseManifestVersions(courseId:string):Promise<CourseManifestVersionV1[]>;
  publishCourseManifest(courseId:string,manifestVersion:number,reason:string):Promise<CourseManifestVersionV1>;
  rollbackCourseManifest(courseId:string,targetManifestVersion:number,reason:string):Promise<CourseManifestVersionV1>;
  importEnrollmentCsv(input:EnrollmentCsvImportV1):Promise<EnrollmentImportResultV1>;
  enrollmentInvites(courseId:string):Promise<EnrollmentInviteSummaryV1[]>;
  createEnrollmentInvite(input:EnrollmentInviteCreateV1):Promise<EnrollmentInviteIssuedV1>;
  redeemEnrollmentInvite(input:EnrollmentInviteRedeemV1):Promise<EnrollmentInviteRedemptionV1>;
  courseGroups(courseId:string):Promise<CourseGroupV1[]>;
  createCourseGroup(courseId:string,input:CourseGroupMutationV1):Promise<CourseGroupV1>;
  updateCourseGroup(courseId:string,groupId:string,input:CourseGroupMutationV1):Promise<CourseGroupV1>;
  projectProvisionOptions():Promise<ProjectProvisionOptionsV1>;
  createProject(input:ProjectProvisionRequestV1):Promise<ProjectProvisionStatusV1>;
  projectProvisioning(projectId:string):Promise<ProjectProvisionStatusV1>;
  retryProjectProvisioning(projectId:string,reason:string):Promise<ProjectProvisionStatusV1>;
  designSubmissions(projectId:string):Promise<DesignSubmissionV1[]>;
  submitDesign(input:DesignSubmissionInputV1):Promise<DesignSubmissionV1>;
  reviewDesign(input:DesignReviewInputV1):Promise<DesignSubmissionV1>;
  evidence(runId: string): Promise<EvidenceBundleV1>;
  triggerPipeline(input: PipelineRequestV1): Promise<PipelineSummaryV1>;
  review(input: ReviewInput): Promise<void>;
  transitionCourse(courseId:string,target:"active"|"grading"|"appeal"|"closed"|"archived",reason:string):Promise<string>;
  calculateScore(input:ScoreCalculationV1):Promise<ScoreSnapshotV1>;
  updateScore(input: ScoreAdjustmentInputV1): Promise<ScoreSnapshotV1>;
  transitionScore(input:ScoreTransitionV1):Promise<ScoreSnapshotV1>;
  submitAppeal(input: AppealSubmitV1): Promise<AppealRecordV1>;
  transitionAppeal(input:AppealTransitionV1):Promise<AppealRecordV1>;
  appeals(projectId:string):Promise<AppealRecordV1[]>;
  ask(input: { content: string; project_id?:string }): Promise<QaThreadV1>;
  qaThread(threadId:string):Promise<QaThreadV1>;
  watchQa(threadId:string,afterCount:number,onThread:(thread:QaThreadV1)=>void,onError:(error:Error)=>void):()=>void;
  agentAudits():Promise<AgentAuditV1[]>;
  modelCredentials():Promise<ModelCredentialRefV1[]>;
  saveModelCredential(input:ModelCredentialInputV1):Promise<ModelCredentialRefV1>;
  revokeModelCredential(credentialId:string,reason:string):Promise<ModelCredentialRefV1>;
  resetDemo?(): Promise<void>;
  approveDevice?(userCode:string):Promise<void>;
}

export function assertStaff(actor: PortalActor): void {
  if (actor.role !== "admin" && actor.role !== "teacher" && actor.role !== "ta") throw new Error("staff access required");
}

export function assertTeacher(actor: PortalActor): void {
  if (actor.role !== "admin" && actor.role !== "teacher") throw new Error("teacher access required");
}
