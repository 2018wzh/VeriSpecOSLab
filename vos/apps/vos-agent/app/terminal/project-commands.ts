import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { builtinSlashCommandNames } from "./slash-commands.ts";

export interface ProjectCommand {
  name: string;
  path: string;
  template: string;
}

export interface ExpandedProjectCommand {
  name: string;
  prompt: string;
}

export interface LoadProjectCommandsOptions {
  workspaceRoot: string;
}

const COMMAND_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESERVED_COMMANDS = new Set(builtinSlashCommandNames());

export function loadProjectCommands(
  opts: LoadProjectCommandsOptions,
): ProjectCommand[] {
  const commandsDir = join(resolve(opts.workspaceRoot), ".agents", "commands");
  if (!existsSync(commandsDir)) return [];

  const commands: ProjectCommand[] = [];
  const entries = readdirSync(commandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const name = entry.name.slice(0, -".md".length);
    validateCommandName(name, entry.name);
    const path = join(commandsDir, entry.name);
    const template = readFileSync(path, "utf8").trimEnd();
    if (template.trim().length === 0) {
      throw new Error(`project command "${name}" must not be empty`);
    }
    commands.push({ name, path, template });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

export function expandProjectCommand(
  input: string,
  commands: readonly ProjectCommand[],
): ExpandedProjectCommand | undefined {
  const parsed = parseProjectCommandInput(input);
  if (!parsed) return undefined;
  const command = commands.find((candidate) => candidate.name === parsed.name);
  if (!command) return undefined;
  return {
    name: command.name,
    prompt: expandTemplate(command.template, parsed.arguments),
  };
}

export function projectCommandNames(commands: readonly ProjectCommand[]): string[] {
  return commands.map((command) => command.name).sort();
}

function parseProjectCommandInput(
  input: string,
): { name: string; arguments: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return undefined;
  return {
    name: match[1],
    arguments: match[2]?.trim() ?? "",
  };
}

function expandTemplate(template: string, args: string): string {
  if (template.includes("$ARGUMENTS")) {
    return template.replaceAll("$ARGUMENTS", args).trimEnd();
  }
  return args ? `${template}\n\n${args}` : template;
}

function validateCommandName(name: string, filename: string): void {
  if (!COMMAND_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid project command filename "${filename}": command names must match ${COMMAND_NAME_PATTERN}`,
    );
  }
  if (RESERVED_COMMANDS.has(name)) {
    throw new Error(`project command "${name}" conflicts with a built-in command`);
  }
}
