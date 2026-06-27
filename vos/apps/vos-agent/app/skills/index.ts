import type { McpServerConfig } from "../plugins/manifest.ts";
import { auditReviewSkill } from "./audit-review.ts";
import { bretVictorTutorSkill } from "./bret-victor-tutor.ts";
import { evidenceReportingSkill } from "./evidence-reporting.ts";
import { gdbDebugSkill } from "./gdb-debug.ts";
import { instrumentationTestingSkill } from "./instrumentation-testing.ts";
import { operationCodegenSkill } from "./operation-codegen.ts";
import { osSpecAuthoringSkill } from "./os-spec-authoring.ts";
import { qemuMonitorSkill } from "./qemu-monitor.ts";
import { referencePolicySkill } from "./reference-policy.ts";
import { teachingExplanationSkill } from "./teaching-explanation.ts";
import { toolchainAuthoringSkill } from "./toolchain-authoring.ts";
import { verificationDiagnosisSkill } from "./verification-diagnosis.ts";
import { visualizationSkill } from "./visualization.ts";
import type { BuiltInSkill, BuiltInSkillResolution } from "./types.ts";

const BUILT_IN_SKILLS: Record<string, BuiltInSkill> = {
  "os-spec-authoring": osSpecAuthoringSkill,
  "audit-review": auditReviewSkill,
  "operation-codegen": operationCodegenSkill,
  "toolchain-authoring": toolchainAuthoringSkill,
  "evidence-reporting": evidenceReportingSkill,
  "instrumentation-testing": instrumentationTestingSkill,
  "reference-policy": referencePolicySkill,
  "teaching-explanation": teachingExplanationSkill,
  "gdb-debug": gdbDebugSkill,
  "qemu-monitor": qemuMonitorSkill,
  "bret-victor-tutor": bretVictorTutorSkill,
  "visualization": visualizationSkill,
  "verification-diagnosis": verificationDiagnosisSkill,
};

export function resolveBuiltInSkills(names: readonly string[], opts: { workspaceRoot?: string } = {}): BuiltInSkillResolution {
  const promptText: string[] = [];
  const mcpServers: McpServerConfig[] = [];
  const allowedToolNames: string[] = [];
  const unknownSkills: string[] = [];
  const seenSkills = new Set<string>();
  const seenServers = new Set<string>();

  for (const name of names) {
    const normalized = name.trim();
    if (!normalized || seenSkills.has(normalized)) continue;
    seenSkills.add(normalized);
    const skill = BUILT_IN_SKILLS[normalized];
    if (!skill) {
      unknownSkills.push(normalized);
      continue;
    }
    promptText.push(skill.promptText);
    allowedToolNames.push(...(skill.allowedToolNames ?? []));
    for (const server of skill.mcpServers ?? []) {
      const serverName = server.name.toLowerCase();
      if (seenServers.has(serverName)) continue;
      seenServers.add(serverName);
      mcpServers.push({
        ...server,
        cwd: opts.workspaceRoot ?? ".",
      });
    }
  }

  return {
    promptText: promptText.join("\n\n"),
    mcpServers,
    allowedToolNames: uniqueStrings(allowedToolNames),
    unknownSkills,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
