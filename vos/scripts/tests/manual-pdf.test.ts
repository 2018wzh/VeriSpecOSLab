import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import {
  buildManualBundles,
  buildManualHtml,
  createChromiumPdfArgs,
  createPlaywrightEnv,
  discoverManualSources,
  prepareManualOutputDir,
  resolveDefaultPaths,
} from "../manual-pdf.ts";

function createManualFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "vos-manual-pdf-"));
  const manualRoot = join(root, "docs", "manual");
  mkdirSync(join(manualRoot, "appendices"), { recursive: true });
  mkdirSync(join(manualRoot, "book"), { recursive: true });
  mkdirSync(join(manualRoot, "labs"), { recursive: true });
  mkdirSync(join(manualRoot, "specs"), { recursive: true });
  mkdirSync(join(manualRoot, "teacher"), { recursive: true });
  mkdirSync(join(manualRoot, "vos"), { recursive: true });

  writeFileSync(join(manualRoot, "README.md"), "# Manual\n\nRead [Lab 1](labs/lab1-seed.md).\n");
  writeFileSync(join(manualRoot, "book", "ch01-overview-design.md"), "# Chapter 1\n");
  writeFileSync(join(manualRoot, "book", "ch02-boot.md"), "# Chapter 2\n");
  writeFileSync(join(manualRoot, "book", "ch10-verification.md"), "# Chapter 10\n");
  writeFileSync(join(manualRoot, "book", "ch11-comprehensive-assessment.md"), "# Chapter 11\n");
  writeFileSync(join(manualRoot, "labs", "lab1-seed.md"), "# Lab 1\n\nSee [Chapter 1](../book/ch01-overview-design.md).\n");
  writeFileSync(join(manualRoot, "labs", "lab2-boot.md"), "# Lab 2\n");
  writeFileSync(join(manualRoot, "labs", "lab10-verification.md"), "# Lab 10\n");
  writeFileSync(join(manualRoot, "labs", "final-lab.md"), "# Final Lab\n");
  writeFileSync(join(manualRoot, "specs", "overview.md"), "# Specs Overview\n");
  writeFileSync(join(manualRoot, "appendices", "dev-environment.md"), "# Dev Environment\n");
  writeFileSync(join(manualRoot, "vos", "index.md"), "# VOS Manual\n");
  writeFileSync(join(manualRoot, "vos", "01-overview.md"), "# VOS Overview\n");
  writeFileSync(join(manualRoot, "teacher", "course-plan.md"), "# Course Plan\n");

  return root;
}

describe("manual PDF export support", () => {
  test("discovers manual markdown files in teaching order", () => {
    const repoRoot = createManualFixture();
    const sources = discoverManualSources(join(repoRoot, "docs", "manual"));

    expect(sources.map((source) => source.relativePath)).toEqual([
      "README.md",
      "book/ch01-overview-design.md",
      "book/ch02-boot.md",
      "book/ch10-verification.md",
      "book/ch11-comprehensive-assessment.md",
      "labs/lab1-seed.md",
      "labs/lab2-boot.md",
      "labs/lab10-verification.md",
      "labs/final-lab.md",
      "vos/01-overview.md",
      "appendices/dev-environment.md",
      "specs/overview.md",
      "teacher/course-plan.md",
      "vos/index.md",
    ]);
  });

  test("splits manual output by lab folders and omits README", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    const bundles = buildManualBundles(manualRoot);

    expect(bundles.map((bundle) => [bundle.id, bundle.outputFileName])).toEqual([
      ["lab1-book", "lab1/lab1-book.pdf"],
      ["lab1-lab", "lab1/lab1-lab.pdf"],
      ["lab2-book", "lab2/lab2-book.pdf"],
      ["lab2-lab", "lab2/lab2-lab.pdf"],
      ["lab10-book", "lab10/lab10-book.pdf"],
      ["lab10-lab", "lab10/lab10-lab.pdf"],
      ["final-lab-book", "final-lab/final-lab-book.pdf"],
      ["final-lab-lab", "final-lab/final-lab-lab.pdf"],
    ]);
    expect(bundles.flatMap((bundle) => bundle.sources.map((source) => source.relativePath))).not.toContain("README.md");
    expect(bundles.find((bundle) => bundle.id === "lab1-book")?.sources.map((source) => source.relativePath)).toEqual([
      "book/ch01-overview-design.md",
    ]);
    expect(bundles.find((bundle) => bundle.id === "lab1-lab")?.sources.map((source) => source.relativePath)).toEqual([
      "labs/lab1-seed.md",
    ]);
    expect(bundles.flatMap((bundle) => bundle.sources.map((source) => source.relativePath)).some((path) => (
      path.startsWith("specs/") || path.startsWith("vos/") || path.startsWith("teacher/") || path.startsWith("appendices/")
    ))).toBe(false);
  });

  test("fails when a manual markdown file is not assigned to any PDF", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    writeFileSync(join(manualRoot, "book", "ch99-extra.md"), "# Extra Chapter\n");

    expect(() => buildManualBundles(manualRoot)).toThrow("manual markdown files are not assigned to any PDF bundle");
  });

  test("publishes exactly the 22 Book/Lab PDFs", () => {
    const repoRoot = resolve(join(import.meta.dir, "../../.."));
    const bundles = buildManualBundles(join(repoRoot, "docs", "manual"));

    expect(bundles).toHaveLength(22);
    expect(bundles.map((bundle) => bundle.outputFileName)).toEqual([
      "lab1/lab1-book.pdf", "lab1/lab1-lab.pdf",
      "lab2/lab2-book.pdf", "lab2/lab2-lab.pdf",
      "lab3/lab3-book.pdf", "lab3/lab3-lab.pdf",
      "lab4/lab4-book.pdf", "lab4/lab4-lab.pdf",
      "lab5/lab5-book.pdf", "lab5/lab5-lab.pdf",
      "lab6/lab6-book.pdf", "lab6/lab6-lab.pdf",
      "lab7/lab7-book.pdf", "lab7/lab7-lab.pdf",
      "lab8/lab8-book.pdf", "lab8/lab8-lab.pdf",
      "lab9/lab9-book.pdf", "lab9/lab9-lab.pdf",
      "lab10/lab10-book.pdf", "lab10/lab10-lab.pdf",
      "final-lab/final-lab-book.pdf", "final-lab/final-lab-lab.pdf",
    ]);
  });

  test("cleans retired output folders before creating the managed publication directory", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    const outputDir = join(repoRoot, "dist", "manual");
    const retiredPath = join(outputDir, "appendices", "old.pdf");
    mkdirSync(join(outputDir, "appendices"), { recursive: true });
    writeFileSync(retiredPath, "stale");

    prepareManualOutputDir(outputDir, manualRoot);

    expect(existsSync(retiredPath)).toBe(false);
    expect(existsSync(outputDir)).toBe(true);
  });

  test("fails when a published document links to an unpublished manual source", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    writeFileSync(join(manualRoot, "labs", "lab2-boot.md"), "# Lab 2\n\nSee [internal](../specs/overview.md).\n");

    expect(() => buildManualBundles(manualRoot)).toThrow("unpublished manual source specs/overview.md");
  });

  test("fails when a published document links to a missing Markdown file", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    writeFileSync(join(manualRoot, "labs", "lab2-boot.md"), "# Lab 2\n\nSee [missing](../book/no-such-chapter.md).\n");

    expect(() => buildManualBundles(manualRoot)).toThrow("missing Markdown link target");
  });

  test("renders internal markdown links as local PDF anchors", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    const html = buildManualHtml({ manualRoot, title: "Manual Export" });

    expect(html).toContain("href=\"#manual-labs-lab1-seed-md-h1\"");
    expect(html).toContain("href=\"#manual-book-ch01-overview-design-md-h1\"");
    expect(html).not.toContain(normalize(repoRoot));
  });

  test("rewrites cross-bundle markdown links to relative lab PDFs", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    const bundles = buildManualBundles(manualRoot);
    const lab1Lab = bundles.find((bundle) => bundle.id === "lab1-lab");

    if (!lab1Lab) throw new Error("missing lab1 bundle");

    const html = buildManualHtml({
      manualRoot,
      title: lab1Lab.title,
      sources: lab1Lab.sources,
      allSources: bundles.flatMap((bundle) => bundle.sources),
      currentOutputFileName: lab1Lab.outputFileName,
      outputFileNameBySource: new Map(bundles.flatMap((bundle) => (
        bundle.sources.map((source) => [source.relativePath, bundle.outputFileName])
      ))),
    });

    expect(html).toContain("href=\"lab1-book.pdf#manual-book-ch01-overview-design-md-h1\"");
    expect(html).not.toContain(normalize(repoRoot));
  });

  test("uses repo-relative default paths for generated output", () => {
    const paths = resolveDefaultPaths("/repo");

    expect(paths.manualRoot).toBe(normalize("/repo/docs/manual"));
    expect(paths.outputDir).toBe(normalize("/repo/dist/manual"));
  });

  test("forces Playwright browsers into the workspace dependency tree", () => {
    const env = createPlaywrightEnv({ PLAYWRIGHT_BROWSERS_PATH: "/outside-cache", FOO: "bar" });

    expect(env.FOO).toBe("bar");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("0");
  });

  test("prints PDFs through a local Chromium executable", () => {
    const args = createChromiumPdfArgs("/tmp/manual.html", "/tmp/manual.pdf");

    expect(args).toContain("--headless=new");
    expect(args).toContain("--no-sandbox");
    expect(args).toContain("--print-to-pdf=/tmp/manual.pdf");
    expect(args.at(-1)).toBe(resolve("/tmp/manual.html"));
  });
});
