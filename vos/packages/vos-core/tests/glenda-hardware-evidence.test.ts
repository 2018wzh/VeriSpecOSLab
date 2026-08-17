import { describe, expect, test } from "bun:test";
import { validateGlendaOrangePiPrimeEvidenceText } from "../src/main.ts";

const complete = [
  "H5_DTB_OK cores=4 memory_mib=2048",
  "H5_CORE_ONLINE mpidr=0",
  "H5_CORE_ONLINE mpidr=1",
  "H5_CORE_ONLINE mpidr=2",
  "H5_CORE_ONLINE mpidr=3",
  "H5_SMP_OK cores=4 mask=0x0f",
  "H5_IPI_OK mask=0x0f",
  "H5_TIMER_IRQ_OK ticks=10 frequency=24000000",
  "H5_MMC_FS_OK",
  "H5_MMC_DATA_OK",
  "H5_USERMODE_ENTER_OK",
  "H5_USER_FD_PIPE_SHELL_OK resources=0",
  "H5_LAB1_8_WORKLOAD_OK phases=10 mode=el0",
  "GLENDA_H5_BOOT_OK",
].join("\n");

describe("Orange Pi Prime physical evidence", () => {
  test("accepts the complete four-core workload marker set", () => {
    expect(() => validateGlendaOrangePiPrimeEvidenceText(complete)).not.toThrow();
  });

  test("rejects a boot-only transcript", () => {
    expect(() =>
      validateGlendaOrangePiPrimeEvidenceText("GLENDA_H5_BOOT_OK\n"),
    ).toThrow("Orange Pi Prime physical evidence is incomplete");
  });
});
