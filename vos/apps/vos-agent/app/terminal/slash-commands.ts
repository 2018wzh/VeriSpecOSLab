export type SlashCommand =
  | { kind: "prompt"; prompt: string }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "new" }
  | { kind: "thread-show" }
  | { kind: "thread-switch"; threadId: string }
  | { kind: "mode-show" }
  | { kind: "mode-set"; mode: string }
  | { kind: "todos" }
  | { kind: "error"; message: string };

export type SlashCommandPaletteAction = Readonly<{
  text: string;
  submit: boolean;
}>;

export type SlashCommandPaletteEntry = Readonly<{
  group: string;
  command: string;
  hint?: string;
  action?: SlashCommandPaletteAction;
}>;

type ParsedBuiltinSlashCommand = Exclude<
  SlashCommand,
  | { kind: "prompt"; prompt: string }
  | { kind: "error"; message: string }
>;

type SlashCommandUsage = Readonly<{
  text: string;
  hint: string;
}>;

type BuiltinSlashCommandDefinition = Readonly<{
  names: readonly [string, ...string[]];
  usages: readonly SlashCommandUsage[];
  paletteEntries: readonly SlashCommandPaletteEntry[];
  parse: (arg: string) => ParsedBuiltinSlashCommand;
}>;

const BUILTIN_SLASH_COMMANDS: readonly BuiltinSlashCommandDefinition[] = [
  {
    names: ["help"],
    usages: [{ text: "/help", hint: "Show this help" }],
    paletteEntries: [{
      group: "vos",
      command: "help",
      hint: "Show this help",
      action: submitSlashAction("/help"),
    }],
    parse: () => ({ kind: "help" }),
  },
  {
    names: ["new"],
    usages: [{ text: "/new", hint: "Start a new local thread" }],
    paletteEntries: [{
      group: "vos",
      command: "new thread",
      hint: "Start a new local thread",
      action: submitSlashAction("/new"),
    }],
    parse: () => ({ kind: "new" }),
  },
  {
    names: ["thread"],
    usages: [
      { text: "/thread", hint: "Show current thread id" },
      { text: "/thread <id>", hint: "Switch to a saved thread" },
    ],
    paletteEntries: [
      {
        group: "thread",
        command: "show current",
        hint: "Show current thread id",
        action: submitSlashAction("/thread"),
      },
      {
        group: "thread",
        command: "switch <id>",
        hint: "Switch to a saved thread",
        action: insertSlashAction("/thread "),
      },
    ],
    parse: (arg) => arg
      ? { kind: "thread-switch", threadId: arg }
      : { kind: "thread-show" },
  },
  {
    names: ["mode"],
    usages: [
      { text: "/mode", hint: "Show current mode" },
      { text: "/mode <name>", hint: "Switch mode (smart, deep, rush)" },
    ],
    paletteEntries: [
      {
        group: "mode",
        command: "show current",
        hint: "Show current mode",
        action: submitSlashAction("/mode"),
      },
      {
        group: "mode",
        command: "switch <name>",
        hint: "Switch mode (smart, deep, rush)",
        action: insertSlashAction("/mode "),
      },
    ],
    parse: (arg) => arg
      ? { kind: "mode-set", mode: arg }
      : { kind: "mode-show" },
  },
  {
    names: ["todos"],
    usages: [{ text: "/todos", hint: "Show current thread todos" }],
    paletteEntries: [{
      group: "vos",
      command: "show todos",
      hint: "Show current thread todos",
      action: submitSlashAction("/todos"),
    }],
    parse: () => ({ kind: "todos" }),
  },
  {
    names: ["quit", "exit"],
    usages: [{ text: "/quit, /exit", hint: "Leave VOS Agent" }],
    paletteEntries: [{
      group: "vos",
      command: "quit",
      hint: "Leave VOS Agent",
      action: submitSlashAction("/quit"),
    }],
    parse: () => ({ kind: "quit" }),
  },
];

export function parseSlashCommand(input: string): SlashCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", prompt: input };
  }

  const [command, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(" ");

  const name = command.slice(1);
  const builtin = BUILTIN_SLASH_COMMANDS.find((candidate) =>
    candidate.names.includes(name)
  );
  if (builtin) return builtin.parse(arg);

  return { kind: "error", message: `unknown command: ${command}` };
}

export function slashHelp(projectCommands: readonly string[] = []): string {
  const lines = [
    "VOS Agent commands:",
    ...BUILTIN_SLASH_COMMANDS.flatMap((command) =>
      command.usages.map(formatSlashCommandUsage)
    ),
  ];
  if (projectCommands.length > 0) {
    lines.push(
      "",
      "Project commands:",
      ...projectCommands.map((name) => `  /${name}`),
    );
  }
  return lines.join("\n");
}

export function builtinSlashCommandNames(): string[] {
  return BUILTIN_SLASH_COMMANDS.flatMap((command) => [...command.names]);
}

export function builtinSlashCommandPaletteEntries(): SlashCommandPaletteEntry[] {
  return BUILTIN_SLASH_COMMANDS.flatMap((command) =>
    command.paletteEntries.map((entry) => ({ ...entry }))
  );
}

function submitSlashAction(text: string): SlashCommandPaletteAction {
  return { text, submit: true };
}

function insertSlashAction(text: string): SlashCommandPaletteAction {
  return { text, submit: false };
}

function formatSlashCommandUsage(usage: SlashCommandUsage): string {
  return `  ${usage.text.padEnd(15)} ${usage.hint}`;
}
