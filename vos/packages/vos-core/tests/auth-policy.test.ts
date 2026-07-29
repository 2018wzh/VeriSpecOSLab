import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadAuthStore, removeToken, saveToken } from "../src/auth/store.ts";
import { mergeEffectivePolicy } from "../src/policy/effective-policy.ts";
import { executeCliInvocation, executePortalPipeline } from "../src/main.ts";
import type { PortalClient } from "../src/auth/portal-client.ts";

const tmpRoots: string[] = [];
const previousAuthStore = process.env.VOS_AUTH_STORE;

afterEach(() => {
  if (previousAuthStore === undefined) {
    delete process.env.VOS_AUTH_STORE;
  } else {
    process.env.VOS_AUTH_STORE = previousAuthStore;
  }
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("vos-cli auth store and policy gate", () => {
  test("uses device authorization when login token is omitted", async () => {
    const projectRoot=makeProject();process.env.VOS_AUTH_STORE=join(projectRoot,"auth.json");let polls=0;
    const portalClient:PortalClient={async beginDeviceAuthorization(){return{device_code:"device-1",user_code:"ABCD1234",verification_uri:"https://portal.example/device",expires_in:10,interval:0};},async pollDeviceAuthorization(){polls++;return{status:"approved",access_token:"device-token",token_type:"Bearer",expires_in:3600};},async getMe(_url,token){expect(token).toBe("device-token");return{id:"user-1",role:"student"};},async getProjectPolicy(){throw new Error("not used");}};
    const result=await executeCliInvocation(["bun","vos","--project-root",projectRoot,"--json","login","--portal-url","https://portal.example"],{print:false,portalClient});
    expect(result.status).toBe("passed");expect(polls).toBe(1);expect((await loadAuthStore()).portals["https://portal.example"]?.token).toBe("device-token");
  });
  test("binds a local project only after Portal authorization",async()=>{const projectRoot=makeProject();process.env.VOS_AUTH_STORE=join(projectRoot,"auth.json");await saveToken({portalUrl:"https://portal.example",token:"valid-token"});const portalClient:PortalClient={async getMe(){return{id:"user-1"};},async getProjectPolicy(){throw new Error("not used");},async getProjectBinding(_url,token,projectId){expect(token).toBe("valid-token");return{version:"project-binding.v1",project_id:projectId,course_id:"course-1",experiment_id:"experiment-1",repo_url:"https://git.example/project-1.git",member_ids:["user-1"],current_stage:{id:"stage-1",key:"boot",name:"Boot",sequence:0,status:"open",required_artifacts:[],required_evidence:[],manual_review_required:false},policy_snapshot_ref:"policy-1"};}};const result=await executeCliInvocation(["bun","vos","--project-root",projectRoot,"--json","project","bind","--portal-url","https://portal.example","--project-id","project-1"],{print:false,portalClient});expect(result.status).toBe("passed");const config=readFileSync(join(projectRoot,".vos","project.yaml"),"utf8");expect(config).toContain("project_id: project-1");expect(config).toContain("portal_url: https://portal.example");});
  test("stores portal tokens outside the project directory", async () => {
    const projectRoot = makeProject();
    const storePath = join("/tmp", `vos-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    process.env.VOS_AUTH_STORE = storePath;

    await saveToken({
      portalUrl: "https://portal.example",
      token: "secret-token",
      user: { id: "user-1", role: "student", username: "student" },
    });

    const store = await loadAuthStore();
    expect(store.portals["https://portal.example"]?.token).toBe("secret-token");
    expect(readFileSync(storePath, "utf8")).not.toContain("secret-token");
    expect(JSON.parse(readFileSync(storePath,"utf8")).algorithm).toBe("aes-256-gcm");
    expect(readFileSync(join(projectRoot, ".vos", "project.yaml"), "utf8")).not.toContain("secret-token");

    await removeToken("https://portal.example");
    expect((await loadAuthStore()).portals["https://portal.example"]).toBeUndefined();
    expect(existsSync(storePath)).toBe(false);
    expect(existsSync(`${storePath}.key`)).toBe(false);
  });
  test("does not create credential artifacts when removing a missing token", async () => {
    const projectRoot = makeProject();
    const storePath = join(projectRoot, "auth.json");
    process.env.VOS_AUTH_STORE = storePath;

    expect(await removeToken("https://portal.example")).toBe(false);
    expect(existsSync(storePath)).toBe(false);
    expect(existsSync(`${storePath}.key`)).toBe(false);
  });
  test("fails fast when the encrypted credential store is corrupted",async()=>{const projectRoot=makeProject();const storePath=join(projectRoot,"auth.json");process.env.VOS_AUTH_STORE=storePath;await saveToken({portalUrl:"https://portal.example",token:"secret-token"});const envelope=JSON.parse(readFileSync(storePath,"utf8"));envelope.ciphertext=`${envelope.ciphertext.slice(0,-2)}AA`;writeFileSync(storePath,JSON.stringify(envelope));await expect(loadAuthStore()).rejects.toThrow("credential store is corrupted");});

  test("local policy can only narrow portal policy", () => {
    const effective = mergeEffectivePolicy({
      portal: {
        ref: "policy-1",
        projectId: "project-1",
        allowedCommands: ["build", "verify public"],
        allowedPaths: ["spec", "src", ".vos"],
        visibilityScope: "agent-only",
      },
      local: {
        allowed_commands: ["verify public", "run qemu"],
        allowed_paths: ["src/kernel", "tests"],
        visibility_scope: "public",
      },
    });

    expect(effective.allowedCommands).toEqual(["verify public"]);
    expect(effective.allowedPaths).toEqual(["src/kernel"]);
    expect(effective.visibilityScope).toBe("agent-only");
  });

  test("blocks portal-bound project commands when not logged in", async () => {
    const projectRoot = makeProject({ portalUrl: "http://127.0.0.1:1", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], {
      print: false,
    });

    expect(result.status).toBe("policy_blocked");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not_logged_in");
    const manifest = readFileSync(join(projectRoot, ".vos", "runs", result.run_id, "manifest.json"), "utf8");
    expect(manifest).toContain("\"auth_verdict\": \"denied\"");
  });

  test("login validates token online before writing auth store", async () => {
    const projectRoot = makeProject();
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    const portalClient: PortalClient = {
      async getMe(_portalUrl, token) {
        if (token !== "valid-token") throw new Error("unauthorized");
        return { id: "user-1", role: "student", username: "student" };
      },
      async getProjectPolicy() {
        throw new Error("not used");
      },
    };

    const failed = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "login",
      "--portal-url",
      "https://portal.example",
      "--token",
      "bad-token",
    ], { print: false, portalClient });
    expect(failed.status).toBe("policy_blocked");
    expect((await loadAuthStore()).portals["https://portal.example"]).toBeUndefined();

    const ok = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "login",
      "--portal-url",
      "https://portal.example",
      "--token",
      "valid-token",
    ], { print: false, portalClient });
    expect(ok.status).toBe("passed");
    const entry = (await loadAuthStore()).portals["https://portal.example"];
    expect(entry?.token).toBe("valid-token");
    expect(entry?.user?.id).toBe("user-1");
  });

  test("whoami performs an online policy check for portal-bound projects", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student", username: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-1",
          projectId,
          allowedCommands: ["build"],
          allowedPaths: [".vos", "spec"],
          visibilityScope: "agent-only",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "whoami",
    ], { print: false, portalClient });

    expect(result.status).toBe("passed");
    expect(result.details?.authenticated).toBe(true);
    expect(result.details?.policy_status).toBe("online");
    expect(result.details?.policy_snapshot_ref).toBe("policy-1");
  });

  test("portal policy with empty allowed commands denies project commands", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-empty",
          projectId,
          allowedCommands: [],
          allowedPaths: [".vos", "spec"],
          visibilityScope: "public",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false, portalClient });

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("command_denied");
  });

  test("agent context uses effective portal policy for paths and visibility", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join("/tmp", `vos-auth-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    await makeLedgerReady(projectRoot);
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-agent",
          projectId,
          allowedCommands: ["agent context"],
          allowedPaths: ["spec"],
          visibilityScope: "agent-only",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "agent",
      "context",
    ], { print: false, portalClient });

    expect(result.status).toBe("passed");
    expect(result.details?.allowed_paths).toEqual(["spec"]);
    expect(result.details?.visibility_scope).toBe("agent-only");
    expect(result.details?.allowed_commands).toEqual(["agent context"]);
  });

  test("fails closed when an online policy snapshot is expired", async () => {
    const projectRoot = makeProject({ portalUrl: "https://portal.example", projectId: "project-1" });
    process.env.VOS_AUTH_STORE = join(projectRoot, "auth.json");
    await saveToken({ portalUrl: "https://portal.example", token: "valid-token" });
    const portalClient: PortalClient = {
      async getMe() {
        return { id: "user-1", role: "student" };
      },
      async getProjectPolicy(_portalUrl, projectId) {
        return {
          ref: "policy-expired",
          projectId,
          allowedCommands: ["build"],
          allowedPaths: ["spec", ".vos"],
          visibilityScope: "public",
          expiresAt: "2020-01-01T00:00:00.000Z",
        };
      },
    };

    const result = await executeCliInvocation([
      "bun",
      "vos",
      "--project-root",
      projectRoot,
      "--json",
      "build",
      "--dry-run",
    ], { print: false, portalClient });

    expect(result.status).toBe("policy_blocked");
    expect(result.message).toContain("policy_expired");
  });

  test("downloads only authorized artifacts and reports verified local paths",async()=>{
    const projectRoot=makeProject({portalUrl:"https://portal.example",projectId:"project-1"});process.env.VOS_AUTH_STORE=join(projectRoot,"auth.json");await saveToken({portalUrl:"https://portal.example",token:"valid-token"});const bytes=new TextEncoder().encode("verified evidence\n");const sha256=createHash("sha256").update(bytes).digest("hex");
    const portalClient:PortalClient={async getMe(){return{id:"user-1"};},async getProjectPolicy(){throw new Error("not used");},async getEvidence(){return{version:"evidence-bundle.v1",run:{version:"pipeline-summary.v1",id:"run-1",project_id:"project-1",commit_sha:"a".repeat(40),stage_key:"boot",status:"passed",passed:1,total:1,public_message:"passed",created_at:"2026-01-01T00:00:00.000Z"},evidence:[],artifacts:[{id:"artifact-1",uri:"s3://private/artifact-1",sha256,size_bytes:bytes.byteLength,content_type:"text/plain",visibility:"public",label:"report.txt"}]};},async downloadArtifact(_url,token,artifact,destination){expect(token).toBe("valid-token");expect(artifact.sha256).toBe(sha256);writeFileSync(destination,bytes);return{size_bytes:bytes.byteLength,sha256};}};
    const result=await executePortalPipeline({kind:"portal_pipeline",action:"download",runId:"run-1",scope:"public",outDir:"downloads"},{projectRoot,global:{} as never,evidence:{} as never,portalClient});expect(result.status).toBe("passed");expect(result.details?.verified).toBe(true);expect(readFileSync(join(projectRoot,"downloads","artifact-1-report.txt"),"utf8")).toBe("verified evidence\n");
  });

  test("returns immutable run reproduction metadata",async()=>{
    const projectRoot=makeProject({portalUrl:"https://portal.example",projectId:"project-1"});process.env.VOS_AUTH_STORE=join(projectRoot,"auth.json");await saveToken({portalUrl:"https://portal.example",token:"valid-token"});
    const portalClient:PortalClient={async getMe(){return{id:"user-1"};},async getProjectPolicy(){throw new Error("not used");},async getReproduction(){return{version:"run-reproduction.v1",run_id:"run-1",project_id:"project-1",commit_sha:"a".repeat(40),stage_key:"boot",scope:"public",policy_snapshot_ref:"policy-1",command:{program:"vos",arguments:["verify","public"]},artifacts:[],created_at:"2026-01-01T00:00:00.000Z"};}};
    const result=await executePortalPipeline({kind:"portal_pipeline",action:"reproduce",runId:"run-1",scope:"public"},{projectRoot,global:{} as never,evidence:{} as never,portalClient});expect(result.status).toBe("passed");expect((result.details?.reproduction as {policy_snapshot_ref:string}).policy_snapshot_ref).toBe("policy-1");
  });

  test("rejects pipeline resources from a different accessible Portal project",async()=>{
    const projectRoot=makeProject({portalUrl:"https://portal.example",projectId:"project-1"});process.env.VOS_AUTH_STORE=join(projectRoot,"auth.json");await saveToken({portalUrl:"https://portal.example",token:"valid-token"});
    const portalClient:PortalClient={async getMe(){return{id:"user-1"};},async getProjectPolicy(){throw new Error("not used");},async getPipeline(){return{version:"pipeline-summary.v1",id:"run-other",project_id:"project-2",commit_sha:"a".repeat(40),stage_key:"boot",status:"passed",passed:1,total:1,public_message:"passed",created_at:"2026-01-01T00:00:00.000Z"};}};
    await expect(executePortalPipeline({kind:"portal_pipeline",action:"status",runId:"run-other",scope:"public"},{projectRoot,global:{} as never,evidence:{} as never,portalClient})).rejects.toThrow("different project");
  });
});

function makeProject(options: { portalUrl?: string; projectId?: string } = {}): string {
  const root = join("/tmp", `vos-auth-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  tmpRoots.push(root);
  mkdirSync(join(root, ".vos"), { recursive: true });
  mkdirSync(join(root, "spec", "toolchain"), { recursive: true });
  writeFileSync(join(root, ".vos", "project.yaml"), [
    `project_id: ${options.projectId ?? "local-project"}`,
    options.portalUrl ? `portal_url: ${options.portalUrl}` : undefined,
    "spec_root: spec",
    "current_stage: boot",
    "",
  ].filter(Boolean).join("\n"));
  writeFileSync(join(root, ".vos", "policy.yaml"), [
    "allowed_commands:",
    "  - build",
    "  - verify public",
    "  - agent context",
    "allowed_paths:",
    "  - spec",
    "  - .vos",
    "visibility_scope: public",
    "",
  ].join("\n"));
  writeFileSync(join(root, "spec", "toolchain", "build.yaml"), "allowed_output_path:\n  - .vos\n");
  return root;
}

async function makeLedgerReady(projectRoot: string): Promise<void> {
  git(projectRoot, ["init"]);
  git(projectRoot, ["config", "user.email", "test@example.com"]);
  git(projectRoot, ["config", "user.name", "Test User"]);
  git(projectRoot, ["add", "."]);
  git(projectRoot, ["commit", "-m", "initial"]);
  await executeCliInvocation(["bun", "vos", "--project-root", projectRoot, "--json", "init"], { print: false });
}

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
}
