import { describe, expect, test } from "bun:test";
import { mergeContainerEnvironment } from "../worker/docker-runner.ts";

describe("runner container environment", () => {
  test("preserves image toolchain defaults and applies runtime overrides", () => {
    expect(
      mergeContainerEnvironment(
        ["RUSTUP_TOOLCHAIN=nightly", "CARGO_NET_OFFLINE=true", "HOME=/image-home"],
        ["HOME=/tmp/runner-home", "VOS_RUNNER_PORT=8788"],
      ),
    ).toEqual([
      "RUSTUP_TOOLCHAIN=nightly",
      "CARGO_NET_OFFLINE=true",
      "HOME=/tmp/runner-home",
      "VOS_RUNNER_PORT=8788",
    ]);
  });

  test("rejects malformed image environment entries", () => {
    expect(() => mergeContainerEnvironment(["BROKEN"], [])).toThrow(
      "runner environment contains an invalid entry",
    );
  });
});
