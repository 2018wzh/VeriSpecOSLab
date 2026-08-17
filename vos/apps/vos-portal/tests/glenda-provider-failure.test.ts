import { expect, test } from "bun:test";
import { isProviderFailure } from "../scripts/provider-failure.ts";

test("classifies an explicitly rejected configured provider credential", () => {
  expect(
    isProviderFailure(
      { status: "failed" },
      'OpenAI-compatible chat request failed for model "ecnu-max": 401 无效的令牌',
    ),
  ).toBe(true);
});

test("does not classify an ordinary deterministic verification failure", () => {
  expect(
    isProviderFailure(
      { status: "validation_failed" },
      "public check scheduler-fairness-public failed",
    ),
  ).toBe(false);
});
