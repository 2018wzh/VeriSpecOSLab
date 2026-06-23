import {
  displayCellWidth,
  indexedGraphemes,
  padEndDisplay,
  padStartDisplay,
  sliceByDisplayWidth,
  sliceEndByDisplayWidth,
  stringGraphemes,
  stringDisplayWidth,
} from "./display-width.ts";
import {
  renderMarkdown,
  starsDarkStyle,
  starsLightStyle,
  withPreservedNewLines,
  withStyles,
  withWordWrap,
} from "../render/index.ts";
import type { RenderLine } from "../render/index.ts";
import { ScreenBuffer } from "./screen.ts";
import {
  logoColumnsForHeight,
  logoRowsForColumns,
  renderShaderLogo,
  type LogoCell,
} from "./welcome-logo.ts";
import type { Style } from "./style.ts";
import type { StarsTuiTheme } from "./theme.ts";

export type StarsViewSize = Readonly<{
  width: number;
  height: number;
}>;

export type StarsTuiStatus = Readonly<{
  threadId?: string;
  mode?: string;
  model?: string;
  cwd?: string;
  activeTools?: readonly string[];
}>;

export type StarsTranscriptItem =
  | Readonly<{
    type: "user" | "assistant" | "command" | "error" | "system" | "status";
    text: string;
  }>
  | Readonly<{
    type: "tool-call";
    name: string;
    text?: string;
  }>
  | Readonly<{
    type: "tool-result";
    name: string;
    text: string;
  }>;

export type StarsPromptState = Readonly<{
  text: string;
  cursor?: number;
}>;

export type StarsCommandPaletteEntry = Readonly<{
  group: string;
  command: string;
  hint?: string;
  action?: StarsCommandPaletteAction;
}>;

export type StarsCommandPaletteAction = Readonly<{
  text: string;
  submit: boolean;
}>;

export type StarsCommandPalette = Readonly<{
  title: string;
  query?: string;
  selectedIndex?: number;
  entries: readonly StarsCommandPaletteEntry[];
}>;

export type StarsTuiState = Readonly<{
  status?: StarsTuiStatus;
  transcript?: readonly StarsTranscriptItem[];
  theme?: StarsTuiTheme;
  /** Rendered transcript rows to keep below the visible viewport. */
  transcriptScrollOffset?: number;
  prompt: StarsPromptState;
  busy?: boolean;
  running?: boolean;
  debugLabels?: boolean;
  welcomeFrame?: number;
  inputHint?: string;
  commandPalette?: StarsCommandPalette;
}>;

export type StarsViewCursor = Readonly<{
  x: number;
  y: number;
}>;

export type StarsViewFrame = Readonly<{
  screen: ScreenBuffer;
  cursor?: StarsViewCursor;
}>;

export type StarsTranscriptViewportMetrics = Readonly<{
  renderedRows: number;
  visibleRows: number;
  maxScrollOffset: number;
}>;

type RenderedTextRow = Readonly<{
  text: string;
  cells?: readonly RenderedTextCell[];
  style?: Style;
  prefixStyleLength?: number;
  prefixStyle?: Style;
  spacer?: boolean;
}>;

type RenderedTextCell = Readonly<{
  glyph: string;
  style?: Style;
  link?: string;
}>;

type PromptContentLayout = Readonly<{
  lines: readonly string[];
  cursorLine: number;
  cursorColumn: number;
}>;

type RenderedPromptBox = Readonly<{
  rows: readonly RenderedTextRow[];
  cursorX: number;
  cursorY: number;
}>;

const transcriptStyles = {
  user: { italic: true, fg: "green" },
  assistant: {},
  command: { fg: "cyan" },
  error: { bold: true, fg: "red" },
  system: { fg: "blue" },
  status: { fg: "cyan" },
  toolCall: {},
  toolResult: {},
} satisfies Record<string, Style>;

const userRail = "│";
const userRailStyle: Style = { bold: true, fg: "green" };
const toolRunningSymbol = "›";
const toolSuccessSymbol = "✓";
const toolFailureSymbol = "✗";
const toolRunningSymbolStyle: Style = { fg: "yellow" };
const toolSuccessSymbolStyle: Style = { fg: "green" };
const toolFailureSymbolStyle: Style = { fg: "red" };
const bashPromptSymbolStyle: Style = { bold: true, fg: "green" };
const commandOutputStyle: Style = {};
const promptBorderStyle: Style = {};
const promptStyle: Style = {};
const inputHintStyle: Style = { bold: true };
const welcomeTitleStyle: Style = { bold: true, fg: "brightGreen" };
const welcomeHintStyle: Style = {};
const paletteBorderStyle: Style = {};
const paletteTitleStyle: Style = { bold: true, fg: "green" };
const paletteTextStyle: Style = {};
const paletteSelectedStyle: Style = { bold: true, fg: "black", bg: "yellow" };
const modeStyles: Record<string, Style> = {
  smart: { fg: "brightGreen" },
  deep: { fg: "green" },
  rush: { fg: "yellow" },
};

const promptMinContentRows = 3;
const promptMaxContentRows = 6;
const promptBorderLabelLeftPadding = 1;
const promptBorderLabelRightPadding = 3;
const toolPreviewMaxLength = 160;
const welcomeLogoTimeStep = 0.08;
const markdownRowCacheMaxEntries = 250;
const markdownRowCache = new Map<string, readonly RenderedTextRow[]>();

export function renderStarsView(state: StarsTuiState, size: StarsViewSize): ScreenBuffer {
  return renderStarsViewFrame(state, size).screen;
}

export function measureStarsTranscriptViewport(
  state: StarsTuiState,
  size: StarsViewSize,
): StarsTranscriptViewportMetrics {
  const width = Math.max(1, Math.trunc(size.width));
  const height = Math.max(1, Math.trunc(size.height));
  const renderedRows = renderTranscriptRows(
    state.transcript ?? [],
    width,
    state.debugLabels === true,
    state.theme ?? "dark",
  ).length;
  const visibleRows = transcriptVisibleHeight(state, { width, height });

  return {
    renderedRows,
    visibleRows,
    maxScrollOffset: Math.max(0, renderedRows - visibleRows),
  };
}

/**
 * Pure Stars TUI renderer. It does not write to the terminal; it only maps
 * semantic agent state into an Amp-inspired transcript viewport plus a
 * bottom prompt box and optional cursor for TerminalDriver to present.
 */
export function renderStarsViewFrame(state: StarsTuiState, size: StarsViewSize): StarsViewFrame {
  const screen = new ScreenBuffer(size.width, size.height);

  if (size.height < 3 || size.width < 4) {
    return renderCompactFrame(screen, state);
  }

  const promptBox = renderPromptBox(state, screen.width, screen.height);
  const promptTop = Math.max(0, screen.height - promptBox.rows.length);
  renderTranscriptArea(screen, state, promptTop);
  renderCommandPaletteOverlay(screen, state.commandPalette, promptTop);

  for (let index = 0; index < promptBox.rows.length; index += 1) {
    const row = promptBox.rows[index];
    if (row) {
      writeLine(screen, promptTop + index, row.text, row.style);
    }
  }
  stylePromptModeLabel(screen, promptTop, promptBox.rows[0]?.text, state.status?.mode);

  return {
    screen,
    cursor: {
      x: promptBox.cursorX,
      y: promptTop + promptBox.cursorY,
    },
  };
}

function renderCompactFrame(screen: ScreenBuffer, state: StarsTuiState): StarsViewFrame {
  if (screen.height > 1) {
    const transcriptRows = renderTranscriptRows(
      state.transcript ?? [],
      screen.width,
      state.debugLabels === true,
      state.theme ?? "dark",
    );
    if (transcriptRows.length === 0) {
      writeCenteredLine(screen, 0, "Welcome to VOS Agent", welcomeTitleStyle);
    } else if (screen.height > 2) {
      const visibleRows = transcriptViewportRows(
        transcriptRows,
        screen.height - 1,
        state.transcriptScrollOffset,
      );
      for (let index = 0; index < visibleRows.length; index += 1) {
        const row = visibleRows[index];
        if (row) {
          writeRow(screen, index, row);
        }
      }
    }
  }

  const prompt = renderCompactPromptLine(state.prompt, screen.width);
  writeLine(screen, screen.height - 1, prompt.text, promptStyle);

  return {
    screen,
    cursor: { x: prompt.cursorX, y: screen.height - 1 },
  };
}

function renderTranscriptArea(screen: ScreenBuffer, state: StarsTuiState, height: number): void {
  if (height <= 0) {
    return;
  }

  const transcriptRows = renderTranscriptRows(
    state.transcript ?? [],
    screen.width,
    state.debugLabels === true,
    state.theme ?? "dark",
  );
  if (transcriptRows.length === 0) {
    renderWelcome(screen, height, state.welcomeFrame);
    return;
  }

  const visibleRows = transcriptViewportRows(
    transcriptRows,
    height,
    state.transcriptScrollOffset,
  );
  for (let index = 0; index < visibleRows.length; index += 1) {
    const row = visibleRows[index];
    if (row) {
      writeRow(screen, index, row);
    }
  }
}

function transcriptVisibleHeight(state: StarsTuiState, size: StarsViewSize): number {
  if (size.height < 3 || size.width < 4) {
    return size.height > 2 ? size.height - 1 : 0;
  }

  const promptBox = renderPromptBox(state, size.width, size.height);
  return Math.max(0, size.height - promptBox.rows.length);
}

function renderWelcome(screen: ScreenBuffer, height: number, frame: number | undefined): void {
  const logoSize = welcomeLogoSize(screen.width, Math.max(0, height - 3));
  const logo = logoSize.height > 0
    ? renderShaderLogo({ width: logoSize.width, height: logoSize.height, time: welcomeLogoTime(frame) })
    : [];
  const rows: RenderedTextRow[] = [
    ...logo.map(logoRowToRenderedRow),
    { text: "", style: welcomeHintStyle },
    { text: "Welcome to VOS Agent", style: welcomeTitleStyle },
    { text: "Ctrl-C Ctrl-C to exit, /help for commands", style: welcomeHintStyle },
  ];
  const visibleRows = rows.slice(-height);
  const startY = Math.max(0, Math.floor((height - visibleRows.length) / 2));

  for (let index = 0; index < visibleRows.length; index += 1) {
    const row = visibleRows[index];
    if (row) {
      writeCenteredRow(screen, startY + index, row);
    }
  }
}

function welcomeLogoSize(maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (maxWidth <= 0 || maxHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const widthForHeight = logoColumnsForHeight(maxHeight);
  if (widthForHeight <= maxWidth) {
    return { width: Math.max(1, widthForHeight), height: maxHeight };
  }

  return {
    width: maxWidth,
    height: Math.max(1, Math.min(maxHeight, logoRowsForColumns(maxWidth))),
  };
}

function welcomeLogoTime(frame: number | undefined): number {
  if (frame === undefined || !Number.isFinite(frame)) {
    return 0;
  }

  return Math.trunc(frame) * welcomeLogoTimeStep;
}

function logoRowToRenderedRow(row: readonly LogoCell[]): RenderedTextRow {
  return {
    text: row.map((cell) => cell.glyph).join(""),
    cells: row.map((cell) => ({
      glyph: cell.glyph,
      style: cell.glyph === " " ? undefined : {
        fg: cell.color,
        bold: cell.bold,
        dim: cell.dim,
      },
    })),
  };
}

function renderPromptBox(state: StarsTuiState, width: number, height: number): RenderedPromptBox {
  const contentWidth = Math.max(1, width - 4);
  const content = renderPromptContent(state.prompt, contentWidth);
  const maxContentRows = Math.max(1, Math.min(promptMaxContentRows, height - 2));
  const requestedContentRows = Math.max(
    promptMinContentRows,
    content.lines.length,
    state.inputHint ? 2 : 0,
  );
  const contentRowCount = Math.min(maxContentRows, requestedContentRows);
  const firstContentLine = promptContentViewportStart(
    content.lines.length,
    content.cursorLine,
    contentRowCount,
  );
  const contentRows = Array.from({ length: contentRowCount }, (_, index) => ({
    text: content.lines[firstContentLine + index] ?? "",
    style: promptStyle,
  }));

  if (state.inputHint && state.prompt.text.length === 0 && contentRows.length > 1) {
    contentRows[contentRows.length - 1] = { text: state.inputHint, style: inputHintStyle };
  }

  return {
    rows: [
      { text: borderRow("top", width, promptTopLabel(state)), style: promptBorderStyle },
      ...contentRows.map((row) => ({
        text: promptContentRow(row.text, width),
        style: row.style,
      })),
      { text: borderRow("bottom", width, promptBottomLabel(state)), style: promptBorderStyle },
    ],
    cursorX: Math.min(width - 2, Math.max(1, 2 + content.cursorColumn)),
    cursorY: 1 + Math.max(0, Math.min(contentRowCount - 1, content.cursorLine - firstContentLine)),
  };
}

function renderPromptContent(prompt: StarsPromptState, width: number): PromptContentLayout {
  const text = prompt.text;
  const cursor = clampInteger(prompt.cursor ?? text.length, 0, text.length);
  const lines = chunkFixedCells(text, width);
  const cursorPrefixLines = chunkFixedCells(text.slice(0, cursor), width);
  let cursorLine = Math.max(0, cursorPrefixLines.length - 1);
  let cursorColumn = cellLength(cursorPrefixLines[cursorLine] ?? "");

  if (cursorColumn >= width) {
    cursorLine += 1;
    cursorColumn = 0;
  }

  if (cursorLine >= lines.length) {
    lines.push("");
  }

  return { lines, cursorLine, cursorColumn };
}

function renderCompactPromptLine(prompt: StarsPromptState, width: number): { text: string; cursorX: number } {
  const prefix = "> ";
  const prefixWidth = cellLength(prefix);
  const text = prompt.text;
  const cursor = clampInteger(prompt.cursor ?? text.length, 0, text.length);
  const contentWidth = Math.max(0, width - prefixWidth);
  const cursorColumn = cellLength(text.slice(0, cursor));
  const start = promptViewportStart(cellLength(text), cursorColumn, contentWidth);
  const visibleText = sliceCells(text, start, start + contentWidth);
  const cursorX = Math.min(
    Math.max(0, width - 1),
    prefixWidth + cursorColumn - start,
  );

  return {
    text: `${prefix}${visibleText}`,
    cursorX,
  };
}

function renderTranscriptRows(
  items: readonly StarsTranscriptItem[],
  width: number,
  debugLabels: boolean,
  theme: StarsTuiTheme,
): RenderedTextRow[] {
  const rows: RenderedTextRow[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }

    const previous = items[index - 1];
    const next = items[index + 1];
    if (item.type === "user" && previous !== undefined && previous.type !== "user") {
      rows.push(transcriptSpacerRow());
    }
    rows.push(...renderTranscriptItemRows(item, width, debugLabels, theme));
    if (item.type === "user" && next !== undefined && next.type !== "user") {
      rows.push(transcriptSpacerRow());
    }
  }

  return rows;
}

function transcriptSpacerRow(): RenderedTextRow {
  return { text: "", spacer: true };
}

function transcriptViewportRows(
  rows: readonly RenderedTextRow[],
  height: number,
  scrollOffset: number | undefined,
): readonly RenderedTextRow[] {
  if (height <= 0 || rows.length === 0) {
    return [];
  }

  const visibleHeight = Math.max(1, Math.trunc(height));
  const maxOffset = Math.max(0, rows.length - visibleHeight);
  const offset = clampInteger(scrollOffset ?? 0, 0, maxOffset);
  const end = rows.length - offset;
  const start = Math.max(0, end - visibleHeight);

  if (rows[start]?.spacer === true && start > 0) {
    return rows.slice(start - 1, Math.max(start, end - 1));
  }

  return rows.slice(start, end);
}

function renderTranscriptItemRows(
  item: StarsTranscriptItem,
  width: number,
  debugLabels: boolean,
  theme: StarsTuiTheme,
): RenderedTextRow[] {
  switch (item.type) {
    case "user":
      return userRows(item.text, width);
    case "assistant":
      return debugLabels
        ? prefixedRows("assistant", item.text, transcriptStyles.assistant, width)
        : markdownRows(item.text, width, theme);
    case "command":
      return prefixedRows("command", item.text, transcriptStyles.command, width);
    case "error":
      return prefixedRows("error", item.text, transcriptStyles.error, width);
    case "system":
      return prefixedRows("system", item.text, transcriptStyles.system, width);
    case "status":
      return prefixedRows("status", item.text, transcriptStyles.status, width);
    case "tool-call":
      return toolCallRows(item.name, item.text ?? "", width);
    case "tool-result":
      return toolResultRows(item.name, item.text, width);
  }
}

function plainRows(text: string, style: Style, width: number): RenderedTextRow[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) {
    return wrapPrefixedLine("", "", "", style, width);
  }

  return lines.flatMap((line) => wrapPrefixedLine("", line, "", style, width));
}

function markdownRows(text: string, width: number, theme: StarsTuiTheme): RenderedTextRow[] {
  const cacheKey = markdownRowsCacheKey(text, width, theme);
  const cached = markdownRowCache.get(cacheKey);
  if (cached !== undefined) {
    markdownRowCache.delete(cacheKey);
    markdownRowCache.set(cacheKey, cached);
    return cached.slice();
  }

  const lines = renderMarkdown(
    text,
    withStyles(theme === "light" ? starsLightStyle : starsDarkStyle),
    withWordWrap(width),
    withPreservedNewLines(),
  ).lines;
  if (lines.length === 0) {
    return wrapPrefixedLine("", "", "", transcriptStyles.assistant, width);
  }

  const rows = lines.map(markdownLineToRow);
  markdownRowCache.set(cacheKey, rows);
  if (markdownRowCache.size > markdownRowCacheMaxEntries) {
    const oldestKey = markdownRowCache.keys().next().value;
    if (oldestKey !== undefined) {
      markdownRowCache.delete(oldestKey);
    }
  }
  return rows.slice();
}

function markdownRowsCacheKey(text: string, width: number, theme: StarsTuiTheme): string {
  return `${theme}\0${width}\0${text}`;
}

function markdownLineToRow(line: RenderLine): RenderedTextRow {
  const cells: RenderedTextCell[] = [];
  let text = "";
  for (const segment of line.segments) {
    text += segment.text;
    for (const glyph of stringGraphemes(segment.text)) {
      cells.push({ glyph, style: segment.style, link: segment.link });
    }
  }

  return { text, cells };
}

function userRows(text: string, width: number): RenderedTextRow[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) {
    return [{ text: userRail, style: transcriptStyles.user, prefixStyleLength: 1, prefixStyle: userRailStyle }];
  }

  return lines.flatMap((line) => wrapPrefixedLine(
    `${userRail} `,
    line,
    `${userRail} `,
    transcriptStyles.user,
    width,
  ).map((row) => ({
    ...row,
    prefixStyleLength: 1,
    prefixStyle: userRailStyle,
  })));
}

function prefixedRows(prefix: string, text: string, style: Style, width: number): RenderedTextRow[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0].length === 0)) {
    return wrapPrefixedLine(`${prefix}:`, "", "  ", style, width);
  }

  return lines.flatMap((line, index) => wrapPrefixedLine(
    index === 0 ? `${prefix}: ` : "  ",
    line,
    "  ",
    style,
    width,
  ));
}

function toolCallRows(name: string, text: string, width: number): RenderedTextRow[] {
  if (isBashTool(name)) {
    return bashCommandRows(bashCommandFromArguments(text), width);
  }

  return symbolRows(
    toolRunningSymbol,
    `Exploring ${toolTargetLabel(name, text)}`,
    transcriptStyles.toolCall,
    toolRunningSymbolStyle,
    width,
  );
}

function toolResultRows(name: string, text: string, width: number): RenderedTextRow[] {
  if (isBashTool(name)) {
    const exitStatus = bashExitStatus(text);
    const outputRows = bashOutputRows(text, width);
    if (exitStatus !== undefined) {
      return [
        ...symbolRows(
          toolFailureSymbol,
          `Ran command (exit code: ${exitStatus})`,
          transcriptStyles.toolResult,
          toolFailureSymbolStyle,
          width,
        ),
        ...outputRows,
      ];
    }

    return [
      ...symbolRows(
        toolSuccessSymbol,
        "Ran command",
        transcriptStyles.toolResult,
        toolSuccessSymbolStyle,
        width,
      ),
      ...outputRows,
    ];
  }

  return symbolRows(
    toolSuccessSymbol,
    `Explored ${exploredToolLabel(name)}`,
    transcriptStyles.toolResult,
    toolSuccessSymbolStyle,
    width,
  );
}

function symbolRows(
  symbol: string,
  text: string,
  style: Style,
  symbolStyle: Style,
  width: number,
): RenderedTextRow[] {
  return wrapPrefixedLine(`${symbol} `, text, "  ", style, width).map((row, index) => (
    index === 0
      ? { ...row, prefixStyleLength: 1, prefixStyle: symbolStyle }
      : row
  ));
}

function bashCommandRows(command: string, width: number): RenderedTextRow[] {
  const lines = command.split(/\r?\n/);
  const visibleLines = lines.length === 0 ? [""] : lines;
  return visibleLines.flatMap((line, index) => wrapPrefixedLine(
    index === 0 ? "$ " : "  ",
    line,
    "  ",
    transcriptStyles.toolCall,
    width,
  ).map((row) => (
    row.text.startsWith("$")
      ? { ...row, prefixStyleLength: 1, prefixStyle: bashPromptSymbolStyle }
      : row
  )));
}

function isBashTool(name: string): boolean {
  return name.toLocaleLowerCase() === "bash";
}

function bashCommandFromArguments(text: string): string {
  const command = stringField(parseJsonObject(text), "command");
  return summarizeToolText(command ?? text);
}

function bashExitStatus(text: string): string | undefined {
  return /Command exited with status (\d+)/.exec(text)?.[1];
}

function bashOutputRows(text: string, width: number): RenderedTextRow[] {
  const output = bashOutputPreview(text);
  if (output.length === 0) {
    return [];
  }

  return output.split(/\r?\n/).flatMap((line) =>
    wrapPrefixedLine("  ", line, "  ", commandOutputStyle, width)
  );
}

function bashOutputPreview(text: string): string {
  const output = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !isBashDiagnosticLine(line))
    .join("\n");
  if (output.length <= toolPreviewMaxLength) {
    return output;
  }
  return `${output.slice(0, toolPreviewMaxLength - 1)}…`;
}

function isBashDiagnosticLine(line: string): boolean {
  return /^\[(?:Command (?:exited|timed out|terminated)|Error executing command:)/.test(line);
}

function toolTargetLabel(name: string, text: string): string {
  const args = parseJsonObject(text);
  const lowerName = name.toLocaleLowerCase();
  const target = lowerName === "read" || lowerName === "write" || lowerName === "edit"
    ? stringField(args, "file_path")
    : lowerName === "glob"
    ? stringField(args, "pattern")
    : lowerName === "grep"
    ? stringField(args, "pattern")
    : lowerName === "webfetch"
    ? stringField(args, "url")
    : lowerName === "websearch"
    ? stringField(args, "query")
    : lowerName === "task"
    ? stringField(args, "description")
    : undefined;

  if (target) {
    return summarizeToolText(`${name} ${target}`);
  }

  const fallback = text.trim().length > 0 && !text.trimStart().startsWith("{")
    ? `${name} ${text}`
    : name;
  return summarizeToolText(fallback);
}

function exploredToolLabel(name: string): string {
  const lowerName = name.toLocaleLowerCase();
  if (lowerName === "read" || lowerName === "write" || lowerName === "edit") {
    return "1 file";
  }
  if (lowerName === "grep" || lowerName === "websearch") {
    return "1 search";
  }
  if (lowerName === "glob") {
    return "1 list";
  }
  if (lowerName === "task") {
    return "1 task";
  }
  if (lowerName === "todoread" || lowerName === "todowrite") {
    return "todos";
  }
  return name;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function summarizeToolText(text: string): string {
  const oneLine = text.trim().replace(/\s+/g, " ");
  if (oneLine.length <= toolPreviewMaxLength) {
    return oneLine;
  }
  return `${oneLine.slice(0, toolPreviewMaxLength - 1)}…`;
}

function wrapPrefixedLine(
  firstPrefix: string,
  text: string,
  continuationPrefix: string,
  style: Style,
  width: number,
): RenderedTextRow[] {
  const rows: RenderedTextRow[] = [];
  let remaining = text;
  let first = true;

  do {
    const prefix = first ? firstPrefix : continuationPrefix;
    const available = Math.max(1, width - cellLength(prefix));
    const chunk = takeWrappedChunk(remaining, available);
    rows.push({ text: `${prefix}${chunk.text}`, style });
    remaining = chunk.remaining;
    first = false;
  } while (remaining.length > 0);

  return rows;
}

function takeWrappedChunk(text: string, width: number): { text: string; remaining: string } {
  if (cellLength(text) <= width) {
    return { text, remaining: "" };
  }

  let fitEnd = 0;
  let fitWidth = 0;
  let breakEnd: number | undefined;
  let breakNextStart: number | undefined;

  for (const item of indexedChars(text)) {
    if (fitEnd > 0 && fitWidth + item.width > width) {
      break;
    }
    if (fitEnd === 0 && item.width > width) {
      fitEnd = item.nextIndex;
      fitWidth = item.width;
      break;
    }

    fitEnd = item.nextIndex;
    fitWidth += item.width;

    if (isBreakableSpace(item.char)) {
      breakEnd = item.index;
      breakNextStart = item.nextIndex;
    }
  }

  let end = breakEnd !== undefined && breakEnd > 0 ? breakEnd : fitEnd;
  if (end <= 0) {
    end = text.length;
  }

  let nextStart = breakEnd !== undefined && breakEnd > 0
    ? breakNextStart ?? end
    : end;
  while (nextStart < text.length) {
    const char = text[nextStart] ?? "";
    if (char === undefined || !isBreakableSpace(char)) {
      break;
    }
    nextStart += 1;
  }

  const fallback = text.slice(0, fitEnd > 0 ? fitEnd : end);
  const chunk = text.slice(0, end).trimEnd();

  return {
    text: chunk.length > 0 ? chunk : fallback,
    remaining: text.slice(nextStart),
  };
}

function renderCommandPaletteOverlay(
  screen: ScreenBuffer,
  palette: StarsCommandPalette | undefined,
  availableHeight: number,
): void {
  if (palette === undefined || availableHeight < 7 || screen.width < 24) {
    return;
  }

  const width = Math.min(
    screen.width - 4,
    Math.max(48, Math.min(96, Math.floor(screen.width * 0.58))),
  );
  const bodyHeight = Math.max(3, Math.min(availableHeight - 2, palette.entries.length + 3, 16));
  const height = bodyHeight + 2;
  const x = Math.max(0, Math.floor((screen.width - width) / 2));
  const y = Math.max(0, Math.floor((availableHeight - height) / 2));
  const selectedIndex = clampInteger(
    palette.selectedIndex ?? 0,
    0,
    Math.max(0, palette.entries.length - 1),
  );

  writePositionedLine(screen, x, y, paletteBorder("top", width, palette.title), paletteBorderStyle);
  writePositionedLine(screen, x + 2, y, ` ${palette.title} `, paletteTitleStyle);

  for (let offset = 1; offset < height - 1; offset += 1) {
    const rowY = y + offset;
    writePositionedLine(screen, x, rowY, `│${" ".repeat(width - 2)}│`, paletteBorderStyle);
  }

  writePositionedLine(screen, x, y + height - 1, paletteBorder("bottom", width), paletteBorderStyle);

  const query = palette.query ?? "";
  writePaletteContent(screen, x, y + 1, width, `> ${query}`, paletteTextStyle);

  const listStartY = y + 3;
  const visibleEntryRows = Math.max(0, height - 4);
  const firstEntry = paletteViewportStart(palette.entries.length, selectedIndex, visibleEntryRows);

  for (let index = 0; index < visibleEntryRows; index += 1) {
    const entryIndex = firstEntry + index;
    const entry = palette.entries[entryIndex];
    if (entry === undefined) {
      break;
    }

    const rowY = listStartY + index;
    const selected = entryIndex === selectedIndex;
    const rowStyle = selected ? paletteSelectedStyle : paletteTextStyle;
    if (selected) {
      writePositionedLine(screen, x + 1, rowY, " ".repeat(width - 2), paletteSelectedStyle);
    }

    writePaletteContent(screen, x, rowY, width, formatPaletteEntry(entry), rowStyle);
  }
}

function paletteViewportStart(total: number, selectedIndex: number, visible: number): number {
  if (total <= visible || selectedIndex < visible) {
    return 0;
  }

  return Math.min(total - visible, selectedIndex - visible + 1);
}

function formatPaletteEntry(entry: StarsCommandPaletteEntry): string {
  const group = padStartDisplay(truncateRight(entry.group, 10), 10);
  const command = padEndDisplay(truncateRight(entry.command, 24), 24);
  const hint = entry.hint ? ` ${entry.hint}` : "";
  return `${group}  ${command}${hint}`;
}

function writePaletteContent(
  screen: ScreenBuffer,
  x: number,
  y: number,
  width: number,
  text: string,
  style: Style,
): void {
  writePositionedLine(screen, x + 2, y, sliceCells(text, 0, Math.max(0, width - 4)), style);
}

function paletteBorder(kind: "top" | "bottom", width: number, title?: string): string {
  const left = kind === "top" ? "╭" : "╰";
  const right = kind === "top" ? "╮" : "╯";
  if (width <= 2) {
    return `${left}${right}`.slice(0, width);
  }

  if (!title || kind === "bottom") {
    return `${left}${"─".repeat(width - 2)}${right}`;
  }

  const label = ` ${truncateRight(title, Math.max(0, width - 6))} `;
  return `${left}─${label}${"─".repeat(Math.max(0, width - cellLength(label) - 3))}${right}`;
}

function promptTopLabel(state: StarsTuiState): string | undefined {
  const status = state.status ?? {};
  const parts: string[] = [];
  const activeTools = (status.activeTools ?? []).filter((name) => name.length > 0);
  const scrollOffset = state.transcriptScrollOffset ?? 0;

  if (scrollOffset > 0) {
    parts.push(`history -${scrollOffset}`);
  }
  if (state.running || state.busy) {
    parts.push(activeTools.length > 0 ? activeTools.join(",") : "running");
  }
  if (status.mode) {
    parts.push(status.mode);
  } else if (status.model) {
    parts.push(status.model);
  }

  return parts.length > 0 ? parts.join(" - ") : undefined;
}

function promptBottomLabel(state: StarsTuiState): string | undefined {
  return state.status?.cwd;
}

function borderRow(kind: "top" | "bottom", width: number, rawLabel: string | undefined): string {
  const left = kind === "top" ? "╭" : "╰";
  const right = kind === "top" ? "╮" : "╯";
  if (width === 1) {
    return left;
  }
  if (width === 2) {
    return `${left}${right}`;
  }

  const innerWidth = width - 2;
  const fitted = rawLabel ? fitBorderLabel(rawLabel, innerWidth) : undefined;
  if (fitted === undefined) {
    return `${left}${"─".repeat(innerWidth)}${right}`;
  }

  const leftLineWidth = Math.max(0, innerWidth - cellLength(fitted.label) - fitted.rightLineWidth);
  return `${left}${"─".repeat(leftLineWidth)}${fitted.label}${"─".repeat(fitted.rightLineWidth)}${right}`;
}

function fitBorderLabel(
  text: string,
  width: number,
): { label: string; rightLineWidth: number } | undefined {
  const rightLineWidth = Math.min(promptBorderLabelRightPadding, Math.max(0, width - 3));
  const textWidth = width - promptBorderLabelLeftPadding - 1 - rightLineWidth;
  if (textWidth < 1) {
    return undefined;
  }

  const leftPadding = " ".repeat(promptBorderLabelLeftPadding);
  return {
    label: `${leftPadding}${truncateLeft(text, textWidth)} `,
    rightLineWidth,
  };
}

function promptContentRow(text: string, width: number): string {
  const innerWidth = Math.max(0, width - 4);
  return `│ ${padEndDisplay(sliceCells(text, 0, innerWidth), innerWidth)} │`;
}

function chunkFixedCells(text: string, width: number): string[] {
  if (text.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const item of indexedChars(text)) {
    if (current.length > 0 && currentWidth + item.width > width) {
      lines.push(current);
      current = "";
      currentWidth = 0;
    }

    current += item.char;
    currentWidth += item.width;
  }

  lines.push(current);
  return lines;
}

function promptContentViewportStart(
  totalLines: number,
  cursorLine: number,
  visibleLines: number,
): number {
  if (totalLines <= visibleLines || cursorLine < visibleLines) {
    return 0;
  }

  return Math.min(totalLines - visibleLines, cursorLine - visibleLines + 1);
}

function promptViewportStart(totalWidth: number, cursorColumn: number, width: number): number {
  if (width <= 0 || totalWidth <= width) {
    return 0;
  }

  if (cursorColumn <= width) {
    return 0;
  }

  return Math.min(totalWidth - width, cursorColumn - width);
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return max;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function writeLine(screen: ScreenBuffer, y: number, text: string, style?: Style): void {
  screen.writeText(0, y, clipLine(text, screen.width), style);
}

function writeRow(screen: ScreenBuffer, y: number, row: RenderedTextRow): void {
  if (row.cells) {
    writeCells(screen, 0, y, row.cells);
    return;
  }

  writeLine(screen, y, row.text, row.style);
  if (row.prefixStyleLength === undefined || row.prefixStyleLength <= 0) {
    return;
  }

  screen.writeText(0, y, sliceCells(row.text, 0, row.prefixStyleLength), row.prefixStyle);
}

function writePositionedLine(
  screen: ScreenBuffer,
  x: number,
  y: number,
  text: string,
  style?: Style,
): void {
  if (x >= screen.width || y >= screen.height) {
    return;
  }

  screen.writeText(x, y, clipLine(text, screen.width - x), style);
}

function writeCenteredLine(screen: ScreenBuffer, y: number, text: string, style?: Style): void {
  const clipped = clipLine(text, screen.width);
  const x = Math.max(0, Math.floor((screen.width - cellLength(clipped)) / 2));
  screen.writeText(x, y, clipped, style);
}

function writeCenteredRow(screen: ScreenBuffer, y: number, row: RenderedTextRow): void {
  if (!row.cells) {
    writeCenteredLine(screen, y, row.text, row.style);
    return;
  }

  const x = Math.max(0, Math.floor((screen.width - cellLength(row.text)) / 2));
  writeCells(screen, x, y, row.cells);
}

function writeCells(
  screen: ScreenBuffer,
  x: number,
  y: number,
  cells: readonly RenderedTextCell[],
): void {
  if (y < 0 || y >= screen.height) {
    return;
  }

  let offset = 0;
  for (const cell of cells) {
    const targetX = x + offset;
    offset += displayCellWidth(cell.glyph);
    if (targetX < 0) {
      continue;
    }
    if (targetX >= screen.width) {
      break;
    }
    screen.writeCell(targetX, y, cell.glyph, cell.style, cell.link);
  }
}

function stylePromptModeLabel(
  screen: ScreenBuffer,
  y: number,
  rowText: string | undefined,
  mode: string | undefined,
): void {
  if (rowText === undefined || mode === undefined || mode.length === 0) {
    return;
  }

  const start = rowText.lastIndexOf(mode);
  if (start < 0) {
    return;
  }

  screen.writeText(start, y, mode, modeLabelStyle(mode));
}

function modeLabelStyle(mode: string): Style {
  return modeStyles[mode.toLocaleLowerCase()] ?? { fg: "cyan" };
}

function clipLine(text: string, width: number): string {
  return sliceCells(text, 0, width);
}

function sliceCells(text: string, start: number, end: number): string {
  return sliceByDisplayWidth(text, start, end);
}

function cellLength(text: string): number {
  return stringDisplayWidth(text);
}

function truncateLeft(text: string, width: number): string {
  if (cellLength(text) <= width) {
    return text;
  }
  if (width <= 3) {
    return sliceEndByDisplayWidth(text, width);
  }

  return `...${sliceEndByDisplayWidth(text, width - 3)}`;
}

function truncateRight(text: string, width: number): string {
  if (cellLength(text) <= width) {
    return text;
  }
  if (width <= 3) {
    return sliceCells(text, 0, width);
  }

  return `${sliceCells(text, 0, width - 3)}...`;
}

function isBreakableSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function indexedChars(text: string): Array<{
  char: string;
  index: number;
  nextIndex: number;
  width: number;
}> {
  return indexedGraphemes(text).map((grapheme) => ({
    char: grapheme.text,
    index: grapheme.index,
    nextIndex: grapheme.nextIndex,
    width: grapheme.width,
  }));
}
