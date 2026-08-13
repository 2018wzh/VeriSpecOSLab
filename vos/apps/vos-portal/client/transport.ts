import type { PortalRepository, LoginInput, ReviewInput } from "../domain/repository.ts";
import {
  AgentAuditV1Schema, AppealRecordV1Schema, AppealSubmitV1Schema, AppealTransitionV1Schema, CourseGroupMutationV1Schema, CourseGroupV1Schema, CourseManifestDryRunV1Schema, CourseManifestImportV1Schema, CourseManifestV1Schema, CourseManifestVersionV1Schema, CourseOperationsV1Schema, DesignReviewInputV1Schema, DesignSubmissionInputV1Schema, DesignSubmissionV1Schema, EnrollmentCsvImportV1Schema, EnrollmentImportResultV1Schema, EnrollmentInviteCreateV1Schema, EnrollmentInviteIssuedV1Schema, EnrollmentInviteRedeemV1Schema, EnrollmentInviteRedemptionV1Schema, EnrollmentInviteSummaryV1Schema, EvidenceBundleV1Schema, PipelineRequestV1Schema, PipelineSummaryV1Schema,
  ModelCredentialInputV1Schema, ModelCredentialRefV1Schema, ModelProviderInputV1Schema, ModelProviderSummaryV1Schema, ModelQuotaPolicyInputV1Schema, ModelQuotaPolicyV1Schema, NotificationReadV1Schema, NotificationV1Schema, OAuthProviderInputV1Schema, OAuthProviderSummaryV1Schema, OidcProviderInputV1Schema, OidcProviderSummaryV1Schema, PortalActorSchema, PortalContextV1Schema, PortalDashboardSchema, ProjectProvisionOptionsV1Schema, ProjectProvisionRequestV1Schema, ProjectProvisionStatusV1Schema, QaThreadV1Schema, ScoreSnapshotV1Schema,
  RetentionPolicyUpdateV1Schema, RetentionPolicyV1Schema, ScoreAdjustmentInputV1Schema, ScoreCalculationV1Schema, ScoreTransitionV1Schema,
  type AppealSubmitV1, type AppealTransitionV1, type CourseGroupMutationV1, type CourseManifestV1, type DesignReviewInputV1, type DesignSubmissionInputV1, type EnrollmentCsvImportV1, type EnrollmentInviteCreateV1, type EnrollmentInviteRedeemV1, type ModelCredentialInputV1, type ModelProviderInputV1, type ModelQuotaPolicyInputV1, type OAuthProviderInputV1, type OAuthProviderSummaryV1, type OidcProviderInputV1, type PipelineRequestV1, type ProjectProvisionRequestV1, type RetentionPolicyUpdateV1, type ScoreAdjustmentInputV1, type ScoreCalculationV1, type ScoreTransitionV1,
} from "vos-core/portal-contracts";
import { AdminSystemStatusV1Schema } from "vos-core/portal-contracts";

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const csrf = document.cookie.split("; ").find((item) => item.startsWith("vos_csrf="))?.slice("vos_csrf=".length);
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}), ...(init?.method&&init.method!=="GET"?{"x-idempotency-key":crypto.randomUUID()}:{}), ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? `HTTP ${response.status}`);
  return body;
}

export class HttpPortalRepository implements PortalRepository {
  private selectedProjectId=sessionStorage.getItem("vos.portal.selected-project")??undefined;
  async login(input: LoginInput) { return PortalActorSchema.parse(await request("/auth/login", { method: "POST", body: JSON.stringify(input) })); }
  async logout() { await request("/auth/logout", { method: "POST" }); }
  async currentActor() {
    try { return PortalActorSchema.parse(await request("/auth/me")); } catch { return null; }
  }
  async oidcProviders(){return OidcProviderSummaryV1Schema.array().parse(await request("/auth/oidc/providers"));}
  async adminOidcProviders(){return OidcProviderSummaryV1Schema.array().parse(await request("/admin/oidc/providers"));}
  async saveOidcProvider(input:OidcProviderInputV1){return OidcProviderSummaryV1Schema.parse(await request("/admin/oidc/providers",{method:"POST",body:JSON.stringify(OidcProviderInputV1Schema.parse(input))}));}
  async oauthProviders(){return OAuthProviderSummaryV1Schema.array().parse(await request("/auth/oauth/providers"));}
  async adminOAuthProviders(){return OAuthProviderSummaryV1Schema.array().parse(await request("/admin/oauth/providers"));}
  async saveOAuthProvider(input:OAuthProviderInputV1){return OAuthProviderSummaryV1Schema.parse(await request("/admin/oauth/providers",{method:"POST",body:JSON.stringify(OAuthProviderInputV1Schema.parse(input))}));}
  async modelProviders(){return ModelProviderSummaryV1Schema.array().parse(await request("/admin/model-providers"));}
  async saveModelProvider(input:ModelProviderInputV1){return ModelProviderSummaryV1Schema.parse(await request("/admin/model-providers",{method:"PUT",body:JSON.stringify(ModelProviderInputV1Schema.parse(input))}));}
  async modelQuotas(){return ModelQuotaPolicyV1Schema.array().parse(await request("/admin/model-quotas"));}
  async saveModelQuota(input:ModelQuotaPolicyInputV1){return ModelQuotaPolicyV1Schema.parse(await request("/admin/model-quotas",{method:"PUT",body:JSON.stringify(ModelQuotaPolicyInputV1Schema.parse(input))}));}
  async adminSystemStatus(){return AdminSystemStatusV1Schema.parse(await request("/admin/system/status"));}
  async retentionPolicy(){return RetentionPolicyV1Schema.parse(await request("/admin/retention"));}
  async updateRetentionPolicy(input:RetentionPolicyUpdateV1){return RetentionPolicyV1Schema.parse(await request("/admin/retention",{method:"PUT",body:JSON.stringify(RetentionPolicyUpdateV1Schema.parse(input))}));}
  async approveDevice(userCode:string){await request("/auth/device/approve",{method:"POST",body:JSON.stringify({user_code:userCode})});}
  async contexts(){return PortalContextV1Schema.array().parse(await request("/contexts"));}
  async selectContext(projectId:string){const contexts=await this.contexts();if(!contexts.some(item=>item.project.id===projectId))throw new Error("项目上下文不存在或不可访问");this.selectedProjectId=projectId;sessionStorage.setItem("vos.portal.selected-project",projectId);}
  async dashboard() { const query=this.selectedProjectId?`?project_id=${encodeURIComponent(this.selectedProjectId)}`:"";return PortalDashboardSchema.parse(await request(`/dashboard${query}`)); }
  async courseOperations(courseId:string){return CourseOperationsV1Schema.parse(await request(`/courses/${encodeURIComponent(courseId)}/operations`));}
  async setNotificationRead(notificationId:string,read:boolean){const input=NotificationReadV1Schema.parse({notification_id:notificationId,read});return NotificationV1Schema.parse(await request(`/notifications/${encodeURIComponent(notificationId)}`,{method:"PATCH",body:JSON.stringify(input)}));}
  async dryRunCourseManifest(manifest:unknown){return CourseManifestDryRunV1Schema.parse(await request("/courses/import/dry-run",{method:"POST",body:JSON.stringify(manifest)}));}
  async importCourseManifest(manifest:CourseManifestV1,reason:string){const input=CourseManifestImportV1Schema.parse({manifest,reason});return CourseManifestVersionV1Schema.parse(await request("/courses/import",{method:"POST",body:JSON.stringify(input)}));}
  async courseManifestVersions(courseId:string){return CourseManifestVersionV1Schema.array().parse(await request(`/courses/${encodeURIComponent(courseId)}/versions`));}
  async publishCourseManifest(courseId:string,manifestVersion:number,reason:string){return CourseManifestVersionV1Schema.parse(await request(`/courses/${encodeURIComponent(courseId)}/publish`,{method:"POST",body:JSON.stringify({manifest_version:manifestVersion,reason})}));}
  async rollbackCourseManifest(courseId:string,targetManifestVersion:number,reason:string){return CourseManifestVersionV1Schema.parse(await request(`/courses/${encodeURIComponent(courseId)}/rollback`,{method:"POST",body:JSON.stringify({target_manifest_version:targetManifestVersion,reason})}));}
  async importEnrollmentCsv(input:EnrollmentCsvImportV1){return EnrollmentImportResultV1Schema.parse(await request("/enrollment/csv",{method:"POST",body:JSON.stringify(EnrollmentCsvImportV1Schema.parse(input))}));}
  async enrollmentInvites(courseId:string){return EnrollmentInviteSummaryV1Schema.array().parse(await request(`/enrollment/invites?course_id=${encodeURIComponent(courseId)}`));}
  async createEnrollmentInvite(input:EnrollmentInviteCreateV1){return EnrollmentInviteIssuedV1Schema.parse(await request("/enrollment/invites",{method:"POST",body:JSON.stringify(EnrollmentInviteCreateV1Schema.parse(input))}));}
  async redeemEnrollmentInvite(input:EnrollmentInviteRedeemV1){return EnrollmentInviteRedemptionV1Schema.parse(await request("/enrollment/invites/redeem",{method:"POST",body:JSON.stringify(EnrollmentInviteRedeemV1Schema.parse(input))}));}
  async courseGroups(courseId:string){return CourseGroupV1Schema.array().parse(await request(`/courses/${encodeURIComponent(courseId)}/groups`));}
  async createCourseGroup(courseId:string,input:CourseGroupMutationV1){return CourseGroupV1Schema.parse(await request(`/courses/${encodeURIComponent(courseId)}/groups`,{method:"POST",body:JSON.stringify(CourseGroupMutationV1Schema.parse(input))}));}
  async updateCourseGroup(courseId:string,groupId:string,input:CourseGroupMutationV1){return CourseGroupV1Schema.parse(await request(`/courses/${encodeURIComponent(courseId)}/groups/${encodeURIComponent(groupId)}`,{method:"PUT",body:JSON.stringify(CourseGroupMutationV1Schema.parse(input))}));}
  async projectProvisionOptions(){return ProjectProvisionOptionsV1Schema.parse(await request("/projects/provisioning/options"));}
  async createProject(input:ProjectProvisionRequestV1){return ProjectProvisionStatusV1Schema.parse(await request("/projects",{method:"POST",body:JSON.stringify(ProjectProvisionRequestV1Schema.parse(input))}));}
  async projectProvisioning(projectId:string){return ProjectProvisionStatusV1Schema.parse(await request(`/projects/${encodeURIComponent(projectId)}/provisioning`));}
  async retryProjectProvisioning(projectId:string,reason:string){return ProjectProvisionStatusV1Schema.parse(await request(`/projects/${encodeURIComponent(projectId)}/provision/retry`,{method:"POST",body:JSON.stringify({reason})}));}
  async designSubmissions(projectId:string){return DesignSubmissionV1Schema.array().parse(await request(`/projects/${encodeURIComponent(projectId)}/design-submissions`));}
  async submitDesign(input:DesignSubmissionInputV1){const parsed=DesignSubmissionInputV1Schema.parse(input);return DesignSubmissionV1Schema.parse(await request(`/projects/${encodeURIComponent(parsed.project_id)}/design-submissions`,{method:"POST",body:JSON.stringify(parsed)}));}
  async reviewDesign(input:DesignReviewInputV1){const parsed=DesignReviewInputV1Schema.parse(input);return DesignSubmissionV1Schema.parse(await request(`/design-submissions/${encodeURIComponent(parsed.submission_id)}/review`,{method:"POST",body:JSON.stringify(parsed)}));}
  async evidence(runId: string) { return EvidenceBundleV1Schema.parse(await request(`/pipelines/${encodeURIComponent(runId)}/evidence`)); }
  async triggerPipeline(input: PipelineRequestV1) {
    return PipelineSummaryV1Schema.parse(await request("/pipelines", { method: "POST", body: JSON.stringify(PipelineRequestV1Schema.parse(input)) }));
  }
  async review(input: ReviewInput) { await request("/reviews", { method: "POST", body: JSON.stringify(input) }); }
  async transitionCourse(courseId:string,target:"active"|"grading"|"appeal"|"closed"|"archived",reason:string){const result=await request(`/courses/${encodeURIComponent(courseId)}/state`,{method:"POST",body:JSON.stringify({target,reason})}) as {status:string};return result.status;}
  async calculateScore(input:ScoreCalculationV1){return ScoreSnapshotV1Schema.parse(await request("/grades/calculate",{method:"POST",body:JSON.stringify(ScoreCalculationV1Schema.parse(input))}));}
  async updateScore(input: ScoreAdjustmentInputV1) { return ScoreSnapshotV1Schema.parse(await request("/grades/adjust", { method: "POST", body: JSON.stringify(ScoreAdjustmentInputV1Schema.parse(input)) })); }
  async transitionScore(input:ScoreTransitionV1){return ScoreSnapshotV1Schema.parse(await request("/grades/transition",{method:"POST",body:JSON.stringify(ScoreTransitionV1Schema.parse(input))}));}
  async submitAppeal(input: AppealSubmitV1) { return AppealRecordV1Schema.parse(await request("/appeals", { method: "POST", body: JSON.stringify(AppealSubmitV1Schema.parse(input)) })); }
  async transitionAppeal(input:AppealTransitionV1){const parsed=AppealTransitionV1Schema.parse(input);return AppealRecordV1Schema.parse(await request(`/appeals/${encodeURIComponent(parsed.appeal_id)}/transition`,{method:"POST",body:JSON.stringify(parsed)}));}
  async appeals(projectId:string){return AppealRecordV1Schema.array().parse(await request(`/appeals?project_id=${encodeURIComponent(projectId)}`));}
  async ask(input: { content: string; project_id?:string }) { const projectId=input.project_id??this.selectedProjectId??(await this.dashboard()).project.project_id;return QaThreadV1Schema.parse(await request("/ai/qa", { method: "POST", body: JSON.stringify({...input,project_id:projectId}) })); }
  async qaThread(threadId:string){return QaThreadV1Schema.parse(await request(`/ai/qa/${encodeURIComponent(threadId)}`));}
  watchQa(threadId:string,afterCount:number,onThread:(thread:import("vos-core/portal-contracts").QaThreadV1)=>void,onError:(error:Error)=>void){const source=new EventSource(`/api/v1/ai/qa/${encodeURIComponent(threadId)}/events?after_count=${afterCount}`,{withCredentials:true});source.addEventListener("thread",event=>{try{onThread(QaThreadV1Schema.parse(JSON.parse((event as MessageEvent<string>).data)));}catch(error){source.close();onError(error instanceof Error?error:new Error(String(error)));}});source.onerror=()=>onError(new Error("问答事件连接中断，浏览器正在重连"));return()=>source.close();}
  async agentAudits(){return AgentAuditV1Schema.array().parse(await request("/ai/audits"));}
  async modelCredentials(){return ModelCredentialRefV1Schema.array().parse(await request("/ai/credentials"));}
  async saveModelCredential(input:ModelCredentialInputV1){return ModelCredentialRefV1Schema.parse(await request("/ai/credentials",{method:"POST",body:JSON.stringify(ModelCredentialInputV1Schema.parse(input))}));}
  async revokeModelCredential(credentialId:string,reason:string){return ModelCredentialRefV1Schema.parse(await request(`/ai/credentials/${encodeURIComponent(credentialId)}/revoke`,{method:"POST",body:JSON.stringify({reason})}));}
}
