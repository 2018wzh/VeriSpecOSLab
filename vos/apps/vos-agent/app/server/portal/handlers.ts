import type { PortalStore } from "./data.ts";
import {
  PortalApiError,
  asObject,
  id,
  optionalString,
  bearerToken,
  readJsonObject,
  requiredString,
  stringArray,
  userFromRequest,
  portalJson,
} from "./utils.ts";

export async function handlePortalApiRequest(
  request: Request,
  store: PortalStore,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return undefined;

  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const actor = () => userFromRequest(request, store);
    const body = () => readJsonObject(request);

    if (parts[2] === "auth" && parts[3] === "login" && request.method === "POST") {
      const input = await body();
      return portalJson(store.authenticate(requiredString(input, "username"), requiredString(input, "password")));
    }
    if (parts[2] === "auth" && parts[3] === "logout" && request.method === "POST") {
      const token = bearerToken(request);
      if (token) store.revokeToken(token);
      return portalJson({ ok: true });
    }
    if (parts[2] === "auth" && parts[3] === "me" && request.method === "GET") {
      return portalJson(actor());
    }
    if (parts[2] === "users" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listUsers(actor()));
    }
    if (parts[2] === "courses" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listCourses());
    }
    if (parts[2] === "courses" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createCourse(actor(), await body()), 201);
    }
    if (parts[2] === "courses" && parts.length === 4 && request.method === "DELETE") {
      store.deleteCourse(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "experiments" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listExperiments(url.searchParams.get("course_id") ?? undefined));
    }
    if (parts[2] === "experiments" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createExperiment(actor(), await body()), 201);
    }
    if (parts[2] === "experiments" && parts.length === 4 && request.method === "DELETE") {
      store.deleteExperiment(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "experiments" && parts[4] === "stage-gates" && request.method === "GET") {
      return portalJson(store.listStageGates(parts[3]));
    }
    if (parts[2] === "experiments" && parts[4] === "stage-gates" && request.method === "POST") {
      return portalJson(store.createStageGate(actor(), parts[3], await body()), 201);
    }
    if (parts[2] === "stage-gates" && parts.length === 4 && request.method === "DELETE") {
      store.deleteStageGate(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "projects" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listProjectOverviews(actor()));
    }
    if (parts[2] === "projects" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createProject(actor(), await body()), 201);
    }
    if (parts[2] === "projects" && parts.length === 4 && request.method === "GET") {
      return portalJson(store.projectOverview(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts.length === 4 && request.method === "DELETE") {
      store.deleteProject(actor(), parts[3]);
      return portalJson({ ok: true });
    }
    if (parts[2] === "projects" && parts[4] === "progress" && request.method === "GET") {
      return portalJson(store.stageProgress(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "evidence" && request.method === "GET") {
      return portalJson(store.evidenceFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "scores" && request.method === "GET") {
      return portalJson(store.scoresFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "agent-audit" && request.method === "GET") {
      return portalJson(store.auditsFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "kb-sources" && request.method === "GET") {
      return portalJson(store.kbSourcesFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "objects" && parts[5] === "manifest" && request.method === "GET") {
      return portalJson(store.objectManifestFor(actor(), parts[3]));
    }
    if (parts[2] === "projects" && parts[4] === "qa-threads" && request.method === "POST") {
      return portalJson(store.appendQaThread(actor(), parts[3], await body()), 201);
    }
    if (parts[2] === "internal" && parts[3] === "objects" && request.method === "POST") {
      const input = await body();
      return portalJson(store.recordObjectManifest(actor(), requiredString(input, "project_id"), input), 201);
    }
    if (parts[2] === "internal" && parts[3] === "agent-audit" && request.method === "POST") {
      const input = await body();
      const audit = asObject(input.audit) ?? input;
      return portalJson(store.recordAgentAudit({
        projectId: requiredString(input, "project_id"),
        sessionId: optionalString(audit, "session_id") ?? id("session"),
        userId: optionalString(audit, "user_id") ?? actor().id,
        model: optionalString(audit, "model") ?? "vos-agent",
        taskKind: optionalString(audit, "task_kind") ?? "knowledgebase_qa",
        prompt: optionalString(audit, "prompt_summary") ?? "",
        response: optionalString(audit, "response_summary"),
        riskFlags: stringArray(audit.risk_flags),
      }), 201);
    }
    if (parts[2] === "teacher" && parts[3] === "experiments" && parts[5] === "students" && request.method === "GET") {
      return portalJson({ rows: store.teacherRows(actor(), parts[4]) });
    }
    if (parts[2] === "teacher" && parts[3] === "projects" && parts[5] === "grade" && request.method === "POST") {
      return portalJson(store.updateScore(actor(), parts[4], await body()));
    }
    if (parts[2] === "rubrics" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listRubrics(actor(), url.searchParams.get("experiment_id") ?? undefined));
    }
    if (parts[2] === "rubrics" && parts.length === 3 && request.method === "POST") {
      return portalJson(store.createRubric(actor(), await body()), 201);
    }
    if (parts[2] === "design-submissions" && parts.length === 3 && request.method === "GET") {
      return portalJson(store.listDesignSubmissions(actor(), url.searchParams.get("project_id") ?? undefined));
    }
    if (parts[2] === "design-submissions" && parts.length === 4 && request.method === "PATCH") {
      return portalJson(store.updateDesignSubmission(actor(), parts[3], await body()));
    }

    throw new PortalApiError(404, "not found", "not_found");
  } catch (e) {
    const error = e instanceof PortalApiError
      ? e
      : new PortalApiError(500, e instanceof Error ? e.message : String(e), "portal_error");
    return portalJson({
      error: {
        message: error.message,
        type: error.type,
      },
    }, error.status);
  }
}
