import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";
import {
  buildManualBundles,
  buildManualHtml,
  createChromiumPdfArgs,
  createPlaywrightEnv,
  discoverManualSources,
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
  writeFileSync(join(manualRoot, "book", "ch00-overview.md"), "# Chapter 0\n");
  writeFileSync(join(manualRoot, "book", "ch01-design-space.md"), "# Chapter 1\n");
  writeFileSync(join(manualRoot, "book", "ch02-boot.md"), "# Chapter 2\n");
  writeFileSync(join(manualRoot, "book", "ch10-verification.md"), "# Chapter 10\n");
  writeFileSync(join(manualRoot, "labs", "lab1-seed.md"), "# Lab 1\n\nSee [Chapter 0](../book/ch00-overview.md).\n");
  writeFileSync(join(manualRoot, "labs", "lab2-boot.md"), "# Lab 2\n");
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
      "book/ch00-overview.md",
      "book/ch01-design-space.md",
      "book/ch02-boot.md",
      "book/ch10-verification.md",
      "labs/lab1-seed.md",
      "labs/lab2-boot.md",
      "labs/final-lab.md",
      "specs/overview.md",
      "appendices/dev-environment.md",
      "vos/index.md",
      "vos/01-overview.md",
      "teacher/course-plan.md",
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
      ["final-lab-book", "final-lab/final-lab-book.pdf"],
      ["final-lab-lab", "final-lab/final-lab-lab.pdf"],
      ["shared-specs", "shared/shared-specs.pdf"],
      ["shared-appendices", "shared/shared-appendices.pdf"],
      ["shared-vos", "shared/shared-vos.pdf"],
      ["teacher", "teacher/teacher.pdf"],
    ]);
    expect(bundles.flatMap((bundle) => bundle.sources.map((source) => source.relativePath))).not.toContain("README.md");
    expect(bundles.find((bundle) => bundle.id === "lab1-book")?.sources.map((source) => source.relativePath)).toEqual([
      "book/ch00-overview.md",
      "book/ch01-design-space.md",
    ]);
    expect(bundles.find((bundle) => bundle.id === "lab1-lab")?.sources.map((source) => source.relativePath)).toEqual([
      "labs/lab1-seed.md",
    ]);
    expect(bundles.find((bundle) => bundle.id === "shared-vos")?.sources.map((source) => source.relativePath)).toEqual([
      "vos/index.md",
      "vos/01-overview.md",
    ]);
  });

  test("fails when a manual markdown file is not assigned to any PDF", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    writeFileSync(join(manualRoot, "book", "ch99-extra.md"), "# Extra Chapter\n");

    expect(() => buildManualBundles(manualRoot)).toThrow("manual markdown files are not assigned to any PDF bundle");
  });

  test("renders internal markdown links as local PDF anchors", () => {
    const repoRoot = createManualFixture();
    const manualRoot = join(repoRoot, "docs", "manual");
    const html = buildManualHtml({ manualRoot, title: "Manual Export" });

    expect(html).toContain("href=\"#manual-labs-lab1-seed-md-h1\"");
    expect(html).toContain("href=\"#manual-book-ch00-overview-md-h1\"");
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

    expect(html).toContain("href=\"lab1-book.pdf#manual-book-ch00-overview-md-h1\"");
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
