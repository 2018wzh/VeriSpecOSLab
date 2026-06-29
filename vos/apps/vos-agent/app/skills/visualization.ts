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
    "When the declared output schema has a visualization_html field, put one complete self-contained HTML document in that field.",
    "When the user asks for a visualization and the schema has no visualization_html field, call mcp__http-server__publish_html to publish the interactive HTML.",
    "Do not write, attach, or paste HTML files in prose; use visualization_html or the published local URL.",
    "Use mcp__http-server__publish_html to publish self-contained HTML visualizations only when the schema has no visualization_html field.",
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
