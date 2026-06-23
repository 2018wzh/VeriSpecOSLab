import type { McpServerConfig } from "../plugins/manifest.ts";

export interface BuiltInSkill {
  name: string;
  promptText: string;
  mcpServers?: Omit<McpServerConfig, "cwd">[];
  allowedToolNames?: string[];
}

export interface BuiltInSkillResolution {
  promptText: string;
  mcpServers: McpServerConfig[];
  allowedToolNames: string[];
  unknownSkills: string[];
}
