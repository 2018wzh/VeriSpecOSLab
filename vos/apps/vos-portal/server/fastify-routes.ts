import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";

export type PortalRequestHandler = (request: Request) => Promise<Response>;

export const portalRoutes: FastifyPluginAsync<{ handle: PortalRequestHandler }> = async (app, options) => {
  const route = async (request: FastifyRequest, reply: FastifyReply) => bridge(request, reply, options.handle);
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, route);
  app.all("/api/v1/*", route);
};

export async function registerPortalRoutes(app: FastifyInstance, handle: PortalRequestHandler): Promise<void> {
  await app.register(portalRoutes, { handle });
}

async function bridge(request: FastifyRequest, reply: FastifyReply, handle: PortalRequestHandler): Promise<unknown> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else if (value !== undefined) headers.set(key, String(value));
  }
  headers.set("x-request-id", request.id);
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : request.body instanceof Uint8Array
      ? Uint8Array.from(request.body).buffer
      : undefined;
  const response = await handle(new Request(new URL(request.url, `http://${request.headers.host ?? "localhost"}`), { method: request.method, headers, body }));
  reply.code(response.status);
  for (const [key, value] of response.headers) reply.header(key, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) reply.header("set-cookie", cookies);
  if (!response.body) return reply.send();
  return reply.send(Readable.fromWeb(response.body as never));
}
