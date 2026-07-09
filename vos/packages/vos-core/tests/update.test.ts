import { describe, expect, test } from "bun:test";
import { normalizePublishedVersion } from "../src/update.ts";

describe("self-update release metadata", () => {
  test("normalizes stable, nightly, and semver tag names", () => {
    expect(normalizePublishedVersion("v1.0.0")).toBe("0.1.0");
    expect(normalizePublishedVersion("stable-abc123")).toBe("abc123");
    expect(normalizePublishedVersion("nightly-abc123")).toBe("abc123");
    expect(normalizePublishedVersion("vos-0.1.0")).toBe("0.1.0");
  });
});
