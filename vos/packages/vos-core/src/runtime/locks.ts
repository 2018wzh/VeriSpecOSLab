import type { EvidenceWriter } from "../evidence/index.ts";

const queues = new Map<string, Promise<void>>();

export async function withResourceLock<T>(
  evidence: EvidenceWriter,
  lockId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(lockId) ?? Promise.resolve();
  const hadPrevious = queues.has(lockId);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  queues.set(lockId, tail);
  if (hadPrevious) {
    await evidence.appendEvent({
      type: "progress",
      visibility: "public",
      payload: { lock: lockId, status: "waiting" },
    });
  }
  await previous;
  await evidence.appendEvent({
    type: "progress",
    visibility: "public",
    payload: { lock: lockId, status: "acquired" },
  });
  try {
    return await fn();
  } finally {
    await evidence.appendEvent({
      type: "progress",
      visibility: "public",
      payload: { lock: lockId, status: "released" },
    });
    release();
    if (queues.get(lockId) === tail) {
      queues.delete(lockId);
    }
  }
}
