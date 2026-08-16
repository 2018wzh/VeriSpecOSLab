import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "../../../..");
const labRoot = join(repositoryRoot, "docs", "manual", "labs");

const expectedModuleCommands: Record<string, string[]> = {
  "lab2-boot.md": ["kernel/boot"],
  "lab3-memory.md": ["kernel/memory"],
  "lab4-interrupts.md": ["kernel/trap"],
  "lab5-user-space.md": ["kernel/trap", "kernel/process", "kernel/syscall"],
  "lab6-filesystem.md": ["kernel/virtio", "kernel/bio", "kernel/log", "kernel/inode", "kernel/file"],
  "lab7-resource-abi.md": ["kernel/pipe"],
};

const expectedModulePaths: Record<string, string[]> = {
  "lab2-boot.md": ["spec/modules/kernel/boot.yaml"],
  "lab3-memory.md": ["spec/modules/kernel/memory.yaml"],
  "lab4-interrupts.md": ["spec/modules/kernel/trap.yaml"],
  "lab7-resource-abi.md": ["spec/modules/kernel/pipe.yaml"],
};

describe("Lab 1-10 manual command contract", () => {
  test("preserves the Lab 1 CTF warm-up and teaches handwritten Spec review", () => {
    const lab = readLab("lab1-seed.md");
    expect(lab).toContain("# Lab 1：CTF 热身与项目初始化");
    expect(lab).toContain("## 1. CTF 双环境热身");
    expect(lab).toContain("Linux flag reader、裸机 flag reader");
    expect(lab).toContain("### 1.1 Linux 路径");
    expect(lab).toContain("### 1.2 QEMU 裸机路径");
    expect(lab).toContain("### 1.4 真实板卡连接");
    expect(lab).toContain("vos agent ask -i");
    expect(lab).toContain("vos spec lint design");
    expect(lab).toContain("vos agent review design");
    expect(lab).toContain("git commit -m \"[spec][design]");
    expect(lab).toContain("仓库之外");
    expect(lab).toContain("真实板卡");
    expect(lab).toContain("canonical board");
    expect(lab).toContain("手工提交");
    expect(lab).toContain("usbipd bind --busid <BUSID>");
    expect(lab).toContain("usbipd attach --wsl --busid <BUSID>");
    expect(lab).toContain("usbipd detach --busid <BUSID>");
    expect(lab).not.toContain("vos agent implement lab/ctf-warmup");
  });

  test("keeps HAL and portability prompts in every published Book/Lab source", () => {
    const publishedFiles = [
      "book/ch01-overview-design.md", "book/ch02-boot.md", "book/ch03-memory.md",
      "book/ch04-interrupts.md", "book/ch05-user-space.md", "book/ch06-filesystem.md",
      "book/ch07-resource-abi.md", "book/ch08-personal-goal.md", "book/ch09-hardware-port.md",
      "book/ch10-verification.md", "book/ch11-comprehensive-assessment.md",
      "labs/lab1-seed.md", "labs/lab2-boot.md", "labs/lab3-memory.md", "labs/lab4-interrupts.md",
      "labs/lab5-user-space.md", "labs/lab6-filesystem.md", "labs/lab7-resource-abi.md",
      "labs/lab8-personal-goal.md", "labs/lab9-hardware-port.md", "labs/lab10-verification.md",
      "labs/final-lab.md",
    ];
    for (const file of publishedFiles) {
      const content = readFileSync(join(repositoryRoot, "docs", "manual", file), "utf8");
      expect(content).toContain("HAL");
      expect(content).not.toMatch(/appendices\/|另见附录/);
    }
  });

  test("binds Lab 2-7 agent commands to the cumulative course ModuleSpec IDs", () => {
    for (const [file, expected] of Object.entries(expectedModuleCommands)) {
      const commands = moduleTargets(readLab(file));
      expect(new Set(commands)).toEqual(new Set(expected));
      expect(commands.every((target) => target.includes("/"))).toBe(true);
    }
  });

  test("uses the same nested ModuleSpec paths as the replayed course history", () => {
    for (const [file, expected] of Object.entries(expectedModulePaths)) {
      const lab = readLab(file);
      for (const path of expected) expect(lab).toContain(path);
      expect(lab).not.toMatch(/spec\/modules\/(?:boot|memory|vm|trap|pipe)\.yaml/);
    }
    expect(readLab("lab3-memory.md")).not.toContain("kernel/vm");
  });

  test("keeps Book and command examples on the same current ModuleSpec paths", () => {
    const cases: Array<[string, string[], RegExp]> = [
      [join(repositoryRoot, "docs", "manual", "book", "ch02-boot.md"), ["spec/modules/kernel/boot.yaml"], /spec\/modules\/boot\.yaml/],
      [join(repositoryRoot, "docs", "manual", "book", "ch03-memory.md"), ["spec/modules/kernel/memory.yaml"], /spec\/modules\/(?:memory|vm)\.yaml/],
      [join(repositoryRoot, "docs", "manual", "book", "ch05-user-space.md"), ["spec/modules/kernel/trap.yaml", "spec/modules/kernel/process.yaml", "spec/modules/kernel/syscall.yaml"], /spec\/modules\/(?:trap|process|syscall|exec)\.yaml/],
      [join(repositoryRoot, "docs", "manual", "book", "ch10-verification.md"), ["Spec"], /spec\/modules\/memory\.yaml/],
    ];
    for (const [path, expected, retired] of cases) {
      const content = readFileSync(path, "utf8");
      for (const current of expected) expect(content).toContain(current);
      expect(content).not.toMatch(retired);
    }
  });

  test("keeps later labs on executable public commands and explicit acceptance boundaries", () => {
    const lab8 = readLab("lab8-personal-goal.md");
    expect(lab8).toContain("vos agent implement <module>");
    expect(lab8).toContain("vos verify");
    const lab9 = readLab("lab9-hardware-port.md");
    expect(lab9).toContain("Coding Agent");
    expect(lab9).toContain("不再是课程流程门禁");
    expect(lab9).not.toContain("vos agent implement <module>");
    expect(lab9).toContain("pending_human_review");
    const lab10 = readLab("lab10-verification.md");
    expect(lab10).toContain("Coding Agent");
    expect(lab10).toContain("vos verify");
    expect(lab10).toContain("vos report");
    expect(lab10).toContain("vos submit");
    const finalLab = readLab("final-lab.md");
    expect(finalLab).toContain("Codex、Claude Code、Gemini CLI、Copilot");
    expect(finalLab).toContain("VOS 命令仍可作为工程化助手");
  });

  test("uses the handwritten Spec loop through Lab 8 and rejects generative Spec commands", () => {
    for (const file of [
      "lab2-boot.md", "lab3-memory.md", "lab4-interrupts.md", "lab5-user-space.md",
      "lab6-filesystem.md", "lab7-resource-abi.md", "lab8-personal-goal.md",
    ]) {
      const lab = readLab(file);
      expect(lab).toContain("vos agent ask");
      expect(lab).toContain("vos spec lint");
      expect(lab).toContain("vos agent review");
      expect(lab).toContain("git commit -m");
      expect(lab).toContain("vos agent implement");
      expect(lab).toContain("vos build");
      expect(lab).toContain("vos run qemu");
      expect(lab).toContain("vos verify");
      expect(lab).not.toContain("vos agent design");
      expect(lab).not.toContain("vos agent spec");
      expect(lab).not.toContain("vos spec check");
    }
  });

  test("documents the Lab 9 transition without making the VOS chain a gate", () => {
    for (const file of ["lab9-hardware-port.md", "lab10-verification.md", "final-lab.md"]) {
      const content = readLab(file);
      expect(content).toMatch(/Coding Agent|Codex/);
      expect(content).not.toContain("vos agent implement <module>");
    }
  });

  test("keeps QEMU, U-Boot, and real peripheral evidence as separate hardware-port contracts", () => {
    const book = readBook("ch09-hardware-port.md");
    const lab = readLab("lab9-hardware-port.md");
    expect(book).toContain("QEMU 与真实板卡的差异矩阵");
    expect(book).toContain("U-Boot 移植与固件交接");
    expect(book).toContain("SDIO/SD host");
    expect(book).toContain("SPI：先验证时序");
    expect(book).toContain("不能只引用 U-Boot 的 `mmc`/`fatload`");
    expect(lab).toContain("QEMU 对照基线");
    expect(lab).toContain("2.1 U-Boot 交接与板级移植");
    expect(lab).toContain("2.2 真实外设 bring-up 顺序");
    expect(lab).toContain("bootloader_only");
    expect(lab).toContain("SDIO/SD host 最小验收");
    expect(lab).toContain("SPI 控制器与从设备最小验收");
    expect(readBook("ch02-boot.md")).toContain("U-Boot 路径：加载成功不等于内核硬件已就绪");
    expect(readBook("ch06-filesystem.md")).toContain("真实板卡的 SDIO/SPI 存储 bring-up");
    expect(readLab("lab6-filesystem.md")).toContain("步骤 2a：把 QEMU virtio-blk 换成真实 SDIO/SPI");
  });

  test("documents the VOS QEMU board-port workflow without weakening the hardware boundary", () => {
    const overview = readBook("ch01-overview-design.md");
    const boot = readBook("ch02-boot.md");
    const book = readBook("ch09-hardware-port.md");
    const lab1 = readLab("lab1-seed.md");
    const lab2 = readLab("lab2-boot.md");
    const lab9 = readLab("lab9-hardware-port.md");
    const lab10 = readLab("lab10-verification.md");
    expect(overview).toContain("vos agent qemu preflight");
    expect(overview).toContain("candidate 是唯一允许 Agent 生成的 Spec 例外");
    expect(overview).toContain("不会自动替你改好内核的 `vos.yaml`");
    expect(overview).toContain("--resume <run-id>");
    expect(boot).toContain("两种 QEMU 能力不要混用");
    expect(boot).toContain("success_pattern");
    expect(boot).toContain("`vos agent qemu preflight/execute`");
    expect(book).toContain("VOS 的 QEMU 板级移植工作流");
    expect(book).toContain("references/qemu/<request-id>/");
    expect(book).toContain("直接复用、集成复用、兼容变体、新模型或明确不支持");
    expect(book).toContain("执行不 push");
    expect(lab1).toContain("spec/qemu/<request-id>.yaml");
    expect(lab1).toContain("只做“准备请求和材料”两件事");
    expect(lab1).toContain("不运行 `preflight` 或 `execute`");
    expect(lab2).toContain("`runners.qemu`");
    expect(lab2).toContain("必须有 `-nographic`");
    expect(lab9).toContain("VOS QEMU 板级移植");
    expect(lab9).toContain("candidate_created: false");
    expect(lab9).toContain("status: approved");
    expect(lab9).toContain("--resume <run-id>");
    expect(lab9).toContain("不拥有 `spec/`、`vos.yaml`、`.vos/`");
    expect(lab10).toContain("QEMU 板级移植");
    expect(lab10).toContain("qemu_only");
    expect(lab10).toContain("材料不足时预检应保持 `candidate_created: false`");
  });
});

function readLab(file: string): string {
  return readFileSync(join(labRoot, file), "utf8");
}

function readBook(file: string): string {
  return readFileSync(join(repositoryRoot, "docs", "manual", "book", file), "utf8");
}

function moduleTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(/^vos agent (?:implement|review) (\S+)/gm)) {
    const target = match[1];
    if (target && target !== "<module>") targets.add(target);
  }
  return [...targets];
}
