export function isProviderFailure(value: unknown, message: string): boolean {
  const serialized = `${message}\n${JSON.stringify(value ?? {})}`;
  const providerFailure =
    /(?:chat request|provider|model).{0,120}(?:failed|error|unavailable)/is.test(
      serialized,
    );
  const transientFailure =
    /(?:\b5\d{2}\b|internal server error|temporarily unavailable|timeout|timed out)/i.test(
      serialized,
    );
  const credentialRejected =
    /(?:\b401\b|invalid (?:api )?(?:key|token)|unauthorized|无效的令牌)/i.test(
      serialized,
    );
  const missingConfiguredCredential =
    /configured\s+\S+\s+provider credential\s+\S+\s+is missing/i.test(
      serialized,
    );
  return (
    (providerFailure && (transientFailure || credentialRejected)) ||
    missingConfiguredCredential
  );
}
