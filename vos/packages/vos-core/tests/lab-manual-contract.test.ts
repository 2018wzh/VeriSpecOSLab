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
    expect(lab).toContain("vos agent ask -i");
    expect(lab).toContain("vos spec lint design");
    expect(lab).toContain("vos agent review design");
    expect(lab).toContain("git commit -m \"[spec][design]");
    expect(lab).toContain("vos agent implement lab/ctf-warmup");
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

  test("keeps later labs on executable public commands and explicit acceptance boundaries", () => {
    const lab8 = readLab("lab8-personal-goal.md");
    expect(lab8).toContain("vos agent implement <module>");
    expect(lab8).toContain("vos verify");
    const lab9 = readLab("lab9-hardware-port.md");
    expect(lab9).toContain("vos run qemu");
    expect(lab9).toContain("vos run hardware");
    expect(lab9).toContain("pending_human_review");
    const lab10 = readLab("lab10-verification.md");
    expect(lab10).toContain("vos verify");
    expect(lab10).toContain("vos report");
    expect(lab10).toContain("vos submit");
  });

  test("uses the handwritten Spec loop in every Lab and rejects generative Spec commands", () => {
    for (const file of [
      "lab1-seed.md", "lab2-boot.md", "lab3-memory.md", "lab4-interrupts.md", "lab5-user-space.md",
      "lab6-filesystem.md", "lab7-resource-abi.md", "lab8-personal-goal.md", "lab9-hardware-port.md", "lab10-verification.md",
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
});

function readLab(file: string): string {
  return readFileSync(join(labRoot, file), "utf8");
}

function moduleTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(/^vos agent (?:implement|review) (\S+)/gm)) {
    const target = match[1];
    if (target && target !== "<module>") targets.add(target);
  }
  return [...targets];
}
