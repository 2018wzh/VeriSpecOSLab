export type PrintableCellWidth = 0 | 1 | 2;
export type DisplayCellWidth = 1 | 2;

export type IndexedGrapheme = Readonly<{
  text: string;
  index: number;
  nextIndex: number;
  width: DisplayCellWidth;
}>;

const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : undefined;

/**
 * Returns the terminal cell width for the first printable Unicode grapheme.
 *
 * This is a pragmatic wcwidth subset: it covers CJK/full-width ranges and
 * common emoji as wide cells, treats combining/control-only graphemes as
 * non-printable, and keeps everything else single-cell. The TUI renderer uses
 * this to avoid splitting Chinese characters and emoji clusters across terminal
 * cells.
 */
export function printableCellWidth(input: string): PrintableCellWidth {
  const grapheme = firstGrapheme(input);
  return grapheme === undefined ? 0 : printableWidthForGrapheme(grapheme);
}

/** Width after the screen buffer sanitizes unsupported input to a blank cell. */
export function displayCellWidth(input: string): DisplayCellWidth {
  return printableCellWidth(input) === 2 ? 2 : 1;
}

export function firstGrapheme(text: string): string | undefined {
  return indexedGraphemes(text)[0]?.text;
}

export function stringGraphemes(text: string): string[] {
  return indexedGraphemes(text).map((grapheme) => grapheme.text);
}

export function indexedGraphemes(text: string): IndexedGrapheme[] {
  if (text.length === 0) {
    return [];
  }

  if (graphemeSegmenter !== undefined) {
    const segments = Array.from(graphemeSegmenter.segment(text));
    return segments.map((segment, index) => ({
      text: segment.segment,
      index: segment.index,
      nextIndex: segments[index + 1]?.index ?? text.length,
      width: displayWidthForGrapheme(segment.segment),
    }));
  }

  const graphemes: IndexedGrapheme[] = [];
  let index = 0;
  for (const char of Array.from(text)) {
    const nextIndex = index + char.length;
    graphemes.push({
      text: char,
      index,
      nextIndex,
      width: displayWidthForGrapheme(char),
    });
    index = nextIndex;
  }
  return graphemes;
}

function displayWidthForGrapheme(grapheme: string): DisplayCellWidth {
  return printableWidthForGrapheme(grapheme) === 2 ? 2 : 1;
}

function printableWidthForGrapheme(grapheme: string): PrintableCellWidth {
  let hasPrintableCodePoint = false;
  for (const char of Array.from(grapheme)) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined || isControlCodePoint(codePoint)) {
      continue;
    }
    if (isWideCodePoint(codePoint)) {
      return 2;
    }
    if (!isCombiningCodePoint(codePoint)) {
      hasPrintableCodePoint = true;
    }
  }

  return hasPrintableCodePoint ? 1 : 0;
}

export function stringDisplayWidth(text: string): number {
  let width = 0;
  for (const grapheme of indexedGraphemes(text)) {
    width += grapheme.width;
  }

  return width;
}

export function sliceByDisplayWidth(text: string, start: number, end: number): string {
  const safeStart = Math.max(0, Math.trunc(start));
  const safeEnd = Math.max(safeStart, Math.trunc(end));
  let result = "";
  let column = 0;

  for (const grapheme of indexedGraphemes(text)) {
    const width = grapheme.width;
    const nextColumn = column + width;

    if (column >= safeEnd) {
      break;
    }
    if (column >= safeStart && nextColumn <= safeEnd) {
      result += grapheme.text;
    }

    column = nextColumn;
  }

  return result;
}

export function sliceEndByDisplayWidth(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (safeWidth === 0) {
    return "";
  }

  const chars = indexedGraphemes(text);
  let remaining = safeWidth;
  let result = "";

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    if (char === undefined) {
      continue;
    }

    const charWidth = char.width;
    if (charWidth > remaining) {
      continue;
    }

    result = `${char.text}${result}`;
    remaining -= charWidth;
    if (remaining === 0) {
      break;
    }
  }

  return result;
}

export function padEndDisplay(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, Math.trunc(width) - stringDisplayWidth(text)))}`;
}

export function padStartDisplay(text: string, width: number): string {
  return `${" ".repeat(Math.max(0, Math.trunc(width) - stringDisplayWidth(text)))}${text}`;
}

function isControlCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x00 && codePoint <= 0x1f)
    || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function isCombiningCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x0300 && codePoint <= 0x036f)
    || (codePoint >= 0x0483 && codePoint <= 0x0489)
    || (codePoint >= 0x0591 && codePoint <= 0x05bd)
    || codePoint === 0x05bf
    || (codePoint >= 0x05c1 && codePoint <= 0x05c2)
    || (codePoint >= 0x05c4 && codePoint <= 0x05c5)
    || codePoint === 0x05c7
    || (codePoint >= 0x0610 && codePoint <= 0x061a)
    || (codePoint >= 0x064b && codePoint <= 0x065f)
    || codePoint === 0x0670
    || (codePoint >= 0x06d6 && codePoint <= 0x06dc)
    || (codePoint >= 0x06df && codePoint <= 0x06e4)
    || (codePoint >= 0x06e7 && codePoint <= 0x06e8)
    || (codePoint >= 0x06ea && codePoint <= 0x06ed)
    || codePoint === 0x0711
    || (codePoint >= 0x0730 && codePoint <= 0x074a)
    || (codePoint >= 0x07a6 && codePoint <= 0x07b0)
    || (codePoint >= 0x07eb && codePoint <= 0x07f3)
    || (codePoint >= 0x0816 && codePoint <= 0x0819)
    || (codePoint >= 0x081b && codePoint <= 0x0823)
    || (codePoint >= 0x0825 && codePoint <= 0x0827)
    || (codePoint >= 0x0829 && codePoint <= 0x082d)
    || (codePoint >= 0x0859 && codePoint <= 0x085b)
    || (codePoint >= 0x0898 && codePoint <= 0x089f)
    || (codePoint >= 0x08ca && codePoint <= 0x08e1)
    || (codePoint >= 0x08e3 && codePoint <= 0x08ff)
    || (codePoint >= 0x1ab0 && codePoint <= 0x1aff)
    || (codePoint >= 0x1dc0 && codePoint <= 0x1dff)
    || codePoint === 0x200d
    || (codePoint >= 0x20d0 && codePoint <= 0x20ff)
    || (codePoint >= 0xfe00 && codePoint <= 0xfe0f)
    || (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
    || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
      || codePoint === 0x2329
      || codePoint === 0x232a
      || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
      || (codePoint >= 0xf900 && codePoint <= 0xfaff)
      || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
      || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
      || (codePoint >= 0xff00 && codePoint <= 0xff60)
      || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
      || (codePoint >= 0x1f000 && codePoint <= 0x1faff)
      || (codePoint >= 0x20000 && codePoint <= 0x2fffd)
      || (codePoint >= 0x30000 && codePoint <= 0x3fffd)
  );
}
