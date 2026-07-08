import MarkdownIt from "markdown-it";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "node:path";

export interface ManualSource {
  absolutePath: string;
  relativePath: string;
  content: string;
}

interface HeadingInfo {
  level: number;
  text: string;
  id: string;
  slug: string;
}

interface PreparedSource extends ManualSource {
  docId: string;
  title: string;
  headings: HeadingInfo[];
}

export interface ManualHtmlOptions {
  manualRoot: string;
  title?: string;
  sources?: ManualSource[];
  allSources?: ManualSource[];
  currentOutputFileName?: string;
  outputFileNameBySource?: Map<string, string>;
}

export interface ManualPdfOptions extends ManualHtmlOptions {
  outputDir?: string;
  keepHtml?: boolean;
}

export interface DefaultManualPdfPaths {
  manualRoot: string;
  outputDir: string;
}

export interface ManualBundle {
  id: string;
  title: string;
  outputFileName: string;
  sources: ManualSource[];
}

const DEFAULT_TITLE = "VeriSpecOSLab 实验指导书";
const DEFAULT_OUTPUT_RELATIVE = "dist/manual";

const SECTION_ORDER = [
  "README.md",
  "book",
  "labs",
  "specs",
  "appendices",
  "vos",
  "teacher",
] as const;

const EXPLICIT_FILE_ORDER: Record<string, string[]> = {
  labs: [
    "lab1-seed.md",
    "lab2-boot.md",
    "lab3-memory.md",
    "lab4-interrupts.md",
    "lab5-user-space.md",
    "lab6-filesystem.md",
    "lab7-resource-abi.md",
    "lab8-personal-goal.md",
    "lab9-hardware-port.md",
    "final-lab.md",
  ],
  appendices: [
    "ai-policy.md",
    "common-bugs.md",
    "debugging-methodology.md",
    "dev-environment.md",
    "dev-environment-setup.md",
    "final-report-template.md",
    "gdb-guide.md",
    "grading.md",
    "invariant-checker.md",
    "linker-script.md",
    "qemu-guide.md",
    "riscv-reference.md",
    "stm32-bare-metal-lab.md",
    "tools-overview.md",
    "vos-commands.md",
  ],
  specs: [
    "overview.md",
    "architecture-design-spec.md",
    "architecture-composition-spec.md",
    "module-spec.md",
    "operation-contract.md",
    "concurrency-spec.md",
    "goal-validation-contract.md",
    "spec-workflow.md",
    "spec-patch.md",
    "ai-collaboration-log.md",
  ],
  teacher: [
    "course-plan.md",
    "lab-release-plan.md",
    "stage-gates.md",
    "rubric.md",
    "ta-checklist.md",
    "judge-policy.md",
    "ai-audit-policy.md",
    "defense-questions.md",
  ],
  vos: [
    "index.md",
    "01-overview.md",
    "02-commands-spec-arch.md",
    "03-commands-build-run-test.md",
    "04-commands-verify-agent-report.md",
    "05-spec-schema-arch-module-op.md",
    "06-spec-schema-toolchain-verify-evolution.md",
    "appendix-a-cheatsheet.md",
    "appendix-b-glossary.md",
    "appendix-c-spec-fields.md",
    "appendix-d-xv6-reference.md",
  ],
};

const LAB_BUNDLES: Array<{
  id: string;
  label: string;
  bookSources: string[];
  labSources: string[];
}> = [
    {
      id: "lab1",
      label: "Lab 1",
      bookSources: ["book/ch00-overview.md", "book/ch01-design-space.md"],
      labSources: ["labs/lab1-seed.md"],
    },
    {
      id: "lab2",
      label: "Lab 2",
      bookSources: ["book/ch02-boot.md"],
      labSources: ["labs/lab2-boot.md"],
    },
    {
      id: "lab3",
      label: "Lab 3",
      bookSources: ["book/ch03-memory.md"],
      labSources: ["labs/lab3-memory.md"],
    },
    {
      id: "lab4",
      label: "Lab 4",
      bookSources: ["book/ch04-interrupts.md"],
      labSources: ["labs/lab4-interrupts.md"],
    },
    {
      id: "lab5",
      label: "Lab 5",
      bookSources: ["book/ch05-user-space.md"],
      labSources: ["labs/lab5-user-space.md"],
    },
    {
      id: "lab6",
      label: "Lab 6",
      bookSources: ["book/ch06-filesystem.md"],
      labSources: ["labs/lab6-filesystem.md"],
    },
    {
      id: "lab7",
      label: "Lab 7",
      bookSources: ["book/ch07-resource-abi.md"],
      labSources: ["labs/lab7-resource-abi.md"],
    },
    {
      id: "lab8",
      label: "Lab 8",
      bookSources: ["book/ch08-personal-goal.md"],
      labSources: ["labs/lab8-personal-goal.md"],
    },
    {
      id: "lab9",
      label: "Lab 9",
      bookSources: ["book/ch09-hardware-port.md"],
      labSources: ["labs/lab9-hardware-port.md"],
    },
    {
      id: "final-lab",
      label: "Final Lab",
      bookSources: ["book/ch10-verification.md"],
      labSources: ["labs/final-lab.md"],
    },
  ];

const SHARED_BUNDLES: Array<Omit<ManualBundle, "sources"> & { section: string }> = [
  { id: "shared-specs", title: "Specs 规格手册", outputFileName: "shared/shared-specs.pdf", section: "specs" },
  { id: "shared-vos", title: "VOS 用户手册", outputFileName: "shared/shared-vos.pdf", section: "vos" },
  { id: "teacher", title: "Teacher 教师手册", outputFileName: "teacher/teacher.pdf", section: "teacher" },
];

const APPENDIX_BUNDLES: Array<{
  id: string;
  title: string;
  outputFileName: string;
  sourcePath: string;
}> = EXPLICIT_FILE_ORDER.appendices.map((filename) => {
  const id = filename.replace(/\.md$/, "");
  const title = filename
    .replace(/\.md$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return {
    id: `appendix-${id}`,
    title: `Appendix: ${title}`,
    outputFileName: `appendices/${id}.pdf`,
    sourcePath: `appendices/${filename}`,
  };
});

export function resolveDefaultPaths(repoRoot = process.cwd()): DefaultManualPdfPaths {
  const root = normalize(repoRoot);
  return {
    manualRoot: normalize(join(root, "docs", "manual")),
    outputDir: normalize(join(root, DEFAULT_OUTPUT_RELATIVE)),
  };
}

export function createPlaywrightEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    PLAYWRIGHT_BROWSERS_PATH: "0",
  };
}

export function discoverManualSources(manualRoot: string): ManualSource[] {
  const root = resolve(manualRoot);
  if (!existsSync(root)) {
    throw new Error(`manual source directory does not exist: ${toDisplayPath(manualRoot)}`);
  }

  const files = collectMarkdownFiles(root)
    .map((absolutePath) => ({
      absolutePath,
      relativePath: toPosixPath(relative(root, absolutePath)),
      content: readFileSync(absolutePath, "utf8"),
    }))
    .sort((left, right) => compareManualPaths(left.relativePath, right.relativePath));

  return files;
}

export function buildManualBundles(manualRoot: string): ManualBundle[] {
  const sources = discoverManualSources(manualRoot);
  const sourceByPath = new Map(sources.map((source) => [source.relativePath, source]));
  const assignedSources = new Map<string, string>();
  const bundles: ManualBundle[] = [];

  for (const lab of LAB_BUNDLES) {
    const bookSources = lab.bookSources
      .map((path) => sourceByPath.get(path))
      .filter((source): source is ManualSource => Boolean(source));
    const labSources = lab.labSources
      .map((path) => sourceByPath.get(path))
      .filter((source): source is ManualSource => Boolean(source));

    if (bookSources.length > 0) {
      markAssignedSources(bookSources, assignedSources, `${lab.id}-book`);
      bundles.push({
        id: `${lab.id}-book`,
        title: `${lab.label} Book`,
        outputFileName: `${lab.id}/${lab.id}-book.pdf`,
        sources: bookSources,
      });
    }

    if (labSources.length > 0) {
      markAssignedSources(labSources, assignedSources, `${lab.id}-lab`);
      bundles.push({
        id: `${lab.id}-lab`,
        title: `${lab.label} Lab`,
        outputFileName: `${lab.id}/${lab.id}-lab.pdf`,
        sources: labSources,
      });
    }
  }

  for (const appendix of APPENDIX_BUNDLES) {
    const source = sourceByPath.get(appendix.sourcePath);
    if (source) {
      markAssignedSources([source], assignedSources, appendix.id);
      bundles.push({
        id: appendix.id,
        title: appendix.title,
        outputFileName: appendix.outputFileName,
        sources: [source],
      });
    }
  }

  for (const bundle of SHARED_BUNDLES) {
    const bundleSources = sources.filter((source) => source.relativePath.startsWith(`${bundle.section}/`));
    if (bundleSources.length > 0) {
      markAssignedSources(bundleSources, assignedSources, bundle.id);
      bundles.push({
        id: bundle.id,
        title: bundle.title,
        outputFileName: bundle.outputFileName,
        sources: bundleSources,
      });
    }
  }

  assertAllManualSourcesAreBundled(sources, assignedSources);
  return bundles;
}

function markAssignedSources(
  sources: ManualSource[],
  assignedSources: Map<string, string>,
  bundleId: string,
): void {
  for (const source of sources) {
    const existingBundle = assignedSources.get(source.relativePath);
    if (existingBundle && existingBundle !== bundleId) {
      throw new Error([
        "manual markdown file is assigned to multiple PDF bundles:",
        `- ${source.relativePath}: ${existingBundle}, ${bundleId}`,
      ].join("\n"));
    }
    assignedSources.set(source.relativePath, bundleId);
  }
}

function assertAllManualSourcesAreBundled(
  sources: ManualSource[],
  assignedSources: Map<string, string>,
): void {
  const unassignedSources = sources
    .map((source) => source.relativePath)
    .filter((relativePath) => relativePath !== "README.md" && !assignedSources.has(relativePath));

  if (unassignedSources.length === 0) return;

  throw new Error([
    "manual markdown files are not assigned to any PDF bundle:",
    ...unassignedSources.map((source) => `- ${source}`),
  ].join("\n"));
}

export function buildManualHtml(options: ManualHtmlOptions): string {
  const manualRoot = resolve(options.manualRoot);
  const title = options.title ?? DEFAULT_TITLE;
  const rawAllSources = options.allSources ?? discoverManualSources(manualRoot);
  const rawSources = options.sources ?? rawAllSources;
  const sources = prepareSources(rawSources);
  const metadata = createMetadata(prepareSources(rawAllSources));
  const markdown = createMarkdownRenderer(
    metadata,
    manualRoot,
    options.currentOutputFileName,
    options.outputFileNameBySource,
  );
  const sections = sources
    .map((source) => {
      const rendered = markdown.render(source.content, {
        currentSource: source,
        headingIndex: 0,
      });
      return [
        `<section class="manual-doc" data-source="${escapeHtml(source.relativePath)}">`,
        `<div class="source-path">${escapeHtml(source.relativePath)}</div>`,
        rendered,
        "</section>",
      ].join("\n");
    })
    .join("\n");

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${manualCss()}</style>`,
    "</head>",
    "<body>",
    renderToc(sources, title),
    sections,
    "</body>",
    "</html>",
  ].join("\n");
}

export async function exportManualPdf(options: ManualPdfOptions): Promise<string> {
  const outputs = await exportManualPdfs(options);
  return outputs[0] ?? "";
}

export async function exportManualPdfs(options: ManualPdfOptions): Promise<string[]> {
  const paths = resolveDefaultPaths(findRepoRoot(process.cwd()));
  const manualRoot = resolve(options.manualRoot || paths.manualRoot);
  const outputDir = resolve(options.outputDir || paths.outputDir);
  const workDir = join(outputDir, ".manual-pdf-work");
  const bundles = buildManualBundles(manualRoot);
  const allSources = bundles.flatMap((bundle) => bundle.sources);
  const outputFileNameBySource = new Map(bundles.flatMap((bundle) => (
    bundle.sources.map((source) => [source.relativePath, bundle.outputFileName])
  )));

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });

  process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
  const { chromium } = await import("playwright");
  const browserPath = chromium.executablePath();
  if (!existsSync(browserPath)) {
    throw new Error([
      "Playwright Chromium is not installed in the workspace dependency tree.",
      "Run: bun run manual:pdf:install",
    ].join("\n"));
  }

  const outputs: string[] = [];

  for (const bundle of bundles) {
    const outputPath = join(outputDir, bundle.outputFileName);
    const bundleWorkDir = join(workDir, bundle.id);
    const htmlPath = join(bundleWorkDir, "manual.html");
    const html = buildManualHtml({
      manualRoot,
      title: options.title ? `${options.title} - ${bundle.title}` : bundle.title,
      sources: bundle.sources,
      allSources,
      currentOutputFileName: bundle.outputFileName,
      outputFileNameBySource,
    });

    mkdirSync(dirname(outputPath), { recursive: true });
    mkdirSync(bundleWorkDir, { recursive: true });
    writeFileSync(htmlPath, html, "utf8");

    const result = spawnSync(browserPath, createChromiumPdfArgs(htmlPath, outputPath), {
      cwd: findRepoRoot(process.cwd()),
      env: createPlaywrightEnv(),
      encoding: "utf8",
      stdio: "pipe",
    });

    if (result.status !== 0) {
      throw new Error([
        `Chromium failed to export ${bundle.outputFileName}.`,
        "Run: bun run manual:pdf:install",
        sanitizeProcessOutput(result.stderr || result.stdout || ""),
      ].filter(Boolean).join("\n"));
    }

    if (!existsSync(outputPath)) {
      throw new Error(`Chromium finished without writing ${bundle.outputFileName}.`);
    }

    outputs.push(outputPath);
  }

  if (!options.keepHtml) {
    rmSync(workDir, { recursive: true, force: true });
  }

  return outputs;
}

export function createChromiumPdfArgs(
  htmlPath: string,
  outputPath: string,
): string[] {
  return [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--no-pdf-header-footer",
    "--print-to-pdf-no-header",
    "--allow-file-access-from-files",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1000",
    `--print-to-pdf=${outputPath}`,
    resolve(htmlPath),
  ];
}

export function installPlaywrightChromium(): number {
  const result = spawnSync(process.execPath, ["x", "playwright", "install", "chromium"], {
    cwd: findRepoRoot(process.cwd()),
    env: createPlaywrightEnv(),
    stdio: "inherit",
  });

  return typeof result.status === "number" ? result.status : 1;
}

function prepareSources(sources: ManualSource[]): PreparedSource[] {
  return sources.map((source) => {
    const docId = `manual-${sanitizeId(source.relativePath)}`;
    const headings = extractHeadings(source.content, docId);
    return {
      ...source,
      docId,
      title: headings[0]?.text ?? source.relativePath,
      headings,
    };
  });
}

function createMetadata(sources: PreparedSource[]): Map<string, PreparedSource> {
  return new Map(sources.map((source) => [source.relativePath, source]));
}

function createMarkdownRenderer(
  metadata: Map<string, PreparedSource>,
  manualRoot: string,
  currentOutputFileName?: string,
  outputFileNameBySource?: Map<string, string>,
): MarkdownIt {
  const markdown = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
  });
  const defaultHeadingOpen = markdown.renderer.rules.heading_open;
  const defaultLinkOpen = markdown.renderer.rules.link_open;

  markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
    const current = env.currentSource as PreparedSource;
    const headingIndex = env.headingIndex as number;
    const heading = current.headings[headingIndex];
    env.headingIndex = headingIndex + 1;
    if (heading) {
      tokens[index]?.attrSet("id", heading.id);
    }
    return defaultHeadingOpen
      ? defaultHeadingOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const current = env.currentSource as PreparedSource;
    const token = tokens[index];
    const href = token?.attrGet("href");
    if (href) {
      token?.attrSet("href", rewriteLinkHref(
        href,
        current,
        metadata,
        manualRoot,
        currentOutputFileName,
        outputFileNameBySource,
      ));
    }
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };

  return markdown;
}

function rewriteLinkHref(
  href: string,
  current: PreparedSource,
  metadata: Map<string, PreparedSource>,
  manualRoot: string,
  currentOutputFileName?: string,
  outputFileNameBySource?: Map<string, string>,
): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) {
    return href;
  }

  const [rawPath, rawHash] = href.split("#", 2);
  if (!rawPath || extname(rawPath).toLowerCase() !== ".md") {
    return href;
  }

  const resolved = normalize(resolve(dirname(join(manualRoot, current.relativePath)), rawPath));
  const relativePath = toPosixPath(relative(manualRoot, resolved));
  const target = metadata.get(relativePath);
  if (!target) {
    return href;
  }

  if (!rawHash) {
    return linkToTarget(target, currentOutputFileName, outputFileNameBySource);
  }

  const normalizedHash = decodeURIComponent(rawHash).replace(/^#+/, "");
  const hashSlug = slugifyHeading(normalizedHash);
  const targetHeading = target.headings.find((heading) => heading.slug === hashSlug);
  return linkToTarget(target, currentOutputFileName, outputFileNameBySource, targetHeading?.id);
}

function linkToTarget(
  target: PreparedSource,
  currentOutputFileName?: string,
  outputFileNameBySource?: Map<string, string>,
  explicitAnchor?: string,
): string {
  const anchor = explicitAnchor ?? target.headings[0]?.id ?? target.docId;
  const targetOutputFileName = outputFileNameBySource?.get(target.relativePath);

  if (!targetOutputFileName || targetOutputFileName === currentOutputFileName) {
    return `#${anchor}`;
  }

  const relativeOutputPath = currentOutputFileName
    ? toPosixPath(relative(dirname(currentOutputFileName), targetOutputFileName))
    : targetOutputFileName;
  return `${relativeOutputPath}#${anchor}`;
}

function extractHeadings(markdown: string, docId: string): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const parser = new MarkdownIt({ html: false });
  const tokens = parser.parse(markdown, {});

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || token.type !== "heading_open") continue;
    const inline = tokens[index + 1];
    const text = inline?.type === "inline" ? inline.content.trim() : "";
    const level = Number(token.tag.replace("h", ""));
    const slug = slugifyHeading(text);
    const suffix = headings.length === 0 ? "h1" : `h${headings.length + 1}`;
    headings.push({
      level,
      text,
      slug,
      id: `${docId}-${suffix}`,
    });
  }

  return headings;
}

function collectMarkdownFiles(root: string): string[] {
  const entries = Array.from(new Bun.Glob("**/*.md").scanSync({ cwd: root, absolute: true }));
  return entries.map((entry) => normalize(entry));
}

function compareManualPaths(left: string, right: string): number {
  const leftRank = rankManualPath(left);
  const rightRank = rankManualPath(right);

  for (let index = 0; index < Math.max(leftRank.length, rightRank.length); index += 1) {
    const leftValue = leftRank[index] ?? 0;
    const rightValue = rightRank[index] ?? 0;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }

  return left.localeCompare(right, "en", { numeric: true });
}

function rankManualPath(relativePath: string): number[] {
  if (relativePath === "README.md") return [0, 0, 0];

  const [section = "", filename = ""] = relativePath.split("/");
  const sectionIndex = SECTION_ORDER.indexOf(section as (typeof SECTION_ORDER)[number]);
  const sectionRank = sectionIndex === -1 ? SECTION_ORDER.length : sectionIndex;
  const explicitOrder = EXPLICIT_FILE_ORDER[section];
  const fileRank = explicitOrder?.indexOf(filename) ?? -1;

  return [sectionRank, fileRank === -1 ? 10000 : fileRank, naturalPathNumber(filename)];
}

function naturalPathNumber(value: string): number {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : 10000;
}

function renderToc(sources: PreparedSource[], title: string): string {
  const items = sources.map((source) => {
    const href = source.headings[0]?.id ?? source.docId;
    return `<li><a href="#${href}">${escapeHtml(source.title)}</a><span>${escapeHtml(source.relativePath)}</span></li>`;
  }).join("\n");

  return [
    '<nav class="toc">',
    `<h1>${escapeHtml(title)}目录</h1>`,
    "<ol>",
    items,
    "</ol>",
    "</nav>",
  ].join("\n");
}

function manualCss(): string {
  return `
@page {
  size: A4;
  margin: 16mm 14mm 18mm 14mm;
}

:root {
  color: #1f2937;
  font-family: "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", sans-serif;
  font-size: 13px;
  line-height: 1.68;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.cover {
  break-after: page;
  min-height: 230mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border-top: 3px solid #1f2937;
  border-bottom: 1px solid #d0d5dd;
}

.cover h1 {
  margin: 0;
  font-size: 34px;
  line-height: 1.22;
}

.cover p {
  margin: 12px 0 0;
  color: #667085;
  font-size: 16px;
}

.toc {
  break-after: page;
}

.toc h1 {
  margin-top: 0;
}

.toc ol {
  padding-left: 0;
  list-style-position: inside;
}

.toc li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 4px 0;
  border-bottom: 1px dotted #d0d5dd;
}

.toc span,
.source-path {
  color: #667085;
  font-size: 10px;
}

.manual-doc {
  break-before: page;
}

.manual-doc h1 {
  margin-top: 0;
  padding-bottom: 6px;
  border-bottom: 1px solid #d0d5dd;
  font-size: 25px;
}

h2 {
  margin-top: 24px;
  font-size: 19px;
}

h3 {
  margin-top: 18px;
  font-size: 16px;
}

h4,
h5,
h6 {
  margin-top: 14px;
  font-size: 14px;
}

p,
li {
  widows: 2;
  orphans: 2;
}

a {
  color: #175cd3;
  text-decoration: none;
}

blockquote {
  margin: 14px 0;
  padding: 8px 12px;
  border-left: 3px solid #98a2b3;
  color: #475467;
  background: #f9fafb;
}

pre,
code {
  font-family: "Cascadia Code", "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
}

code {
  padding: 1px 4px;
  border-radius: 3px;
  background: #f2f4f7;
  font-size: 0.92em;
}

pre {
  margin: 12px 0;
  padding: 10px 12px;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  border: 1px solid #d0d5dd;
  border-radius: 6px;
  background: #f9fafb;
  break-inside: avoid;
}

pre code {
  padding: 0;
  background: transparent;
}

table {
  width: 100%;
  margin: 12px 0;
  border-collapse: collapse;
  break-inside: avoid;
  font-size: 11px;
}

th,
td {
  padding: 5px 7px;
  border: 1px solid #d0d5dd;
  vertical-align: top;
}

th {
  background: #eef2f6;
  font-weight: 700;
}

tr:nth-child(even) td {
  background: #fcfcfd;
}

img {
  max-width: 100%;
  height: auto;
}
`;
}

function slugifyHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]+/gu, "")
    .replace(/\s+/g, "-")
    || "section";
}

function sanitizeId(value: string): string {
  return toPosixPath(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeProcessOutput(value: string): string {
  const repoRoot = findRepoRoot(process.cwd());
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return value
    .split(/\r?\n/)
    .map((line) => line.replaceAll(repoRoot, "<repo>").replaceAll(home, "<home>"))
    .filter((line) => line.trim().length > 0)
    .slice(0, 12)
    .join("\n");
}

function toDisplayPath(value: string): string {
  if (!isAbsolute(value)) return toPosixPath(value);
  return toPosixPath(relative(findRepoRoot(process.cwd()), value));
}

function toPosixPath(value: string): string {
  return value.split(sep).join("/");
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "vos", "package.json")) && existsSync(join(current, "docs", "manual"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

function parseArgs(args: string[]): ManualPdfOptions {
  const paths = resolveDefaultPaths(findRepoRoot(process.cwd()));
  const options: ManualPdfOptions = {
    manualRoot: paths.manualRoot,
    outputDir: paths.outputDir,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manual-root") {
      options.manualRoot = requireValue(args, ++index, arg);
    } else if (arg === "--output-dir" || arg === "--output") {
      options.outputDir = requireValue(args, ++index, arg);
    } else if (arg === "--title") {
      options.title = requireValue(args, ++index, arg);
    } else if (arg === "--keep-html") {
      options.keepHtml = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function printHelp(): void {
  console.log([
    "Usage: bun run manual:pdf [options]",
    "",
    "Options:",
    "  --manual-root <path>  Source directory, default docs/manual",
    "  --output-dir <path>   Output directory, default dist/manual",
    "  --title <text>        PDF title",
    "  --keep-html           Keep intermediate HTML next to the PDF",
  ].join("\n"));
}

if (import.meta.main) {
  try {
    const outputPaths = await exportManualPdfs(parseArgs(Bun.argv.slice(2)));
    console.log("PDFs written:");
    for (const outputPath of outputPaths) {
      console.log(`- ${toDisplayPath(outputPath)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
