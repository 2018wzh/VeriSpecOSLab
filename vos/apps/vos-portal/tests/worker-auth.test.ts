import { expect, test } from "bun:test";
import { authenticateWorkerRequest, workerControlToken } from "../server/worker-auth.ts";

test("worker control credentials are scoped to worker identity and rotate daily", () => {
  const previous = process.env.VOS_PORTAL_MASTER_KEY;
  process.env.VOS_PORTAL_MASTER_KEY = "worker-control-test-master-key-with-at-least-32-characters";
  const now = new Date("2026-07-29T12:00:00.000Z");
  try {
    const workerId = "worker-1";
    const token = workerControlToken(workerId, now);
    const request = new Request("http://portal.test/api/v1/internal/worker/lease", { headers: { authorization: `Bearer ${token}`, "x-vos-worker-id": workerId } });
    expect(authenticateWorkerRequest(request, now)).toBe(workerId);
    expect(authenticateWorkerRequest(new Request(request.url, { headers: { authorization: `Bearer ${token}`, "x-vos-worker-id": "worker-2" } }), now)).toBeUndefined();
    const previousDay = workerControlToken(workerId, new Date(now.getTime() - 86_400_000));
    expect(authenticateWorkerRequest(new Request(request.url, { headers: { authorization: `Bearer ${previousDay}`, "x-vos-worker-id": workerId } }), now)).toBe(workerId);
    expect(() => workerControlToken("invalid worker id", now)).toThrow("worker ID");
  } finally {
    if (previous === undefined) delete process.env.VOS_PORTAL_MASTER_KEY;
    else process.env.VOS_PORTAL_MASTER_KEY = previous;
  }
});
