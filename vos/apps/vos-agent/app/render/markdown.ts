import { readFileSync } from "node:fs";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { Root } from "mdast";
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

export class TermRenderer {
  private readonly options: MutableTermRendererOptions;

  constructor(...options: TermRendererOption[]) {
    this.options = createDefaultOptions();
    for (const option of options) {
      option(this.options);
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

export function newTermRenderer(...options: TermRendererOption[]): TermRenderer {
  return new TermRenderer(...options);
}

export function renderMarkdown(markdown: string, ...options: TermRendererOption[]): RenderedMarkdown {
  return newTermRenderer(...options).render(markdown);
}

export function renderMarkdownText(markdown: string, ...options: TermRendererOption[]): string {
  return newTermRenderer(...options).renderText(markdown);
}

export function withWordWrap(wordWrap: number): TermRendererOption {
  return (options) => {
    options.wordWrap = Math.max(0, Math.trunc(wordWrap));
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

export function optionsFromObject(input: TermRendererOptions = {}): TermRendererOption {
  return (options) => {
    options.baseUrl = input.baseUrl ?? options.baseUrl;
    options.wordWrap = input.wordWrap ?? options.wordWrap;
    options.preserveNewLines = input.preserveNewLines ?? options.preserveNewLines;
    options.inlineLinks = input.inlineLinks ?? options.inlineLinks;
    options.styles = input.styles ?? options.styles;
  };
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
  const childLines = renderBlocks(node.children ?? [], ctx).filter((line) => !isBlankLine(line));

  if (childLines.length === 0) {
    return [{ segments: markerSegments }];
  }

  return childLines.map((line, index) => addPrefix(line, index === 0 ? markerSegments : continuation));
}

function renderCodeBlock(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const style = ctx.options.styles.codeBlock ?? {};
  const terminalStyle = primitiveStyle(ctx, style);
  const indent = " ".repeat(style.indent ?? style.margin ?? 0);
  const rawLines = (node.value ?? "").replace(/\n$/, "").split("\n");
  const indentSegments = makeInlineSegments(indent, terminalStyle);
  return wrapSegmentLines(
    rawLines.map((line) => makeInlineSegments(line, terminalStyle)),
    ctx.options.wordWrap,
    indentSegments,
    indentSegments,
  );
}

function renderTable(node: MarkdownNode, ctx: RenderContext): RenderLine[] {
  const rows = (node.children ?? []).map((row) => (
    (row.children ?? []).map((cell) => renderInlineChildren(cell.children ?? [], ctx))
  ));
  if (rows.length === 0) {
    return [];
  }

  const widths = columnWidths(rows);
  const rendered: RenderLine[] = [];
  rows.forEach((row, rowIndex) => {
    rendered.push(joinTableRow(row, widths, ctx));
    if (rowIndex === 0) {
      rendered.push(textLine(widths.map((width) => "-".repeat(Math.max(3, width))).join("-|-"), primitiveStyle(ctx, ctx.options.styles.table)));
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
  const label = renderInlineChildren(node.children ?? [], ctx, mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.linkText)));
  const href = resolveUrl(ctx.options.baseUrl, node.url ?? "");
  if (!ctx.options.inlineLinks || href.length === 0 || href.startsWith("#")) {
    return label;
  }
  const linkStyle = mergeTerminalStyle(style, primitiveStyle(ctx, ctx.options.styles.link));
  return compactSegments([
    ...label,
    ...makeInlineSegments(" ", style),
    ...makeInlineSegments(href, linkStyle),
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
): RenderLine {
  const style = primitiveStyle(ctx, ctx.options.styles.table);
  const segments: RenderSegment[] = [];
  row.forEach((cell, index) => {
    if (index > 0) {
      segments.push({ text: " | ", style });
    }
    const padded = padSegmentLine({ segments: cell }, widths[index] ?? 0);
    segments.push(...padded.segments);
  });
  return { segments: compactSegments(segments) };
}

function columnWidths(rows: readonly (readonly (readonly RenderSegment[])[])[]): number[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, segmentsToText(cell).length, segmentWidth(cell));
    });
  }
  return widths;
}

function makeInlineSegments(text: string, style?: Style): RenderSegment[] {
  return text.length === 0 ? [] : [{ text, style }];
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
