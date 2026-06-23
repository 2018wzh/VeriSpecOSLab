import type { McpServerConfig } from "../plugins/manifest.ts";
import { bretVictorTutorSkill } from "./bret-victor-tutor.ts";
import { gdbDebugSkill } from "./gdb-debug.ts";
import { qemuMonitorSkill } from "./qemu-monitor.ts";
import { verificationDiagnosisSkill } from "./verification-diagnosis.ts";
import type { BuiltInSkill, BuiltInSkillResolution } from "./types.ts";

const BUILT_IN_SKILLS: Record<string, BuiltInSkill> = {
  "gdb-debug": gdbDebugSkill,
  "qemu-monitor": qemuMonitorSkill,
  "bret-victor-tutor": bretVictorTutorSkill,
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
