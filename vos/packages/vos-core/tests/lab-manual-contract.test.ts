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
  "lab6-filesystem.md": ["kernel/virtio", "kernel/fs"],
  "lab7-resource-abi.md": ["kernel/pipe"],
};

describe("Lab 1-10 manual command contract", () => {
  test("preserves the Lab 1 CTF warm-up and uses the interactive design interview", () => {
    const lab = readLab("lab1-seed.md");
    expect(lab).toContain("# Lab 1：CTF 热身与项目初始化");
    expect(lab).toContain("## 1. CTF 双环境热身");
    expect(lab).toContain("Linux flag reader、裸机 flag reader");
    expect(lab).toContain("vos agent design --interactive");
    expect(lab).toContain("vos agent design --confirm");
  });

  test("binds Lab 2-7 agent commands to the cumulative course ModuleSpec IDs", () => {
    for (const [file, expected] of Object.entries(expectedModuleCommands)) {
      const commands = moduleTargets(readLab(file));
      expect(new Set(commands)).toEqual(new Set(expected));
      expect(commands.every((target) => target.includes("/"))).toBe(true);
    }
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
});

function readLab(file: string): string {
  return readFileSync(join(labRoot, file), "utf8");
}

function moduleTargets(markdown: string): string[] {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(/^vos agent (?:spec|implement|review) (\S+)/gm)) {
    const target = match[1];
    if (target && target !== "<module>") targets.add(target);
  }
  return [...targets];
}
