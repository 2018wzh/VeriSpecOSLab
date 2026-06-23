import { readFileSync } from "node:fs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root } from "mdast";
import { indexedGraphemes, stringGraphemes } from "../tui/display-width.ts";
import type { Style } from "../tui/style.ts";
import {
  addPrefix,
  compactSegments,
  hardBreakSegments,
  padSegmentLine,
  renderedMarkdownToText,
  segmentWidth,
  segmentsToText,
  textLine,
  wrapSegmentLines,
  wrapSegments,
} from "./layout.ts";
import {
  darkStyle,
  defaultStyleName,
  defaultStyles,
  mergePrimitive,
  mergeTerminalStyle,
  normalizeStyleConfig,
  styleToTerminalStyle,
} from "./styles.ts";
import type {
  MutableTermRendererOptions,
  RenderLine,
  RenderSegment,
  RenderedMarkdown,
  StyleConfig,
  StylePrimitive,
  TermRendererOptionInput,
  TermRendererOption,
  TermRendererOptions,
} from "./types.ts";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  url?: string;
  alt?: string | null;
  lang?: string | null;
  align?: Array<"left" | "right" | "center" | null>;
};

type RenderContext = {
  options: MutableTermRendererOptions;
  listDepth: number;
};

const defaultWidth = 80;
const syntaxHighlightedLanguages = new Set([
  "cjs",
  "js",
  "jsx",
  "json",
  "mjs",
  "ts",
  "tsx",
  "javascript",
  "typescript",
]);
const codeKeywords = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "return",
  "satisfies",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "yield",
]);

export class TermRenderer {
  private readonly options: MutableTermRendererOptions;

  constructor(...options: TermRendererOptionInput[]) {
    this.options = createDefaultOptions();
    for (const option of options) {
      applyRendererOption(this.options, option);
    }
  }

  render(markdown: string): RenderedMarkdown {
    const tree = fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }) as Root;

    return {
      lines: trimOuterBlankLines(renderBlocks((tree as MarkdownNode).children ?? [], {
        options: this.options,
        listDepth: 0,
      })),
    };
  }

  renderText(markdown: string): string {
    return renderedMarkdownToText(this.render(markdown).lines);
  }
}

export function newTermRenderer(...options: TermRendererOptionInput[]): TermRenderer {
  return new TermRenderer(...options);
}

export function renderMarkdown(markdown: string, ...options: TermRendererOptionInput[]): RenderedMarkdown {
  return newTermRenderer(...options).render(markdown);
}

export function renderMarkdownText(markdown: string, ...options: TermRendererOptionInput[]): string {
  return newTermRenderer(...options).renderText(markdown);
}

export function withWordWrap(wordWrap: number): TermRendererOption {
  return (options) => {
    options.wordWrap = normalizeWordWrap(wordWrap);
  };
}

export function withPreservedNewLines(): TermRendererOption {
  return (options) => {
    options.preserveNewLines = true;
  };
}

export function withBaseUrl(baseUrl: string): TermRendererOption {
  return (options) => {
    options.baseUrl = baseUrl;
  };
}

export function withInlineLinks(inlineLinks: boolean): TermRendererOption {
  return (options) => {
    options.inlineLinks = inlineLinks;
  };
}

export function withStyles(styles: StyleConfig): TermRendererOption {
  return (options) => {
    options.styles = normalizeStyleConfig(styles);
  };
}

export function withStandardStyle(name: string): TermRendererOption {
  return (options) => {
    options.styles = defaultStyles[name.toLowerCase()] ?? darkStyle;
  };
}

export function withStylesFromJson(json: string): TermRendererOption {
  return (options) => {
    options.styles = normalizeStyleConfig(JSON.parse(json));
  };
}

export function withStylePath(pathOrName: string): TermRendererOption {
  const builtin = defaultStyles[pathOrName.toLowerCase()];
  if (builtin !== undefined) {
    return withStyles(builtin);
  }

  return withStylesFromJson(readFileSync(pathOrName, "utf8"));
}

function applyRendererOption(options: MutableTermRendererOptions, option: TermRendererOptionInput): void {
  if (typeof option === "function") {
    option(options);
    return;
  }

  applyRendererOptionsObject(options, option);
}

function applyRendererOptionsObject(options: MutableTermRendererOptions, input: TermRendererOptions): void {
  if (input.baseUrl !== undefined) {
    options.baseUrl = input.baseUrl;
  }
  if (input.wordWrap !== undefined) {
    options.wordWrap = normalizeWordWrap(input.wordWrap);
  }
  if (input.preserveNewLines !== undefined) {
    options.preserveNewLines = input.preserveNewLines;
  }
  if (input.inlineLinks !== undefined) {
    options.inlineLinks = input.inlineLinks;
  }
  if (input.styles !== undefined) {
    options.styles = normalizeStyleConfig(input.styles);
  }
}

function normalizeWordWrap(wordWrap: number): number {
  return Math.max(0, Math.trunc(wordWrap));
}

function createDefaultOptions(): MutableTermRendererOptions {
  return {
    baseUrl: "",
    wordWrap: defaultWidth,
    preserveNewLines: false,
    inlineLinks: true,
    styles: defaultStyles[defaultStyleName] ?? darkStyle,
  };
}

function renderBlocks(nodes: readonly MarkdownNode[], ctx: RenderContext): RenderLine[] {
  const lines: RenderLine[] = [];
  for (const node of nodes) {
    const block = renderBlock(node, ctx);
    if (block.length === 0) {
      continue;
    }
    if (lines.length > 0 && !isBlankLine(lines.at(-1)) && shouldSeparateBlocks(node)) {
      lines.push({ segments: [] });
    }
    lines.push(...block);
  }
  return lines;
}

function renderBlock(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  switch (node.type) {
    case "paragraph":
      return renderParagraph(node, ctx);
    case "heading":
      return renderHeading(node, ctx);
    case "blockquote":
      return renderBlockQuote(node, ctx);
    case "list":
      return renderList(node, ctx);
    case "code":
      return renderCodeBlock(node, ctx);
    case "thematicBreak":
      return [textLine(stylePrefix(ctx.options.styles.horizontalRule) || "--------", primitiveStyle(ctx, ctx.options.styles.horizontalRule))];
    case "table":
      return renderTable(node, ctx);
    case "html":
      return wrapSegmentLines([makeInlineSegments(node.value ?? "", primitiveStyle(ctx, ctx.options.styles.htmlBlock))], ctx.options.wordWrap);
    default:
      return renderUnknownBlock(node, ctx);
  }
}

function renderParagraph(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  let segments = renderInlineChildren(node.children ?? [], ctx);
  if (!ctx.options.preserveNewLines) {
    segments = normalizeSoftLineBreaks(segments);
  }
  return wrapSegmentLines(hardBreakSegments(trimSegments(segments)), ctx.options.wordWrap);
}

function renderHeading(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const level = clampHeadingLevel(node.depth ?? 1);
  const headingStyle = mergePrimitive(
    ctx.options.styles.heading,
    headingLevelStyle(ctx.options.styles, level),
  );
  const terminalStyle = mergeTerminalStyle(primitiveStyle(ctx, ctx.options.styles.heading), styleToTerminalStyle(headingStyle));
  const content = renderInlineChildren(node.children ?? [], ctx, terminalStyle);
  const segments = compactSegments([
    ...makeInlineSegments(headingStyle.prefix ?? "", terminalStyle),
    ...content,
    ...makeInlineSegments(headingStyle.suffix ?? "", terminalStyle),
  ]);

  return wrapSegmentLines([segments], ctx.options.wordWrap);
}

function renderBlockQuote(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const quote = ctx.options.styles.blockQuote ?? {};
  const quoteStyle = primitiveStyle(ctx, quote);
  const indent = quote.indent ?? 0;
  const token = quote.indentToken ?? "│ ";
  const prefix = makeInlineSegments(`${" ".repeat(indent)}${token}`, quoteStyle);
  return renderBlocks(node.children ?? [], ctx).map((line) => addPrefix(line, prefix));
}

function renderList(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const lines: RenderLine[] = [];
  const ordered = node.ordered === true;
  const start = node.start ?? 1;
  const children = node.children ?? [];

  children.forEach((child, index) => {
    if (child.type !== "listItem") {
      return;
    }
    lines.push(...renderListItem(child, {
      ...ctx,
      listDepth: ctx.listDepth + 1,
    }, ordered, start + index));
  });

  return lines;
}

function renderListItem(
  node: MarkdownNode,
  ctx: RenderContext,
  ordered: boolean,
  number: number,
): RenderLine[] {
  const styles = ctx.options.styles;
  const marker = ordered
    ? `${number}${styles.enumeration?.blockPrefix ?? ". "}`
    : styles.item?.blockPrefix ?? "• ";
  const task = node.checked === true
    ? styles.task?.ticked
    : node.checked === false
      ? styles.task?.unticked
      : "";
  const markerStyle = primitiveStyle(ctx, ordered ? styles.enumeration : styles.item);
  const markerSegments = makeInlineSegments(`${" ".repeat(Math.max(0, ctx.listDepth - 1) * (styles.list?.levelIndent ?? 2))}${marker}${task}`, markerStyle);
  const continuation = makeInlineSegments(" ".repeat(segmentWidth(markerSegments)), markerStyle);
  const childLines: RenderLine[] = [];

  for (const child of node.children ?? []) {
    const blockLines = renderBlock(child, ctx).filter((line) => !isBlankLine(line));
    if (blockLines.length === 0) {
      continue;
    }

    if (childLines.length === 0) {
      if (child.type === "list") {
        childLines.push({ segments: markerSegments }, ...blockLines);
      } else {
        childLines.push(...blockLines.map((line, index) => addPrefix(line, index === 0 ? markerSegments : continuation)));
      }
      continue;
    }

    childLines.push(...(
      child.type === "list"
        ? blockLines
        : blockLines.map((line) => addPrefix(line, continuation))
    ));
  }

  if (childLines.length === 0) {
    return [{ segments: markerSegments }];
  }

  return childLines;
}

function renderCodeBlock(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const style = ctx.options.styles.codeBlock ?? {};
  const terminalStyle = primitiveStyle(ctx, style);
  const indent = " ".repeat(style.indent ?? style.margin ?? 0);
  const segments = codeBlockSegments((node.value ?? "").replace(/\n$/, ""), node.lang, ctx, terminalStyle);
  const indentSegments = makeInlineSegments(indent, terminalStyle);
  return wrapSegmentLines(
    hardBreakSegments(segments),
    ctx.options.wordWrap,
    indentSegments,
    indentSegments,
    true,
  );
}

function codeBlockSegments(
  value: string,
  rawLanguage: string | null | undefined,
  ctx: RenderContext,
  baseStyle: Style | undefined,
): RenderSegment[] {
  if (!shouldHighlightCode(rawLanguage)) {
    return makeInlineSegments(value, baseStyle);
  }

  const segments: RenderSegment[] = [];
  const graphemes = indexedGraphemes(value);
  let graphemeIndex = 0;
  let index = 0;
  while (index < value.length) {
    const rest = value.slice(index);
    const comment = commentToken(rest);
    if (comment !== undefined) {
      segments.push(...makeInlineSegments(comment, codeTokenStyle(baseStyle, ctx.options.styles.codeComment)));
      index += comment.length;
      continue;
    }

    const string = stringToken(rest);
    if (string !== undefined) {
      segments.push(...makeInlineSegments(string, codeTokenStyle(baseStyle, ctx.options.styles.codeString)));
      index += string.length;
      continue;
    }

    const number = numberToken(rest);
    if (number !== undefined) {
      segments.push(...makeInlineSegments(number, codeTokenStyle(baseStyle, ctx.options.styles.codeNumber)));
      index += number.length;
      continue;
    }

    const word = identifierToken(rest);
    if (word !== undefined) {
      segments.push(...makeInlineSegments(
        word,
        codeKeywords.has(word) ? codeTokenStyle(baseStyle, ctx.options.styles.codeKeyword) : baseStyle,
      ));
      index += word.length;
      continue;
    }

    while (graphemeIndex < graphemes.length && (graphemes[graphemeIndex]?.index ?? 0) < index) {
      graphemeIndex += 1;
    }
    const grapheme = graphemes[graphemeIndex];
    if (grapheme === undefined) {
      break;
    }
    segments.push(...makeInlineSegments(grapheme.text, baseStyle));
    index = grapheme.nextIndex;
    graphemeIndex += 1;
  }

  return compactSegments(segments);
}

function renderTable(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const rows = (node.children ?? []).map((row) => (
    (row.children ?? []).map((cell) => renderInlineChildren(cell.children ?? [], ctx))
  ));
  if (rows.length === 0) {
    return [];
  }

  const naturalWidths = columnWidths(rows);
  const fitToWidth = shouldFitTable(naturalWidths, ctx.options.wordWrap);
  const widths = fitToWidth
    ? fittedTableColumnWidths(naturalWidths, tableMinimumColumnWidths(rows), ctx.options.wordWrap)
    : naturalWidths;
  const rendered: RenderLine[] = [];
  rows.forEach((row, rowIndex) => {
    rendered.push(...joinTableRow(row, widths, ctx));
    if (rowIndex === 0) {
      rendered.push(tableSeparatorLine(widths, fitToWidth, ctx));
    }
  });
  return rendered;
}

function renderUnknownBlock(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  if (node.value !== undefined) {
    return wrapSegmentLines([makeInlineSegments(node.value)], ctx.options.wordWrap);
  }
  if (node.children !== undefined) {
    return renderBlocks(node.children, ctx);
  }
  return [];
}

function renderInlineChildren(
  nodes: readonly MarkdownNode[],
  ctx: RenderContext,
  style?: Style,
): RenderSegment[] {
  return compactSegments(nodes.flatMap((node) => renderInline(node, ctx, style)));
}

function renderInline(node: MarkdownNode, ctx: RenderContext, style?: Style): RenderSegment[] {
  switch (node.type) {
    case "text":
    case "yaml":
      return makeInlineSegments(node.value ?? "", style);
    case "inlineCode": {
      const primitive = mergePrimitive(ctx.options.styles.code, {});
      const codeStyle = mergeTerminalStyle(style, styleToTerminalStyle(primitive));
      return compactSegments([
        ...makeInlineSegments(primitive.blockPrefix ?? primitive.prefix ?? "", codeStyle),
        ...makeInlineSegments(node.value ?? "", codeStyle),
        ...makeInlineSegments(primitive.blockSuffix ?? primitive.suffix ?? "", codeStyle),
      ]);
    }
    case "emphasis":
      return renderDecoratedInline(node, ctx, ctx.options.styles.emph, style);
    case "strong":
      return renderDecoratedInline(node, ctx, ctx.options.styles.strong, style);
    case "delete":
      return renderDecoratedInline(node, ctx, ctx.options.styles.strikethrough, style);
    case "link":
    case "linkReference":
      return renderLink(node, ctx, style);
    case "image":
      return renderImage(node, ctx, style);
    case "break":
      return makeInlineSegments("\n", style);
    case "html":
      return makeInlineSegments(node.value ?? "", mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.htmlSpan)));
    default:
      return node.children ? renderInlineChildren(node.children, ctx, style) : makeInlineSegments(node.value ?? "", style);
  }
}

function renderDecoratedInline(
  node: MarkdownNode,
  ctx: RenderContext,
  primitive: StylePrimitive | undefined,
  style?: Style,
): RenderSegment[] {
  const terminalStyle = mergeTerminalStyle(style, primitiveStyle(ctx, primitive));
  return compactSegments([
    ...makeInlineSegments(primitive?.blockPrefix ?? primitive?.prefix ?? "", terminalStyle),
    ...renderInlineChildren(node.children ?? [], ctx, terminalStyle),
    ...makeInlineSegments(primitive?.blockSuffix ?? primitive?.suffix ?? "", terminalStyle),
  ]);
}

function renderLink(node: MarkdownNode, ctx: RenderContext, style?: Style): RenderSegment[] {
  const href = resolveUrl(ctx.options.baseUrl, node.url ?? "");
  const link = href.length > 0 && !href.startsWith("#") ? href : undefined;
  const label = linkSegments(
    renderInlineChildren(node.children ?? [], ctx, mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.linkText))),
    link,
  );
  if (!ctx.options.inlineLinks || href.length === 0 || href.startsWith("#")) {
    return label;
  }
  const linkStyle = mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.link));
  return compactSegments([
    ...label,
    ...makeInlineSegments(" ", style),
    ...makeInlineSegments(href, linkStyle, link),
  ]);
}

function renderImage(node: MarkdownNode, ctx: RenderContext, style?: Style): RenderSegment[] {
  const imageTextStyle = mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.imageText));
  const imageStyle = mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.image));
  const href = resolveUrl(ctx.options.baseUrl, node.url ?? "");
  const alt = node.alt ?? "";
  return compactSegments([
    ...makeInlineSegments(ctx.options.styles.imageText?.prefix ?? "Image: ", imageTextStyle),
    ...makeInlineSegments(alt, imageTextStyle),
    ...makeInlineSegments(ctx.options.styles.imageText?.suffix ?? " ->", imageTextStyle),
    ...makeInlineSegments(href ? ` ${href}` : "", imageStyle),
  ]);
}

function joinTableRow(
  row: readonly (readonly RenderSegment[])[],
  widths: readonly number[],
  ctx: RenderContext,
): RenderLine[] {
  const style = primitiveStyle(ctx, ctx.options.styles.table);
  const cellLines = widths.map((width, index) => wrapSegments(row[index] ?? [], width));
  const height = Math.max(1, ...cellLines.map((lines) => lines.length));
  const lines: RenderLine[] = [];

  for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
    const segments: RenderSegment[] = [];
    widths.forEach((width, cellIndex) => {
      if (cellIndex > 0) {
        segments.push({ text: " | ", style });
      }
      const cellLine = cellLines[cellIndex]?.[lineIndex] ?? { segments: [] };
      segments.push(...padSegmentLine(cellLine, width).segments);
    });
    lines.push({ segments: compactSegments(segments) });
  }

  return lines;
}

function tableSeparatorLine(widths: readonly number[], fitToWidth: boolean, ctx: RenderContext): RenderLine {
  const style = primitiveStyle(ctx, ctx.options.styles.table);
  const minSeparatorWidth = fitToWidth ? 1 : 3;
  return textLine(widths.map((width) => "-".repeat(Math.max(minSeparatorWidth, width))).join("-|-"), style);
}

function fittedTableColumnWidths(
  widths: readonly number[],
  minimumWidths: readonly number[],
  maxWidth: number,
): number[] {
  const fitted = widths.map((width) => Math.max(1, Math.trunc(width)));
  if (fitted.length === 0) {
    return fitted;
  }

  const separatorWidth = Math.max(0, fitted.length - 1) * 3;
  if (!shouldFitTable(fitted, maxWidth)) {
    return fitted;
  }

  const minimums = fitted.map((_, index) => Math.max(1, Math.trunc(minimumWidths[index] ?? 1)));
  const availableCellWidth = Math.max(sumNumbers(minimums), Math.trunc(maxWidth) - separatorWidth);
  let currentCellWidth = sumNumbers(fitted);
  while (currentCellWidth > availableCellWidth) {
    let widestIndex = -1;
    let widestWidth = 1;
    let secondWidestWidth = 1;
    for (let index = 0; index < fitted.length; index += 1) {
      const width = fitted[index] ?? 1;
      if (width > widestWidth && width > (minimums[index] ?? 1)) {
        secondWidestWidth = widestWidth;
        widestWidth = width;
        widestIndex = index;
      } else if (width > secondWidestWidth) {
        secondWidestWidth = width;
      }
    }

    if (widestIndex < 0) {
      break;
    }

    const minimum = minimums[widestIndex] ?? 1;
    const maxDropToNextColumn = widestWidth - Math.max(minimum, secondWidestWidth);
    const drop = Math.min(currentCellWidth - availableCellWidth, Math.max(1, maxDropToNextColumn));
    fitted[widestIndex] = widestWidth - drop;
    currentCellWidth -= drop;
  }

  return fitted;
}

function shouldFitTable(widths: readonly number[], maxWidth: number): boolean {
  return Number.isFinite(maxWidth)
    && maxWidth > 0
    && Math.max(tableWidth(widths), tableWidth(widths.map((width) => Math.max(3, width)))) > Math.trunc(maxWidth);
}

function tableWidth(widths: readonly number[]): number {
  return sumNumbers(widths) + Math.max(0, widths.length - 1) * 3;
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function columnWidths(rows: readonly (readonly (readonly RenderSegment[])[])[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, segmentWidth(cell));
    });
  }
  return widths;
}

function tableMinimumColumnWidths(rows: readonly (readonly (readonly RenderSegment[])[])[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      for (const segment of cell) {
        for (const char of stringGraphemes(segment.text)) {
          widths[index] = Math.max(widths[index] ?? 1, segmentWidth([{ text: char }]));
        }
      }
    });
  }
  return widths;
}

function makeInlineSegments(text: string, style?: Style, link?: string): RenderSegment[] {
  return text.length === 0
    ? []
    : [{ text, style, ...(link === undefined ? {} : { link }) }];
}

function linkSegments(segments: readonly RenderSegment[], link: string | undefined): RenderSegment[] {
  if (link === undefined) {
    return segments.slice();
  }

  return segments.map((segment) => ({ ...segment, link }));
}

function shouldHighlightCode(rawLanguage: string | null | undefined): boolean {
  if (!rawLanguage) {
    return false;
  }

  const language = rawLanguage.toLocaleLowerCase().split(/[^a-z0-9+#-]/)[0] ?? "";
  return syntaxHighlightedLanguages.has(language);
}

function codeTokenStyle(
  baseStyle: Style | undefined,
  primitive: StylePrimitive | undefined,
): Style | undefined {
  return mergeTerminalStyle(baseStyle, styleToTerminalStyle(primitive));
}

function commentToken(value: string): string | undefined {
  if (value.startsWith("//")) {
    const newline = value.search(/\r?\n/);
    return newline >= 0 ? value.slice(0, newline) : value;
  }

  if (value.startsWith("/*")) {
    const end = value.indexOf("*/", 2);
    return end >= 0 ? value.slice(0, end + 2) : value;
  }

  return undefined;
}

function stringToken(value: string): string | undefined {
  const quote = value[0];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return undefined;
  }

  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (quote !== "`" && (char === "\n" || char === "\r")) {
      return value.slice(0, index);
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return value.slice(0, index + 1);
    }
  }

  return value;
}

function numberToken(value: string): string | undefined {
  return /^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(value)?.[0];
}

function identifierToken(value: string): string | undefined {
  return /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(value)?.[0];
}

function primitiveStyle(ctx: RenderContext, primitive: StylePrimitive | undefined): Style | undefined {
  return styleToTerminalStyle(mergePrimitive(ctx.options.styles.text, primitive));
}

function headingLevelStyle(styles: StyleConfig, level: number): StylePrimitive | undefined {
  switch (level) {
    case 1:
      return styles.h1;
    case 2:
      return styles.h2;
    case 3:
      return styles.h3;
    case 4:
      return styles.h4;
    case 5:
      return styles.h5;
    default:
      return styles.h6;
  }
}

function normalizeSoftLineBreaks(segments: readonly RenderSegment[]): RenderSegment[] {
  return compactSegments(segments.map((segment) => ({
    ...segment,
    text: segment.text.replace(/\s+/g, " "),
  })));
}

function trimSegments(segments: readonly RenderSegment[]): RenderSegment[] {
  const copy = segments.map((segment) => ({ ...segment }));
  while (copy.length > 0) {
    const first = copy[0];
    if (!first) {
      break;
    }
    const trimmed = first.text.replace(/^\s+/, "");
    if (trimmed.length > 0) {
      copy[0] = { ...first, text: trimmed };
      break;
    }
    copy.shift();
  }
  while (copy.length > 0) {
    const last = copy.at(-1);
    if (!last) {
      break;
    }
    const trimmed = last.text.replace(/\s+$/, "");
    if (trimmed.length > 0) {
      copy[copy.length - 1] = { ...last, text: trimmed };
      break;
    }
    copy.pop();
  }
  return compactSegments(copy);
}

function trimOuterBlankLines(lines: readonly RenderLine[]): RenderLine[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlankLine(lines[start])) {
    start += 1;
  }
  while (end > start && isBlankLine(lines[end - 1])) {
    end -= 1;
  }
  return lines.slice(start, end);
}

function isBlankLine(line: RenderLine | undefined): boolean {
  return line === undefined || segmentsToText(line.segments).trim().length === 0;
}

function shouldSeparateBlocks(node: MarkdownNode): boolean {
  return node.type !== "listItem";
}

function clampHeadingLevel(level: number): number {
  if (level < 1) {
    return 1;
  }
  if (level > 6) {
    return 6;
  }
  return Math.trunc(level);
}

function stylePrefix(style: StylePrimitive | undefined): string | undefined {
  return style?.prefix ?? style?.blockPrefix;
}

function resolveUrl(baseUrl: string, raw: string): string {
  if (raw.length === 0 || raw.startsWith("#")) {
    return raw;
  }
  if (baseUrl.length === 0) {
    return raw;
  }
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}
