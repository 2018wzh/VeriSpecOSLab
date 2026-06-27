import { fileURLToPath } from "node:url";
import { BRET_VICTOR_TUTOR_PROMPT } from "./bret-victor-tutor.ts";
import type { BuiltInSkill } from "./types.ts";

export const VISUALIZATION_TOOL_NAMES = [
  "mcp__http-server__publish_html",
] as const;

export const visualizationSkill: BuiltInSkill = {
  name: "visualization",
  promptText: [
    "## Built-in skill: visualization",
    "",
    "When the user asks for a visualization, use this visualization skill and call mcp__http-server__publish_html to publish the interactive HTML.",
    "Use mcp__http-server__publish_html to publish self-contained HTML visualizations and cite the returned local URL in the answer.",
    "Do not rely on this URL for durable audit storage; it lasts only for the current MCP server process.",
    "",
    BRET_VICTOR_TUTOR_PROMPT,
  ].join("\n"),
  mcpServers: [{
    name: "http-server",
    command: process.execPath,
    args: [fileURLToPath(new URL("../main.ts", import.meta.url)), "internal", "http-server-mcp"],
  }],
  allowedToolNames: [...VISUALIZATION_TOOL_NAMES],
};
