import { describe, expect, test } from "bun:test";
import {
  renderMarkdown,
  segmentsToText,
  starsDarkStyle,
  withStyles,
  withWordWrap,
} from "../../app/render/index.ts";

describe("markdown renderer", () => {
  test("keeps visible URL fallbacks while marking link text as clickable", () => {
    const rendered = renderMarkdown(
      "Read [docs](https://example.com/docs).",
      withStyles(starsDarkStyle),
      withWordWrap(80),
    );

    const firstLine = rendered.lines[0];

    expect(firstLine ? segmentsToText(firstLine.segments) : "").toBe("Read docs https://example.com/docs.");
    expect(firstLine?.segments).toContainEqual({
      text: "docs",
      style: { fg: "cyan" },
      link: "https://example.com/docs",
    });
    expect(firstLine?.segments).toContainEqual({
      text: "https://example.com/docs",
      style: { fg: "cyan" },
      link: "https://example.com/docs",
    });
  });

  test("soft-wraps code fences while preserving styled trailing spaces", () => {
    const rendered = renderMarkdown(
      "```ts\nalpha  \nalpha beta gamma delta\n```",
      withStyles(starsDarkStyle),
      withWordWrap(20),
    );

    const texts = rendered.lines.map((line) => segmentsToText(line.segments));

    expect(texts).toEqual([
      " alpha  ",
      " alpha beta gamma ",
      " delta",
    ]);
    expect(rendered.lines[0]?.segments.at(-1)).toEqual({ text: " alpha  ", style: { fg: "cyan" } });
  });

  test("renders GFM tables and nested task lists with stable plain-text layout", () => {
    const rendered = renderMarkdown(
      [
        "| Area | Status |",
        "| --- | --- |",
        "| TUI | ready |",
        "",
        "- [x] ship markdown",
        "  - [ ] tune links",
      ].join("\n"),
      withStyles(starsDarkStyle),
      withWordWrap(80),
    );

    expect(rendered.lines.map((line) => segmentsToText(line.segments))).toEqual([
      "Area | Status",
      "-----|-------",
      "TUI  | ready ",
      "",
      "• [✓] ship markdown",
      "  • [ ] tune links",
    ]);
  });

  test("highlights common TypeScript tokens inside code fences", () => {
    const rendered = renderMarkdown(
      "```ts\nconst count = 42; // ok\nreturn \"done\";\n```",
      withStyles(starsDarkStyle),
      withWordWrap(80),
    );

    const firstLine = rendered.lines[0];
    const secondLine = rendered.lines[1];

    expect(firstLine ? segmentsToText(firstLine.segments) : "").toBe(" const count = 42; // ok");
    expect(secondLine ? segmentsToText(secondLine.segments) : "").toBe(" return \"done\";");
    expect(firstLine?.segments).toContainEqual({ text: "const", style: { bold: true, fg: "magenta" } });
    expect(firstLine?.segments).toContainEqual({ text: "42", style: { fg: "yellow" } });
    expect(firstLine?.segments).toContainEqual({ text: "// ok", style: { dim: true, fg: "cyan" } });
    expect(secondLine?.segments).toContainEqual({ text: "return", style: { bold: true, fg: "magenta" } });
    expect(secondLine?.segments).toContainEqual({ text: "\"done\"", style: { fg: "green" } });
  });

  test("keeps code block base color when token styles omit their own color", () => {
    const rendered = renderMarkdown(
      "```ts\nconst value = 1;\n```",
      withStyles({
        text: { color: "red" },
        codeBlock: { color: "cyan", margin: 1 },
        codeKeyword: { bold: true },
      }),
      withWordWrap(80),
    );

    expect(rendered.lines[0]?.segments).toContainEqual({
      text: "const",
      style: { bold: true, fg: "cyan" },
    });
  });
});
