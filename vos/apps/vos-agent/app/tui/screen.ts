import { cursorTo, hyperlinkEnd, hyperlinkStart, sgr } from "./ansi.ts";
import { printableCellWidth } from "./display-width.ts";
import { defaultStyle, normalizeStyle, stylesEqual } from "./style.ts";
import type { Style } from "./style.ts";
import type { PrintableCellWidth } from "./display-width.ts";

export type Cell = Readonly<{
  char: string;
  style: Style;
  link?: string;
}>;

type MutableCell = {
  char: string;
  style: Style;
  width: DisplayCellWidth;
  link?: string;
};

const blankChar = " ";
type DisplayCellWidth = PrintableCellWidth;

/**
 * Fixed-size, zero-based cell buffer used by the Stars TUI renderer.
 *
 * This is intentionally small rather than a general terminal layout engine,
 * but it is Unicode cell-width aware for the common interactive cases: ASCII,
 * Latin-1, box-drawing UI glyphs, CJK/full-width text, and common emoji.
 * Wide characters occupy a leading cell plus a continuation cell so terminal
 * diffs can repaint and clear them without corrupting neighboring columns.
 */
export class ScreenBuffer {
  readonly width: number;
  readonly height: number;

  private readonly cells: MutableCell[];

  constructor(width: number, height: number) {
    assertPositiveInteger(width, "width");
    assertPositiveInteger(height, "height");

    this.width = width;
    this.height = height;
    this.cells = Array.from(
      { length: width * height },
      () => createCell(blankChar, defaultStyle),
    );
  }

  getCell(x: number, y: number): Cell {
    return copyPublicCell(this.cells[this.indexOf(x, y)]);
  }

  getCellWidth(x: number, y: number): DisplayCellWidth {
    return this.cells[this.indexOf(x, y)].width;
  }

  writeCell(x: number, y: number, char: string, style?: Style, link?: string): this {
    const targetIndex = this.indexOf(x, y);
    const cell = createCell(char, style, link);

    this.clearCellFootprint(x, y);
    if (cell.width === 2) {
      if (x + 1 >= this.width) {
        this.cells[targetIndex] = createCell(blankChar, cell.style);
        return this;
      }

      this.clearCellFootprint(x + 1, y);
      this.cells[targetIndex] = cell;
      this.cells[targetIndex + 1] = createContinuationCell(cell.style, cell.link);
      return this;
    }

    this.cells[targetIndex] = cell;
    return this;
  }

  writeText(x: number, y: number, text: string, style?: Style, link?: string): this {
    assertInBoundsY(y, this.height);

    let offset = 0;
    for (const char of text) {
      const cellWidth = sanitizedCellWidth(char);
      const targetX = x + offset;
      offset += cellWidth;

      if (targetX < 0) {
        continue;
      }
      if (targetX >= this.width) {
        break;
      }

      this.writeCell(targetX, y, char, style, link);
    }

    return this;
  }

  clearCell(x: number, y: number): this {
    return this.writeCell(x, y, blankChar, defaultStyle);
  }

  clear(): this {
    for (let index = 0; index < this.cells.length; index += 1) {
      this.cells[index] = createCell(blankChar, defaultStyle);
    }

    return this;
  }

  clone(): ScreenBuffer {
    const clone = new ScreenBuffer(this.width, this.height);

    for (let index = 0; index < this.cells.length; index += 1) {
      clone.cells[index] = copyMutableCell(this.cells[index]);
    }

    return clone;
  }

  private clearCellFootprint(x: number, y: number): void {
    const index = this.indexOf(x, y);
    const cell = this.cells[index];

    if (cell.width === 0 && x > 0) {
      const leadingIndex = index - 1;
      if (this.cells[leadingIndex]?.width === 2) {
        this.cells[leadingIndex] = createCell(blankChar, defaultStyle);
        this.cells[index] = createCell(blankChar, defaultStyle);
        return;
      }
    }

    this.cells[index] = createCell(blankChar, defaultStyle);
    if (cell.width === 2 && x + 1 < this.width) {
      this.cells[index + 1] = createCell(blankChar, defaultStyle);
    }
  }

  private indexOf(x: number, y: number): number {
    assertInBoundsX(x, this.width);
    assertInBoundsY(y, this.height);

    return y * this.width + x;
  }
}

export function renderScreenDiff(
  previous: ScreenBuffer | undefined,
  current: ScreenBuffer,
): string {
  if (previous !== undefined) {
    assertSameDimensions(previous, current);
  }

  // Emit contiguous changed runs per row. Cursor movement is cheap, but writing
  // unchanged cells causes visible flicker in real terminals and tmux.
  let output = "";
  let activeStyle: Style | undefined;
  let activeLink: string | undefined;

  for (let y = 0; y < current.height; y += 1) {
    let x = 0;

    while (x < current.width) {
      if (!cellChanged(previous, current, x, y)) {
        x += 1;
        continue;
      }

      if (activeLink !== undefined) {
        output += hyperlinkEnd();
        activeLink = undefined;
      }

      output += cursorTo(y + 1, x + 1);

      while (x < current.width && cellChanged(previous, current, x, y)) {
        const cellWidth = current.getCellWidth(x, y);
        if (cellWidth === 0) {
          x += 1;
          continue;
        }

        const cell = current.getCell(x, y);

        if (activeLink !== cell.link) {
          if (activeLink !== undefined) {
            output += hyperlinkEnd();
          }
          if (cell.link !== undefined) {
            output += hyperlinkStart(cell.link);
          }
          activeLink = cell.link;
        }

        if (activeStyle === undefined || !stylesEqual(activeStyle, cell.style)) {
          output += sgr(cell.style);
          activeStyle = cell.style;
        }

        output += cell.char;
        x += cellWidth;
      }
    }
  }

  if (activeLink !== undefined) {
    output += hyperlinkEnd();
  }

  if (activeStyle !== undefined && !stylesEqual(activeStyle, defaultStyle)) {
    output += sgr(defaultStyle);
  }

  return output;
}

function cellChanged(
  previous: ScreenBuffer | undefined,
  current: ScreenBuffer,
  x: number,
  y: number,
): boolean {
  if (previous === undefined) {
    return true;
  }

  return !cellsEqualAt(previous, current, x, y);
}

function cellsEqual(left: Cell, right: Cell): boolean {
  return left.char === right.char
    && stylesEqual(left.style, right.style)
    && left.link === right.link;
}

function cellsEqualAt(left: ScreenBuffer, right: ScreenBuffer, x: number, y: number): boolean {
  return cellsEqual(left.getCell(x, y), right.getCell(x, y))
    && left.getCellWidth(x, y) === right.getCellWidth(x, y);
}

function createCell(char: string, style: Style | undefined, link?: string): MutableCell {
  const sanitized = sanitizeCellInput(char);

  const cell: MutableCell = {
    char: sanitized.char,
    style: copyStyle(normalizeStyle(style)),
    width: sanitized.width,
  };

  if (link !== undefined && link.length > 0) {
    cell.link = link;
  }

  return cell;
}

function createContinuationCell(style: Style, link: string | undefined): MutableCell {
  const cell: MutableCell = {
    char: blankChar,
    style: copyStyle(style),
    width: 0,
  };

  if (link !== undefined) {
    cell.link = link;
  }

  return cell;
}

function copyPublicCell(cell: MutableCell): Cell {
  const publicCell: { char: string; style: Style; link?: string } = {
    char: cell.char,
    style: copyStyle(cell.style),
  };

  if (cell.link !== undefined) {
    publicCell.link = cell.link;
  }

  return publicCell;
}

function copyMutableCell(cell: MutableCell): MutableCell {
  const copy: MutableCell = {
    char: cell.char,
    style: copyStyle(cell.style),
    width: cell.width,
  };

  if (cell.link !== undefined) {
    copy.link = cell.link;
  }

  return copy;
}

function copyStyle(style: Style): Style {
  const normalized = normalizeStyle(style);

  if (stylesEqual(normalized, defaultStyle)) {
    return defaultStyle;
  }

  return { ...normalized };
}

function sanitizeCellInput(input: string): { char: string; width: Exclude<PrintableCellWidth, 0> } {
  const char = Array.from(input)[0];
  if (char === undefined) {
    return { char: blankChar, width: 1 };
  }

  const width = printableCellWidth(char);
  if (width === 0) {
    return { char: blankChar, width: 1 };
  }

  return { char, width };
}

function sanitizedCellWidth(input: string): Exclude<PrintableCellWidth, 0> {
  return sanitizeCellInput(input).width;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function assertInBoundsX(x: number, width: number): void {
  if (!Number.isInteger(x) || x < 0 || x >= width) {
    throw new RangeError(`x must be an integer between 0 and ${width - 1}`);
  }
}

function assertInBoundsY(y: number, height: number): void {
  if (!Number.isInteger(y) || y < 0 || y >= height) {
    throw new RangeError(`y must be an integer between 0 and ${height - 1}`);
  }
}

function assertSameDimensions(previous: ScreenBuffer, current: ScreenBuffer): void {
  if (previous.width !== current.width || previous.height !== current.height) {
    throw new RangeError("screen buffers must have matching dimensions");
  }
}
