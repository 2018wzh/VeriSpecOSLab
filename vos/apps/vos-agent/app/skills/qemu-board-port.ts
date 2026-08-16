import type { BuiltInSkill } from "./types.ts";

export const qemuBoardPortSkill: BuiltInSkill = {
  name: "qemu-board-port",
  promptText: [
    "## Built-in skill: qemu-board-port",
    "Treat a physical-board QEMU port as an evidence-gated machine and SoC modeling task.",
    "Before implementation, inventory and hash supplied material, reconstruct the real boot chain, and classify each required block as direct reuse, integration reuse, compatible variant, new model, or explicitly unsupported.",
    "A matching device name, address, or DT compatible is only a candidate: compare reset state, register behavior, IRQ/DMA/clock wiring, guest-visible IDs, and the actual firmware path.",
    "Hardware claims may use only the supplied manuals, schematic, board material, firmware, image, and DTB. Record conflicts instead of silently selecting a revision. Online access may pin official software dependencies but must not repair missing hardware evidence.",
    "Use bounded black-box runs and bounded logs. Protect original images and place expanded images, firmware, builds, and traces in ignored output locations with hashes.",
    "Implement in the smallest-change order: reuse, board integration, compatible variant, then focused new model. Do not invent ready bits or swallow accesses to escape firmware polling.",
    "For the approved minimal firmware route, list every bypass such as skipped BootROM/SPL or preloaded kernel assets. Keep neighboring QEMU machines unchanged and never push.",
  ].join("\n"),
};
