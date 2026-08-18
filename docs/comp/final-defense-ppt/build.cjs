const pptxgen = require("pptxgenjs");
const fs = require("node:fs");
const path = require("node:path");

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Glenda Team, East China Normal University";
pptx.subject = "VeriSpecOSLab final defense";
pptx.title = "VeriSpecOSLab：规格驱动的个性化 OS 设计与 Agent Coding 实验平台";
pptx.company = "East China Normal University";
pptx.lang = "zh-CN";
pptx.theme = {
  headFontFace: "Microsoft YaHei",
  bodyFontFace: "Microsoft YaHei",
  lang: "zh-CN",
};
pptx.defineSlideMaster({
  title: "ACADEMIC",
  background: { color: "F7F9FC" },
  objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 0.08, fill: { color: "3156D8" }, line: { color: "3156D8" } } },
  ],
  slideNumber: { x: 12.55, y: 7.08, w: 0.35, h: 0.2, fontFace: "Aptos", fontSize: 8, color: "7B8496", align: "right" },
});

const C = {
  navy: "14213D",
  indigo: "3156D8",
  indigo2: "5B6EE1",
  blueSoft: "EAF0FF",
  green: "168B5B",
  greenSoft: "E7F6EF",
  yellow: "B7791F",
  yellowSoft: "FFF5D6",
  red: "C43D4D",
  redSoft: "FDECEF",
  ink: "172033",
  muted: "667085",
  line: "D8DFEA",
  white: "FFFFFF",
  panel: "FFFFFF",
  gray: "EEF2F7",
  dark: "111827",
};

const repo = path.resolve(__dirname, "../../..");
const media = path.join(repo, "docs", "comp", "final-defense-media");
const figures = path.join(repo, "docs", "comp", "final-report", "figures");
const portal = path.join(repo, "docs", "portal", "visual-acceptance");
const outDir = __dirname;
const outputName = process.env.VOS_PPT_OUTPUT_NAME || "VeriSpecOSLab-final-defense.pptx";
if (!/^[A-Za-z0-9._-]+\.pptx$/.test(outputName))
  throw new Error("VOS_PPT_OUTPUT_NAME must be a safe .pptx filename");
const outFile = path.join(outDir, outputName);
const imageLayoutReport = path.join(outDir, "image-layout-report.json");
const imageLayouts = [];

const notes = [
  "大家好，我们是华东师范大学 Glenda 队。当 AI 已能编写大量内核代码，OS 实验还该训练什么？我们的答案是：让学生设计自己的 OS，让教师评审设计。",
  "xv6、rCore 等课程很适合讲清操作系统机制，但学生通常在给定架构中实现，教师主要看到代码和测试。即使两人都通过测试，也很难据此判断他们是否理解方案取舍。裸 Coding Agent 还可能跳过设计、越界修改，甚至只用文字声称测试通过。程序能运行，仍然说明不了学生为什么这样设计。",
  "构建、调试和代码解释仍是基本训练。在此之上，学生还要定义系统目标、模块边界和验收方法，约束 Agent、阅读差异并判断结果是否可信。教师则从反复排查环境和代码错误，转向审查设计理由、演化过程与证据。正确性仍是门槛，但不再是唯一评价对象。",
  "VeriSpecOSLab 把课程组织成可执行闭环。学生理解问题并亲手写 Spec，Agent 只在明确范围内实现。VOS 独立检查修改，运行构建和测试，再把版本、规格与日志写入报告。成功和失败都有结构化记录，教师可以回到设计与证据，提出意见后进入下一轮。",
  "学生维护五类规格：DesignSpec 记录系统方向，ModuleSpec 描述模块职责、性质和错误，InterfaceSpec 固定跨边界语义，GoalSpec 表达可度量的扩展目标，SpecPatch 说明跨模块修改。ModuleSpec 中的 owns 限定改动范围，properties 和 checks 则进入验证。这样，教师可以据此审查设计，Agent 和 Runner 也能获得一致的任务定义。规格从 L1 到 L3 随课程逐步加深，不要求学生在第一周就写出完整的内核设计。",
  "实现任务从已提交的 Spec 开始。VOS 创建独立的 Git 工作区，并把可修改范围交给 Agent。Agent 必须提交机器可检查的结构化结果；平台随后读取真实 diff，运行 build、public、contract、固定种子 fuzz 和有界 trace。模型声称已经完成不会改变任务状态，测试遗漏或越界修改仍会被拒绝，并回到同一会话修正。全部检查通过且原项目没有漂移后，补丁才会形成独立提交。",
  "学生先写下模块边界和验收性质，lint 只检查结构，不替学生作技术选择。实现助手随后在独立工作区修改代码，VOS 根据真实 diff 检查范围。verify 不调用模型，而是实际执行构建和多类测试；report 再把提交、规格与日志绑定起来。四段画面依次交代设计、修改、验收和硬件结论由谁负责。证据链也由 QEMU 一直延伸到 VisionFive 2 四核实板。",
  "学生缺少背景时，裸模型容易把似是而非的解释写得很确定。VOS 让 ask 从课程知识库取材，并用结构化 citation 指回教材、代码或固定版本资料。引用解决的是根据什么回答，正确性仍由学生核对；找不到来源时，也必须如实留空。",
  "内核故障常只表现为黑屏、超时或一行 trap。Debug Agent 先读取失败 run 的真实日志，再按 trace、GDB、QMP 的顺序补充观测，把外部症状连到寄存器、调用栈和内部路径。它只报告证据、根因候选与下一步命令，不修改源码，也不能把诊断写成修复通过。",
  "物理板卡移植往往同时受启动链、设备模型和固件差异影响。VOS 先根据学生提供的材料生成 QEMU candidate，学生审查并提交后，Agent 才在隔离工作区完成模型移植、启动到 shell 和邻居回归。它能提前暴露软件与设备语义问题，但 QEMU 通过绝不替代真实时钟、引脚和外设证据。",
  "每次实现都落到独立 commit，并写入 Run-ID 与 Spec-Hash。report 再绑定测试、配置和证据，submit 保存脱敏归档。复查时可以在 detached worktree 精确回到该 commit，重新执行验证；原始运行日志不进 Git，只能从对应归档取回。这样既能复原代码状态，也不会把 commit 夸大成全部证据。",
  "课程材料分为 Book 和 Lab。Book 用历史与设计争论解释问题，Lab 给出任务、预期现象和自检点。例如 Lab 1 让学生在 Linux 和裸机中读取同一份 flag，观察 OS 承担的文件与设备访问，再带着这一直觉逐步选择内核组织和资源模型。",
  "xv6 在 VisionFive 2 上启动四个 U74 hart，经 SPI U-Boot、TFTP 与 SD 文件系统跑完完整 usertests，日志给出 ALL TESTS PASSED。Glenda 把同一方法迁移到 AArch64/H5：七项 QEMU trace 先验证软件与设备语义，再由 Orange Pi Prime 串口独立确认四核、GICv2、定时器、MMC 和 EL0 Lab 1–8 工作负载。两个案例都经过 Portal 权威运行、材料上传和教师复核，但 QEMU 与实板证据仍分栏记录。",
  "暑期试讲面向华东师大 2025 级计算机拔尖班的 15 名学生，共两节课。这不是一项教学效果实验，但课堂观察暴露了三个具体问题：Spec 太复杂，学生缺少 OS 背景，大型项目涉及的工具又太多。这些反馈不能证明学习效果提升，却解释了学生为什么难以开始。为此，我们把规格收敛为五类，将设计决定分散到对应 Lab，重写 Book 与 Lab，并用 CTF、统一 CLI 和 doctor 降低起步门槛。",
  "我们借鉴 SYSSPEC、SPECFS 的规格驱动思想，并以 MIT xv6 和 Glenda 为案例。本队把规格、受控 Agent、真实 Runner、教材、教师复核与硬件路径连成教学流程。研发使用 Codex、DeepSeek V4 Pro 和 ChatECNU ecnu-plus；生成内容均经人工修改，并由结构化验收、构建、QEMU 或实板结果验证。",
  "下一学年，这套方案将进入正式课程。我们还计划用它实现和验证 Glenda-Chimera：用 Rust 编写 seL4 风格微内核，用 Go 开发 RPC 风格的系统服务，并通过稳定的 IPC 边界，让同一份服务代码可以在内核态与用户态之间切换。迁移前后，接口、错误和资源语义必须保持一致，正好可以用 Spec 和跨边界测试表达。这个案例将检验平台能否承载跨语言、微内核与学生自主选择的系统设计。",
  "VeriSpecOSLab 改变的是 OS 实验的评价对象。代码和测试证明系统能够运行，Spec、提交与证据则说明学生为什么这样设计，又如何确认 Agent 的实现可信。教师由此获得了可以追问、比较和复核的设计材料。我们不是减少学生思考，而是把学生的思考从重复编码提升到系统设计。谢谢各位老师。",
];

function addText(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: opts.fontFace || "Microsoft YaHei",
    fontSize: opts.fontSize || 14,
    color: opts.color || C.ink,
    bold: Boolean(opts.bold),
    align: opts.align || "left",
    valign: opts.valign || "mid",
    margin: opts.margin === undefined ? 0 : opts.margin,
    breakLine: false,
    fit: "shrink",
    bullet: opts.bullet,
    paraSpaceAfterPt: opts.paraSpaceAfterPt,
    lineSpacingMultiple: opts.lineSpacingMultiple,
    isTextBox: true,
    ...opts,
  });
}

function addHeader(slide, title, kicker = "VERISPECOSLAB") {
  addText(slide, kicker, 0.55, 0.25, 3.0, 0.23, { fontFace: "Aptos", fontSize: 8.5, bold: true, color: C.indigo, charSpacing: 1.6 });
  addText(slide, title, 0.55, 0.55, 12.0, 0.52, { fontSize: 25, bold: true, color: C.navy });
}

function addFooter(slide, refs = "") {
  slide.addShape(pptx.ShapeType.line, { x: 0.55, y: 6.93, w: 12.2, h: 0, line: { color: C.line, width: 0.8 } });
  addText(slide, refs, 0.55, 7.0, 10.6, 0.19, { fontSize: 7.5, color: C.muted });
  addText(slide, "CC BY-SA 4.0", 11.35, 7.0, 0.9, 0.19, { fontFace: "Aptos", fontSize: 7.5, color: C.muted, align: "right" });
}

function addCard(slide, x, y, w, h, title, body, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    fill: { color: opts.fill || C.panel, transparency: opts.transparency || 0 },
    line: { color: opts.line || C.line, width: opts.lineWidth || 1 },
    shadow: opts.shadow === false ? undefined : { type: "outer", color: "AAB4C3", blur: 1.5, angle: 45, distance: 0.6, opacity: 0.12 },
  });
  if (opts.accent) slide.addShape(pptx.ShapeType.rect, { x, y, w: 0.06, h, fill: { color: opts.accent }, line: { color: opts.accent } });
  if (title && body && h < 0.85) {
    const titleWidth = Math.min(1.35, w * 0.34);
    addText(slide, title, x + 0.18, y + 0.1, titleWidth, h - 0.2, { fontSize: opts.titleSize || 12, bold: true, color: opts.titleColor || C.navy });
    addText(slide, body, x + 0.26 + titleWidth, y + 0.1, w - titleWidth - 0.44, h - 0.2, { fontSize: opts.bodySize || 10.5, color: opts.bodyColor || C.ink, valign: "mid", margin: 0.01, fit: "shrink" });
    return;
  }
  if (title) addText(slide, title, x + 0.18, y + 0.12, w - 0.36, 0.32, { fontSize: opts.titleSize || 14, bold: true, color: opts.titleColor || C.navy });
  if (body) addText(slide, body, x + 0.18, y + (title ? 0.53 : 0.16), w - 0.36, Math.max(0.08, h - (title ? 0.65 : 0.3)), { fontSize: opts.bodySize || 11.5, color: opts.bodyColor || C.ink, valign: opts.valign || "top", breakLine: false, margin: 0.02, fit: "shrink" });
}

function addPill(slide, text, x, y, w, color, fill, opts = {}) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: opts.h || 0.34, rectRadius: 0.1, fill: { color: fill }, line: { color: opts.line || fill, width: 0.8 } });
  addText(slide, text, x + 0.07, y + 0.02, w - 0.14, (opts.h || 0.34) - 0.04, { fontSize: opts.fontSize || 9.5, color, bold: opts.bold !== false, align: "center" });
}

function addArrow(slide, x, y, w, color = C.indigo) {
  slide.addShape(pptx.ShapeType.chevron, { x, y, w, h: 0.34, fill: { color }, line: { color }, transparency: 2 });
}

function addImage(slide, file, x, y, w, h, opts = {}) {
  if (!fs.existsSync(file)) throw new Error(`missing image: ${file}`);
  const fit = opts.fit || "contain";
  if (!new Set(["contain", "cover"]).has(fit))
    throw new Error(`unsupported image fit ${fit}: ${file}`);
  const source = rasterDimensions(file);
  imageLayouts.push(layoutRecord(file, source, x, y, w, h, fit));
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: opts.background || C.white },
    line: { color: opts.border || opts.background || C.white, width: opts.borderWidth || 0.8 },
  });
  slide.addImage({
    path: file,
    x, y, w, h,
    sizing: { type: fit, w, h },
    transparency: opts.transparency || 0,
    rounding: opts.rounding,
    altText: opts.altText || path.basename(file),
    objectName: opts.objectName || path.parse(file).name,
  });
  if (opts.border) slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill: { color: C.white, transparency: 100 }, line: { color: opts.border, width: opts.borderWidth || 1 } });
}

function addSvg(slide, file, x, y, w, h) {
  if (!fs.existsSync(file)) throw new Error(`missing SVG: ${file}`);
  const source = svgDimensions(file);
  imageLayouts.push(layoutRecord(file, source, x, y, w, h, "contain"));
  const data = `data:image/svg+xml;base64,${fs.readFileSync(file).toString("base64")}`;
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: C.white },
    line: { color: C.white, transparency: 100 },
  });
  slide.addImage({
    data, x, y, w, h,
    sizing: { type: "contain", w, h },
    altText: path.basename(file),
    objectName: path.parse(file).name,
  });
}

function rasterDimensions(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG")
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  throw new Error(`unsupported raster image format: ${file}`);
}

function svgDimensions(file) {
  const source = fs.readFileSync(file, "utf8");
  const viewBox = source.match(/viewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/i);
  if (!viewBox) throw new Error(`SVG lacks a numeric viewBox: ${file}`);
  return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
}

function layoutRecord(file, source, x, y, w, h, fit) {
  if (!(source.width > 0 && source.height > 0))
    throw new Error(`invalid image dimensions: ${file}`);
  const sourceRatio = source.width / source.height;
  const boxRatio = w / h;
  const rendered = sourceRatio > boxRatio
    ? { width: w, height: w / sourceRatio }
    : { width: h * sourceRatio, height: h };
  return {
    asset: path.relative(repo, file).replaceAll("\\", "/"),
    source_pixels_or_viewbox: source,
    source_ratio: Number(sourceRatio.toFixed(4)),
    box: { x, y, width: w, height: h, ratio: Number(boxRatio.toFixed(4)) },
    fit,
    rendered: {
      width: Number(rendered.width.toFixed(4)),
      height: Number(rendered.height.toFixed(4)),
      uniform_scale: true,
      cropped: fit === "cover" && Math.abs(sourceRatio - boxRatio) > 0.001,
    },
  };
}

function pngDataUri(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

function addMedia(slide, video, poster, x, y, w, h) {
  addImage(slide, poster, x, y, w, h, { border: C.line });
  slide.addShape(pptx.ShapeType.ellipse, { x: x + w / 2 - 0.28, y: y + h / 2 - 0.28, w: 0.56, h: 0.56, fill: { color: C.indigo, transparency: 5 }, line: { color: C.white, width: 1.2 } });
  slide.addShape(pptx.ShapeType.chevron, { x: x + w / 2 - 0.08, y: y + h / 2 - 0.12, w: 0.18, h: 0.24, rotate: 0, fill: { color: C.white }, line: { color: C.white } });
  slide.addMedia({ path: video, type: "video", x, y, w, h, cover: pngDataUri(poster) });
}

function addSlide(title, refs, note) {
  const slide = pptx.addSlide("ACADEMIC");
  addHeader(slide, title);
  addFooter(slide, refs);
  if (note && slide.addNotes) slide.addNotes(note);
  return slide;
}

function bulletRuns(items, color = C.ink) {
  return items.map((t) => ({ text: t, options: { bullet: { indent: 15 }, hanging: 3, breakLine: true, color } }));
}

// P1
{
  const s = pptx.addSlide("ACADEMIC");
  s.background = { color: "F7F9FC" };
  s.addShape(pptx.ShapeType.arc, { x: 8.8, y: -1.2, w: 5.4, h: 5.4, adjustPoint: 0.18, rotate: 20, fill: { color: C.blueSoft, transparency: 4 }, line: { color: C.blueSoft } });
  s.addShape(pptx.ShapeType.arc, { x: 9.65, y: -0.35, w: 3.7, h: 3.7, adjustPoint: 0.18, rotate: 20, fill: { color: C.indigo, transparency: 88 }, line: { color: C.indigo, transparency: 75 } });
  addPill(s, "功能挑战 · 教学型赛道", 0.65, 0.72, 2.25, C.indigo, C.blueSoft, { fontSize: 10 });
  addText(s, "VeriSpecOSLab", 0.65, 1.35, 8.6, 0.82, { fontFace: "Aptos Display", fontSize: 40, bold: true, color: C.navy });
  addText(s, "规格驱动的个性化 OS 设计与 Agent Coding 实验平台", 0.67, 2.3, 9.2, 0.55, { fontSize: 22, color: C.indigo, bold: true });
  addText(s, "让学生设计自己的 OS · 让教师评审设计", 0.67, 3.18, 8.9, 0.46, { fontSize: 19, color: C.ink, bold: true });
  addCard(s, 0.67, 4.0, 3.05, 1.08, "学生", "从实现既定答案\n转向解释系统取舍", { accent: C.indigo, fill: C.white, bodySize: 12 });
  addCard(s, 3.95, 4.0, 3.05, 1.08, "Agent", "受 Spec 约束\n由真实验证负责", { accent: C.green, fill: C.white, bodySize: 12 });
  addCard(s, 7.23, 4.0, 3.05, 1.08, "教师", "从审代码\n转向审设计与证据", { accent: C.yellow, fill: C.white, bodySize: 12 });
  addText(s, "华东师范大学 · Glenda 队", 0.67, 5.7, 5.5, 0.3, { fontSize: 12.5, color: C.muted });
  addText(s, "全国总决赛 · 8 分钟报告", 0.67, 6.08, 5.5, 0.3, { fontSize: 11, color: C.muted });
  addFooter(s, "参赛材料依据当前 v2 实现与 Portal 权威证据整理");
  if (s.addNotes) s.addNotes(notes[0]);
}

// P2
{
  const s = addSlide("代码能通过，不等于学生完成了设计", "[R3][R4][R10]", notes[1]);
  addText(s, "AI 时代的矛盾：评价对象仍停留在“是否实现了既定答案”", 0.57, 1.14, 12.0, 0.38, { fontSize: 15, color: C.muted });
  addCard(s, 0.57, 1.68, 5.7, 3.75, "传统 OS 实验", "给定内核与架构\n补全指定代码\n按测试结果评分\n教师主要排查实现与环境", { accent: "8793A8", fill: "F1F4F8", titleSize: 17, bodySize: 16, bodyColor: C.muted });
  addCard(s, 7.05, 1.68, 5.7, 3.75, "我们要训练的能力", "提出个性化目标\n解释模块与接口取舍\n约束 Agent 并验证结果\n按设计、演化与证据评价", { accent: C.indigo, fill: C.blueSoft, titleSize: 17, bodySize: 16 });
  addArrow(s, 6.39, 3.15, 0.52, C.indigo);
  s.addShape(pptx.ShapeType.roundRect, { x: 1.2, y: 5.72, w: 10.9, h: 0.74, fill: { color: C.redSoft }, line: { color: "F5B8C0" } });
  addText(s, "裸 Coding Agent 的额外风险", 1.43, 5.85, 2.2, 0.28, { fontSize: 12, bold: true, color: C.red });
  addText(s, "跳过设计   ·   越界修改   ·   用文字自报成功", 3.62, 5.83, 7.95, 0.31, { fontSize: 14, bold: true, color: C.red, align: "center" });
}

// P3
{
  const s = addSlide("教学目标发生两次转向", "[R2][R4][R12]", notes[2]);
  addCard(s, 0.58, 1.45, 5.75, 2.1, "学生侧", "代码实现能力\n→ 个性化 OS 设计能力\n→ Agent Coding 工程能力", { accent: C.indigo, titleSize: 18, bodySize: 17, fill: C.white });
  addCard(s, 0.58, 3.88, 5.75, 2.1, "教师侧", "代码审阅者 / 高级调试员\n→ 课程规则制定者\n→ 设计与证据评审者", { accent: C.yellow, titleSize: 18, bodySize: 17, fill: C.white });
  addImage(s, path.join(portal, "teacher-workspace-approved.png"), 6.75, 1.45, 5.95, 4.53, { border: C.line });
  addPill(s, "Portal 是教学控制面", 9.18, 5.72, 2.4, C.indigo, C.blueSoft, { fontSize: 10 });
  addText(s, "正确性仍是门槛，但不再是唯一评价对象", 0.78, 6.35, 5.4, 0.3, { fontSize: 13.5, bold: true, color: C.green });
}

// P4
{
  const s = addSlide("一个可执行的教学闭环，而非代码生成器", "[R3][R4][R13]", notes[3]);
  addSvg(s, path.join(figures, "system-architecture.svg"), 0.6, 1.3, 8.15, 4.9);
  addCard(s, 9.0, 1.35, 3.75, 1.05, "学生", "理解问题、手写 Spec、判断取舍", { accent: C.indigo, bodySize: 11.5 });
  addCard(s, 9.0, 2.62, 3.75, 1.05, "Agent", "在限定范围内实现或诊断", { accent: C.indigo2, bodySize: 11.5 });
  addCard(s, 9.0, 3.89, 3.75, 1.05, "VOS / Runner", "读取 diff，执行确定性验证", { accent: C.green, bodySize: 11.5 });
  addCard(s, 9.0, 5.16, 3.75, 1.05, "教师", "评审设计理由、演化过程与证据", { accent: C.yellow, bodySize: 11.5 });
  addPill(s, "成功与失败都进入结构化时间线", 3.0, 6.34, 4.5, C.green, C.greenSoft, { fontSize: 11 });
}

// P5
{
  const s = addSlide("Spec 把学生的设计变成可检查输入", "[R3][R5]", notes[4]);
  const labels = [
    ["DesignSpec", "系统方向与约束", C.indigo],
    ["ModuleSpec", "职责、性质与错误", "4D72C8"],
    ["InterfaceSpec", "跨边界语义", "6B7FD7"],
    ["GoalSpec", "可度量扩展目标", C.green],
    ["SpecPatch", "跨模块修改理由", C.yellow],
  ];
  labels.forEach((v, i) => addCard(s, 0.58 + i * 2.48, 1.42, 2.23, 1.2, v[0], v[1], { accent: v[2], titleSize: 13.5, bodySize: 10.5, fill: C.white }));
  addSvg(s, path.join(figures, "spec-model.svg"), 0.65, 3.05, 7.35, 2.95);
  addCard(s, 8.35, 3.05, 4.35, 0.9, "owns", "限定 Agent 可修改的实现范围", { accent: C.red, titleSize: 14, bodySize: 11.5 });
  addCard(s, 8.35, 4.1, 4.35, 0.9, "properties / checks", "把设计性质连接到确定性验证", { accent: C.green, titleSize: 14, bodySize: 11.5 });
  addCard(s, 8.35, 5.15, 4.35, 0.9, "L1 → L2 → L3", "随 Lab 渐进加深，降低一次性规格负担", { accent: C.indigo, titleSize: 14, bodySize: 11.5 });
  addPill(s, "设计仍由学生完成；Spec 只让取舍可见、可查、可验证", 2.45, 6.34, 6.8, C.indigo, C.blueSoft, { fontSize: 11 });
}

// P6
{
  const s = addSlide("模型提交结果，平台决定是否通过", "[R4][R14]", notes[5]);
  addSvg(s, path.join(figures, "agent-transaction.svg"), 0.55, 1.28, 8.1, 5.12);
  addCard(s, 8.95, 1.38, 3.75, 1.05, "1  独立工作区", "失败补丁不污染学生原项目", { accent: C.indigo, bodySize: 11.5 });
  addCard(s, 8.95, 2.68, 3.75, 1.05, "2  真实 Git diff", "模型声明不能代替实际修改", { accent: C.yellow, bodySize: 11.5 });
  addCard(s, 8.95, 3.98, 3.75, 1.05, "3  多层 Runner", "build · public · contract · fuzz · trace", { accent: C.green, bodySize: 11.5 });
  addCard(s, 8.95, 5.28, 3.75, 1.05, "4  原子提交", "全部检查通过后才形成结果提交", { accent: C.navy, bodySize: 11.5 });
  addPill(s, "结构化结果被拒绝后回到同一模型会话修正", 2.32, 6.46, 5.7, C.red, C.redSoft, { fontSize: 10.5 });
}

// P7
{
  const s = addSlide("核心链演示：从学生设计到真实运行", "[R3][R4][R7][R14]", notes[6]);
  const xs = [0.55, 3.72, 6.89, 10.06];
  const cards = [
    ["01  手写 Spec", "lint 检查结构\n不替学生作选择", C.indigo],
    ["02  Agent 实现", "隔离 worktree\n真实 diff 与 owns", C.indigo2],
    ["03  verify / report", "确定性执行\n版本、规格、日志绑定", C.green],
    ["04  QEMU / 实板", "仿真与实体板\n证据严格分层", C.yellow],
  ];
  cards.forEach((v, i) => {
    addCard(s, xs[i], 1.52, 2.72, 2.05, v[0], v[1], { accent: v[2], titleSize: 15, bodySize: 13 });
    if (i < 3) addArrow(s, xs[i] + 2.78, 2.35, 0.28, C.indigo);
  });
  addImage(s, path.join(media, "frames", "p08-kb-citation.png"), 0.55, 4.02, 2.72, 1.53, { border: C.line });
  addImage(s, path.join(media, "frames", "p09-kernel-debug.png"), 3.72, 4.02, 2.72, 1.53, { border: C.line });
  addImage(s, path.join(media, "frames", "p10-qemu-port.png"), 6.89, 4.02, 2.72, 1.53, { border: C.line });
  addImage(s, path.join(media, "frames", "p11-commit-replay.png"), 10.06, 4.02, 2.72, 1.53, { border: C.line });
  addText(s, "每段演示都回答同一个问题：这一步由谁负责，结论由什么证据支持？", 1.4, 5.93, 10.6, 0.42, { fontSize: 16, bold: true, color: C.navy, align: "center" });
}

function mediaSlide(index, title, claim, bullets, file, refs, status, statusColor, statusFill) {
  const s = addSlide(title, refs, notes[index - 1]);
  addText(s, claim, 0.62, 1.28, 12.0, 0.48, { fontSize: 18, bold: true, color: C.navy });
  addCard(s, 0.62, 1.95, 3.72, 3.9, "解决的教学责任问题", "", { accent: statusColor, fill: C.white });
  s.addText(bulletRuns(bullets), { x: 0.92, y: 2.55, w: 3.15, h: 2.55, fontFace: "Microsoft YaHei", fontSize: 13, color: C.ink, breakLine: false, valign: "top", fit: "shrink", margin: 0.02, paraSpaceAfterPt: 10 });
  addPill(s, status, 1.12, 5.28, 2.72, statusColor, statusFill, { fontSize: 10.5 });
  const video = path.join(media, "videos", file + ".mp4");
  const poster = path.join(media, "frames", file + ".png");
  addMedia(s, video, poster, 4.7, 1.95, 8.0, 4.5);
  addText(s, "单击画面播放真实预录片段；PDF 使用同一关键帧", 7.02, 6.53, 3.6, 0.23, { fontSize: 8.5, color: C.muted, align: "center" });
}

mediaSlide(8, "背景知识与 AI 幻觉：让回答回到可核对来源", "citation 提供核对入口，不把模型回答自动升级为事实", ["ask 从课程知识库取材", "回答附结构化 citation", "没有来源必须如实留空", "学生仍负责判断正确性"], "p08-kb-citation", "[R3][R6][R14]", "真实、已验收 Agent 结果", C.green, C.greenSoft);
mediaSlide(9, "定位内核故障：把黑屏还原为证据链", "Debug Agent 只读观测失败 run，不修改源码，也不改写验证状态", ["先绑定真实失败运行", "trace → GDB → QMP", "输出根因候选与下一命令", "诊断结果不能冒充修复"], "p09-kernel-debug", "[R3][R14]", "真实失败 run + 真实诊断", C.green, C.greenSoft);
mediaSlide(10, "自动生成 QEMU：为物理板卡移植提前验证", "QEMU 解决软件与设备语义问题；真实板卡继续验证时钟、引脚和外设", ["事实只来自学生提供的板卡材料", "candidate 必须人工批准并提交", "隔离执行且不改写 vos.yaml", "qemu_only 与实板证据分栏"], "p10-qemu-port", "[R3][R6][R8][R14]", "QEMU + Orange Pi Prime 实板", C.green, C.greenSoft);
mediaSlide(11, "按 commit 精确记录，并在同一版本上复原", "Git 复原受控状态；Portal 复原与该版本相连的证据时间线", ["权威 run 绑定精确 commit", "真实 checkout 验证恢复后的 HEAD", "report / submit 绑定检查与归档", "失败历史不会被最终通过覆盖"], "p11-commit-replay", "[R3][R4][R7][R14]", "xv6 + Glenda Lab 10 已闭合", C.green, C.greenSoft);

// P12
{
  const s = addSlide("指导书不先给答案，先给设计所需的背景", "[R6][R12]", notes[11]);
  addCard(s, 0.62, 1.38, 5.85, 4.6, "Book：为什么会出现这个问题？", "操作系统历史与设计争论\n\n• 从批处理、分时到 Unix\n• 宏内核—微内核争论\n• 进程、资源与文件模型\n• 真实硬件边界\n\n提供背景与取舍，不预设唯一架构。", { accent: C.indigo, titleSize: 18, bodySize: 14, fill: C.blueSoft });
  addCard(s, 6.86, 1.38, 5.85, 4.6, "Lab：怎样把自己的选择做出来？", "任务、预期现象与自检点\n\n• Lab 1 CTF：Linux 与裸机读取同一 flag\n• 逐 Lab 增加 Spec 深度\n• 分层挑战与个性化目标\n• QEMU 与实板独立验收\n\n给出工程抓手，不提供步骤答案。", { accent: C.green, titleSize: 18, bodySize: 14, fill: C.greenSoft });
  addPill(s, "11 组 Book / Lab · 固定输出 22 份学生 PDF", 4.18, 6.32, 4.95, C.indigo, C.white, { line: C.indigo, fontSize: 11 });
}

// P13
{
  const s = addSlide("两个内核、两种架构、两套真实板卡证据", "[R7][R8][R9]", notes[12]);
  addCard(s, 0.58, 1.36, 6.05, 4.94, "xv6 + VisionFive 2", "JH7110 · 4 × SiFive U74\nSPI U-Boot → TFTP kernel / DTB\nSD 文件系统真实读写\n四 hart 完整 usertests\n\nALL TESTS PASSED\nPortal Lab 10：3 / 3", { accent: C.indigo, titleSize: 19, bodySize: 15, fill: C.white });
  addCard(s, 6.78, 1.36, 5.97, 4.94, "Glenda + Orange Pi Prime", "Allwinner H5 · 4 × Cortex-A53\nBROM → SPL → BL31 → U-Boot → Glenda\nGICv2 / timer / MMC / EL0 工作负载\n七项 QEMU trace 独立记录\n\nGLENDA_H5_BOOT_OK\nPortal Lab 10：3 / 3", { accent: C.green, titleSize: 19, bodySize: 15, fill: C.white });
  addPill(s, "实板已闭合", 1.04, 5.77, 1.65, C.green, C.greenSoft);
  addPill(s, "实板已闭合", 7.23, 5.77, 1.65, C.green, C.greenSoft);
  addPill(s, "QEMU = qemu_only", 9.15, 5.77, 2.05, C.indigo, C.blueSoft);
  addText(s, "跨内核、跨架构复用的是方法；QEMU 与实板从不合并成同一种证据。", 2.0, 6.43, 9.2, 0.3, { fontSize: 13.5, bold: true, color: C.navy, align: "center" });
}

// P14
{
  const s = addSlide("15 名学生的试讲，直接改变了课程入口", "[R12]", notes[13]);
  addText(s, "华东师大 2025 级计算机拔尖班 · 15 人 · 两节暑期试讲 · 定性观察", 0.62, 1.2, 12.0, 0.38, { fontSize: 14, color: C.muted });
  const rows = [
    ["初版 Spec 过于复杂", "一次性认知负担过高", "五类文件 + L1–L3 + 按 Lab 渐进填写"],
    ["缺少 OS 背景", "不知道取舍从何而来", "重写 Book / Lab，增加历史、设计比较和自检"],
    ["工程入口缺乏抓手", "工具链与大型项目门槛高", "CTF 热身 + 统一 CLI + doctor + 分步支持"],
  ];
  ["课堂观察", "诊断", "产品改进"].forEach((t, i) => addText(s, t, 0.75 + i * 4.1, 1.82, 3.7, 0.36, { fontSize: 15, bold: true, color: i === 2 ? C.green : C.navy, align: "center" }));
  rows.forEach((r, i) => {
    const y = 2.3 + i * 1.23;
    r.forEach((t, j) => addCard(s, 0.62 + j * 4.1, y, 3.82, 0.95, "", t, { fill: j === 2 ? C.greenSoft : C.white, line: j === 2 ? "B7E2CE" : C.line, shadow: false, bodySize: 12.5, valign: "mid" }));
    addArrow(s, 4.48, y + 0.3, 0.2, C.indigo);
    addArrow(s, 8.58, y + 0.3, 0.2, C.green);
  });
  s.addShape(pptx.ShapeType.roundRect, { x: 1.7, y: 6.24, w: 9.9, h: 0.52, fill: { color: C.yellowSoft }, line: { color: "EFDFA0" } });
  addText(s, "边界：这些观察解释了如何改进课程入口，不构成通过率或学习增益的统计结论。", 1.92, 6.35, 9.45, 0.24, { fontSize: 11.5, color: C.yellow, bold: true, align: "center" });
}

// P15
{
  const s = addSlide("借鉴、增量贡献与 AI 使用披露", "[R1][R10][R11][R15]", notes[14]);
  const cols = [
    ["方法来源", "SYSSPEC / SPECFS\n规格驱动思想", C.indigo],
    ["案例来源", "MIT xv6\nGlenda", "6B7FD7"],
    ["本队增量", "v2 Spec\nAgent / Runner / 证据链\nBook / Lab / Portal\nVF2 与跨架构案例", C.green],
    ["AI 使用", "Codex\nDeepSeek V4 Pro\nChatECNU ecnu-plus\n人工修改 + 真实验证", C.yellow],
  ];
  cols.forEach((v, i) => addCard(s, 0.55 + i * 3.15, 1.48, 2.85, 3.72, v[0], v[1], { accent: v[2], titleSize: 17, bodySize: 14, fill: C.white }));
  addText(s, "本轮真实模型状态", 0.65, 5.56, 2.0, 0.3, { fontSize: 12.5, bold: true, color: C.green });
  addText(s, "P8 使用 ChatECNU ecnu-plus 真实调用：run 202608180059523-c4c48382，结构化结果通过验收并返回 9 条 citation；未使用 fixture。", 2.55, 5.48, 9.75, 0.48, { fontSize: 12, color: C.ink });
  addPill(s, "源码许可证按各仓库保留", 2.0, 6.35, 3.0, C.indigo, C.blueSoft, { fontSize: 10 });
  addPill(s, "答辩材料 CC BY-SA 4.0", 5.23, 6.35, 3.1, C.green, C.greenSoft, { fontSize: 10 });
  addPill(s, "所有生成内容均由人审与 Runner 验收", 8.56, 6.35, 3.45, C.yellow, C.yellowSoft, { fontSize: 10 });
}

// P16
{
  const s = addSlide("下一学年：用 Glenda-Chimera 检验个性化设计", "[R11]", notes[15]);
  addPill(s, "2026–2027 学年正式教学", 0.65, 1.23, 2.8, C.green, C.greenSoft, { fontSize: 11 });
  addCard(s, 0.65, 2.02, 3.2, 3.4, "Rust 微内核", "seL4 风格\n最小可信内核\n能力与隔离边界", { accent: C.indigo, titleSize: 18, bodySize: 15, fill: C.white });
  addCard(s, 5.06, 2.02, 3.2, 3.4, "稳定 RPC / IPC", "接口、错误、资源语义\n由 Spec 固定\n由跨边界测试验证", { accent: C.green, titleSize: 18, bodySize: 15, fill: C.greenSoft });
  addCard(s, 9.47, 2.02, 3.2, 3.4, "Go 系统服务", "RPC 风格\n同一服务代码\n可在内核态 / 用户态切换", { accent: C.yellow, titleSize: 18, bodySize: 15, fill: C.white });
  addArrow(s, 4.03, 3.48, 0.78, C.indigo);
  addArrow(s, 8.45, 3.48, 0.78, C.green);
  addText(s, "验证平台能否承载：跨语言 · 微内核 · 真正个性化的学生设计", 1.75, 5.9, 9.8, 0.48, { fontSize: 18, bold: true, color: C.navy, align: "center" });
  addPill(s, "未来案例：不宣称系统已经完成", 4.32, 6.46, 4.7, C.yellow, C.yellowSoft, { fontSize: 10.5 });
}

// P17
{
  const s = addSlide("重新定义 OS 实验的评价对象", "[R2][R3][R4]", notes[16]);
  addCard(s, 0.72, 1.55, 3.65, 2.5, "学生", "设计自己的 OS\n解释目标、边界与取舍", { accent: C.indigo, titleSize: 20, bodySize: 17, fill: C.blueSoft });
  addCard(s, 4.83, 1.55, 3.65, 2.5, "Agent", "在 Spec 与验证约束下\n参与真实工程", { accent: C.green, titleSize: 20, bodySize: 17, fill: C.greenSoft });
  addCard(s, 8.94, 1.55, 3.65, 2.5, "教师", "依据设计、演化与证据\n进行评审", { accent: C.yellow, titleSize: 20, bodySize: 17, fill: C.yellowSoft });
  addText(s, "我们不是减少学生思考", 1.05, 4.85, 5.2, 0.55, { fontSize: 24, color: C.muted, bold: true, align: "center" });
  addText(s, "而是把思考从重复编码提升到系统设计", 4.45, 5.54, 7.65, 0.62, { fontSize: 27, color: C.indigo, bold: true, align: "center" });
  addText(s, "谢谢各位老师", 4.95, 6.4, 3.45, 0.34, { fontSize: 15, color: C.navy, bold: true, align: "center" });
}

// Appendix helpers
function appendix(title, refs = "") {
  const s = addSlide(title, refs);
  addPill(s, "答辩附录", 10.95, 0.39, 1.55, C.indigo, C.blueSoft, { fontSize: 9 });
  return s;
}

// A1
{
  const s = appendix("A1  四类实验方式的完整比较", "[R3][R4][R10]");
  const cols = [0.6, 3.18, 5.76, 8.34, 10.92];
  const widths = [2.38, 2.38, 2.38, 2.38, 1.81];
  ["比较维度", "传统 OS 实验", "rCore 等现代课程", "裸 Coding Agent", "VeriSpecOSLab"].forEach((t, i) => addCard(s, cols[i], 1.28, widths[i], 0.63, "", t, { fill: i === 4 ? C.blueSoft : C.gray, line: C.line, shadow: false, bodySize: 10.5, valign: "mid" }));
  const rows = [
    ["学生设计空间", "低", "中", "看似高、难约束", "由 Spec 显式表达"],
    ["Agent 边界", "无", "无或外部", "Prompt 约束", "owns + worktree + diff"],
    ["验证责任", "测试脚本", "测试 + 工具链", "模型自报风险", "真实 Runner"],
    ["教师评价", "实现与结果", "实现与解释", "难复查过程", "设计 + 演化 + 证据"],
    ["硬件证据", "课程自定", "课程自定", "常被仿真替代", "QEMU / 实板分层"],
  ];
  rows.forEach((r, ri) => r.forEach((t, ci) => addCard(s, cols[ci], 2.03 + ri * 0.86, widths[ci], 0.7, "", t, { fill: ci === 4 ? "F4F7FF" : C.white, line: C.line, shadow: false, bodySize: 10.5, valign: "mid" })));
  addText(s, "目标不是否定成熟课程，而是把 AI 时代必须显式训练的设计与证据能力补进主链。", 1.2, 6.53, 10.9, 0.28, { fontSize: 12.5, bold: true, color: C.navy, align: "center" });
}

// A2
{
  const s = appendix("A2  Lab 1–10 与 Book / Lab 双线", "[R6][R12]");
  addSvg(s, path.join(figures, "course-history.svg"), 0.6, 1.28, 12.1, 2.55);
  const labs = ["CTF / 工具", "启动", "内存", "中断", "用户态", "文件系统", "资源 ABI", "个性化目标", "硬件移植", "验证闭合"];
  labs.forEach((t, i) => {
    const x = 0.6 + i * 1.22;
    s.addShape(pptx.ShapeType.ellipse, { x: x + 0.31, y: 4.17, w: 0.48, h: 0.48, fill: { color: i < 8 ? C.indigo : C.green }, line: { color: C.white, width: 1 } });
    addText(s, String(i + 1), x + 0.31, 4.24, 0.48, 0.25, { fontFace: "Aptos", fontSize: 10, bold: true, color: C.white, align: "center" });
    addText(s, t, x, 4.8, 1.1, 0.62, { fontSize: 9.5, color: C.ink, align: "center", valign: "top" });
  });
  addCard(s, 1.0, 5.75, 5.25, 0.72, "Book", "历史、争论、背景知识与设计取舍", { accent: C.indigo, bodySize: 11 });
  addCard(s, 7.07, 5.75, 5.25, 0.72, "Lab", "任务、现象、自检、分层挑战与硬件报告", { accent: C.green, bodySize: 11 });
}

// A3
{
  const s = appendix("A3  五类 Spec、L1–L3 与 SpecPatch", "[R5]");
  addSvg(s, path.join(figures, "spec-model.svg"), 0.55, 1.27, 6.4, 5.35);
  addCard(s, 7.25, 1.35, 5.45, 1.12, "L1：方向", "系统目标、模块身份、最小边界", { accent: C.indigo, bodySize: 12 });
  addCard(s, 7.25, 2.65, 5.45, 1.12, "L2：契约", "properties、errors、InterfaceSpec、稳定 target ID", { accent: C.indigo2, bodySize: 12 });
  addCard(s, 7.25, 3.95, 5.45, 1.12, "L3：验证", "checks、GoalSpec、证据与跨架构目标", { accent: C.green, bodySize: 12 });
  addCard(s, 7.25, 5.25, 5.45, 1.12, "SpecPatch：受控跨模块修改", "学生手写并提交；每个受影响模块的授权只消费一次", { accent: C.yellow, bodySize: 11.5 });
}

// A4
{
  const s = appendix("A4  Agent 事务、角色与安全边界", "[R4][R14]");
  addSvg(s, path.join(figures, "agent-transaction.svg"), 0.55, 1.25, 7.25, 5.35);
  const roles = [
    ["ask", "知识问答 + citation", C.indigo],
    ["review", "只读评审 Spec", C.indigo2],
    ["implement", "隔离实现事务", C.green],
    ["debug", "只读定位失败", C.yellow],
    ["verify", "验证计划与结果解释", C.navy],
  ];
  roles.forEach((r, i) => addCard(s, 8.08, 1.28 + i * 0.91, 4.55, 0.7, r[0], r[1], { accent: r[2], titleSize: 12.5, bodySize: 10.5, shadow: false }));
  addCard(s, 8.08, 5.98, 4.55, 0.6, "边界", "worktree 不是进程、网络或主机文件系统沙箱", { accent: C.red, titleSize: 11, bodySize: 9.5, fill: C.redSoft, shadow: false });
}

// A5
{
  const s = appendix("A5  证据分层与闭合规则", "[R3][R7][R8][R14]");
  addSvg(s, path.join(figures, "evidence-chain.svg"), 0.6, 1.26, 7.15, 5.35);
  const levels = [
    ["public / contract", "公开正确性与契约", C.indigo],
    ["fuzz / trace", "固定种子与可观察路径", C.indigo2],
    ["hidden", "教师私有门槛", C.yellow],
    ["QEMU", "软件与设备语义", "4D72C8"],
    ["connected", "Portal 权威运行", C.green],
    ["physical board", "真实时钟、外设和工作负载", C.green],
    ["human review", "设计、材料与证据复核", C.navy],
  ];
  levels.forEach((v, i) => addCard(s, 8.05, 1.23 + i * 0.75, 4.65, 0.58, v[0], v[1], { accent: v[2], titleSize: 11.5, bodySize: 9.5, shadow: false }));
  addText(s, "下层证据不能冒充上层门禁；QEMU 尤其不能替代实体板。", 8.12, 6.6, 4.5, 0.24, { fontSize: 10.5, color: C.red, bold: true, align: "center" });
}

// A6
{
  const s = appendix("A6  VisionFive 2 四核完整证据", "[R7][R9]");
  addCard(s, 0.58, 1.3, 4.0, 4.95, "启动与加载链", "StarFive JH7110\n4 × SiFive U74\n\nSPI U-Boot 2021.10\nTFTP legacy uImage + DTB\nSD 卡 xv6fs\n\n硬件报告 + 串口日志 + 教师复核", { accent: C.indigo, titleSize: 18, bodySize: 14 });
  addCard(s, 4.85, 1.3, 7.9, 4.95, "串口关键标记", "XV6_BOOT_OK\nhart 1 starting\nhart 2 starting\nhart 3 starting\nsd: write test ok\nusertests starting\nALL TESTS PASSED", { accent: C.green, titleSize: 18, bodySize: 18, fill: "F8FAFC", fontFace: "Cascadia Mono" });
  addPill(s, "run-37f300b0… · commit 138cf784d878 · 3 / 3", 3.12, 6.38, 7.1, C.green, C.greenSoft, { fontSize: 11 });
}

// A7
{
  const s = appendix("A7  Glenda H5：QEMU、Orange Pi Prime 与 Chimera", "[R7][R8][R11]");
  addCard(s, 0.55, 1.25, 3.75, 4.95, "H5 QEMU", "7 项 trace\n固件链 / MMU / UART\ntimer / SMP+IPI / MMC\nLab 1–8 回归\n\n状态：qemu_only", { accent: C.indigo, titleSize: 17, bodySize: 14, fill: C.blueSoft });
  addCard(s, 4.79, 1.25, 3.75, 4.95, "Orange Pi Prime", "BROM / SPL / BL31 / U-Boot\n4 × Cortex-A53\nGICv2 / timer / MMC / EL0\n完整工作负载\n\n状态：实板已闭合", { accent: C.green, titleSize: 17, bodySize: 14, fill: C.greenSoft });
  addCard(s, 9.03, 1.25, 3.75, 4.95, "Glenda-Chimera", "Rust 微内核\nGo RPC 服务\n稳定 IPC 边界\n内核态 / 用户态切换\n\n状态：未来验证案例", { accent: C.yellow, titleSize: 17, bodySize: 14, fill: C.yellowSoft });
  addArrow(s, 4.36, 3.52, 0.32, C.indigo);
  addArrow(s, 8.6, 3.52, 0.32, C.green);
  addPill(s, "run-afdb05b4… · commit aca80468e510 · 3 / 3", 3.18, 6.43, 7.0, C.green, C.greenSoft, { fontSize: 11 });
}

// A8
{
  const s = appendix("A8  来源、许可证与复现坐标", "[R1]–[R15]");
  addCard(s, 0.58, 1.25, 5.95, 4.85, "主要来源", "1. Liu et al. Sharpen the Spec, Cut the Code, FAST '26.\n2. Cox, Kaashoek, Morris. xv6: a simple, Unix-like teaching OS.\n3. MIT PDOS xv6-riscv repository.\n4. seL4 Reference Manual and verification literature.\n5. Git worktree documentation.\n6. QEMU System Emulation User's Guide.\n7. RISC-V Privileged Architecture.\n8. 2026 操作系统设计赛全国赛技术方案。", { accent: C.indigo, titleSize: 17, bodySize: 11.5, fill: C.white });
  addCard(s, 6.8, 1.25, 5.95, 2.1, "复现坐标", "主分支：codex/final-defense-portal-closure\nPPT 生成脚本：docs/comp/final-defense-ppt/build.cjs\n演示采集：docs/comp/final-defense-media/capture/\n视频：4 × H.264 · 1600×900 · 30 fps", { accent: C.green, titleSize: 17, bodySize: 11.5, fill: C.greenSoft });
  addCard(s, 6.8, 3.63, 5.95, 2.47, "许可与披露", "第三方源码与文档保留各自许可证。\n答辩 PPT、PDF 与演示素材：CC BY-SA 4.0。\nAI 工具、模型、生成范围、人工修改与验证方式在 P15 独立披露。\nP8 保留真实运行 ID、结构化验收与 citation 数量。", { accent: C.yellow, titleSize: 17, bodySize: 11.5, fill: C.yellowSoft });
  addPill(s, "所有素材均去除凭据、本机绝对路径和私人服务地址", 3.37, 6.4, 6.6, C.red, C.redSoft, { fontSize: 10.5 });
}

fs.mkdirSync(outDir, { recursive: true });
async function main() {
  fs.writeFileSync(imageLayoutReport, `${JSON.stringify({
    version: "final-defense-image-layout.v1",
    policy: "Images preserve their source aspect ratio. Diagrams use contain; cover is allowed only when explicitly requested.",
    assets: imageLayouts,
  }, null, 2)}\n`, "utf8");
  await pptx.writeFile({ fileName: outFile });
  console.log(path.relative(repo, outFile));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
