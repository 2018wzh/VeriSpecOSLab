import { displayCellWidth, stringDisplayWidth } from "../tui/display-width.ts";
import type { Style } from "../tui/style.ts";
import type { RenderLine, RenderSegment } from "./types.ts";

type StyledChar = Readonly<{
  char: string;
  width: number;
  style?: Style;
}>;

export function renderedMarkdownToText(lines: readonly RenderLine[]): string {
  return lines.map((line) => line.segments.map((segment) => segment.text).join("")).join("\n");
}

export function segmentsToText(segments: readonly RenderSegment[]): string {
  return segments.map((segment) => segment.text).join("");
}

export function textLine(text: string, style?: Style): RenderLine {
  return {
    segments: text.length === 0 ? [] : [{ text, style }],
  };
}

export function wrapSegmentLines(
  lines: readonly (readonly RenderSegment[])[],
  width: number,
  firstPrefix: readonly RenderSegment[] = [],
  continuationPrefix: readonly RenderSegment[] = [],
): RenderLine[] {
  const rendered: RenderLine[] = [];
  for (const line of lines.length > 0 ? lines : [[]]) {
    rendered.push(...wrapSegments(line, width, firstPrefix, continuationPrefix));
  }
  return rendered;
}

export function wrapSegments(
  segments: readonly RenderSegment[],
  width: number,
  firstPrefix: readonly RenderSegment[] = [],
  continuationPrefix: readonly RenderSegment[] = [],
): RenderLine[] {
  const rows: RenderLine[] = [];
  const chars = flattenSegments(segments);
  let remaining = chars;
  let first = true;

  do {
    const prefix = first ? firstPrefix : continuationPrefix;
    const prefixWidth = segmentWidth(prefix);
    const available = width > 0 ? Math.max(1, width - prefixWidth) : Number.POSITIVE_INFINITY;
    const chunk = takeWrappedChunk(remaining, available);
    rows.push({
      segments: compactSegments([
        ...prefix,
        ...charsToSegments(chunk.chars),
      ]),
    });
    remaining = chunk.remaining;
    first = false;
  } while (remaining.length > 0);

  return rows;
}

export function hardBreakSegments(segments: readonly RenderSegment[]): RenderSegment[][] {
  const lines: RenderSegment[][] = [[]];
  for (const segment of segments) {
    const parts = segment.text.split(/\r?\n/);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index] ?? "";
      if (part.length > 0) {
        lines[lines.length - 1]?.push({ text: part, style: segment.style });
      }
      if (index + 1 < parts.length) {
        lines.push([]);
      }
    }
  }
  return lines;
}

export function addPrefix(
  line: RenderLine,
  prefix: readonly RenderSegment[],
): RenderLine {
  return { segments: compactSegments([...prefix, ...line.segments]) };
}

export function padSegmentLine(line: RenderLine, width: number): RenderLine {
  const textWidth = segmentWidth(line.segments);
  if (textWidth >= width) {
    return line;
  }
  return {
    segments: compactSegments([
      ...line.segments,
      { text: " ".repeat(width - textWidth), style: undefined },
    ]),
  };
}

export function segmentWidth(segments: readonly RenderSegment[]): number {
  return segments.reduce((width, segment) => width + stringDisplayWidth(segment.text), 0);
}

export function compactSegments(segments: readonly RenderSegment[]): RenderSegment[] {
  const compacted: RenderSegment[] = [];
  for (const segment of segments) {
    if (segment.text.length === 0) {
      continue;
    }
    const previous = compacted.at(-1);
    if (previous && stylesEqual(previous.style, segment.style)) {
      compacted[compacted.length - 1] = {
        text: `${previous.text}${segment.text}`,
        style: previous.style,
      };
      continue;
    }
    compacted.push(segment);
  }
  return compacted;
}

function takeWrappedChunk(chars: readonly StyledChar[], width: number): {
  chars: StyledChar[];
  remaining: StyledChar[];
} {
  if (!Number.isFinite(width) || charsWidth(chars) <= width) {
    return { chars: trimEndChars(chars), remaining: [] };
  }

  let fitEnd = 0;
  let fitWidth = 0;
  let breakEnd: number | undefined;
  let breakNextStart: number | undefined;

  for (let index = 0; index < chars.length; index += 1) {
    const item = chars[index];
    if (item === undefined) {
      continue;
    }
    if (fitEnd > 0 && fitWidth + item.width > width) {
      break;
    }
    if (fitEnd === 0 && item.width > width) {
      fitEnd = index + 1;
      break;
    }

    fitEnd = index + 1;
    fitWidth += item.width;
    if (isBreakableSpace(item.char)) {
      breakEnd = index;
      breakNextStart = index + 1;
    }
  }

  const end = breakEnd !== undefined && breakEnd > 0 ? breakEnd : fitEnd;
  let nextStart = breakEnd !== undefined && breakEnd > 0 ? breakNextStart ?? end : end;
  while (nextStart < chars.length && isBreakableSpace(chars[nextStart]?.char ?? "")) {
    nextStart += 1;
  }

  return {
    chars: trimEndChars(chars.slice(0, Math.max(1, end))),
    remaining: chars.slice(nextStart),
  };
}

function flattenSegments(segments: readonly RenderSegment[]): StyledChar[] {
  const chars: StyledChar[] = [];
  for (const segment of segments) {
    for (const char of segment.text) {
      chars.push({
        char,
        width: displayCellWidth(char),
        style: segment.style,
      });
    }
  }
  return chars;
}

function charsToSegments(chars: readonly StyledChar[]): RenderSegment[] {
  return compactSegments(chars.map((char) => ({
    text: char.char,
    style: char.style,
  })));
}

function trimEndChars(chars: readonly StyledChar[]): StyledChar[] {
  let end = chars.length;
  while (end > 0 && isBreakableSpace(chars[end - 1]?.char ?? "")) {
    end -= 1;
  }
  return chars.slice(0, end);
}

function charsWidth(chars: readonly StyledChar[]): number {
  return chars.reduce((width, char) => width + char.width, 0);
}

function isBreakableSpace(char: string): boolean {
  return char === " " || char === "\t";
}

function stylesEqual(left: Style | undefined, right: Style | undefined): boolean {
  return Boolean(left?.bold) === Boolean(right?.bold)
    && Boolean(left?.dim) === Boolean(right?.dim)
    && Boolean(left?.italic) === Boolean(right?.italic)
    && (left?.fg ?? "default") === (right?.fg ?? "default")
    && (left?.bg ?? "default") === (right?.bg ?? "default");
}
