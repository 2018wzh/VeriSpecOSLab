import { describe, expect, test } from "bun:test";
import {
  createWebFetchTool,
  webFetchTool,
  type WebFetchProviderRequest,
} from "../../app/tools/web-fetch.ts";

describe("webFetchTool", () => {
  test("schema advertises url as required", () => {
    expect(webFetchTool.schema.function.name).toBe("WebFetch");
    const params = webFetchTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.url).toBeDefined();
    expect(params.properties.max_bytes).toBeDefined();
    expect(params.properties.timeout_ms).toBeDefined();
    expect(params.required).toEqual(["url"]);
  });

  test("fetches an HTTP URL and returns status, content type, and body", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("hello from web", {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    });
    try {
      const tool = createWebFetchTool({ allowPrivateNetwork: true });
      const result = await tool.execute(JSON.stringify({
        url: `http://127.0.0.1:${server.port}/hello`,
      }));

      expect(result).toContain(`URL: http://127.0.0.1:${server.port}/hello`);
      expect(result).toContain("Status: 200 OK");
      expect(result).toContain("Content-Type: text/plain; charset=utf-8");
      expect(result).toContain("Body:\nhello from web");
    } finally {
      await server.stop(true);
    }
  });

  test("delegates fetching to an injected provider after parsing arguments", async () => {
    const seen: WebFetchProviderRequest[] = [];
    const tool = createWebFetchTool({
      provider: {
        async fetch(request) {
          seen.push(request);
          return {
            url: "https://provider.example/final",
            status: 202,
            statusText: "Accepted",
            contentType: "text/markdown",
            body: "provider body",
          };
        },
      },
    });

    const result = await tool.execute(JSON.stringify({
      url: "https://example.com/start",
      max_bytes: 123,
      timeout_ms: 456,
    }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: "https://example.com/start",
      maxBytes: 123,
      timeoutMs: 456,
    });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(result).toContain("URL: https://provider.example/final");
    expect(result).toContain("Status: 202 Accepted");
    expect(result).toContain("Content-Type: text/markdown");
    expect(result).toContain("Body:\nprovider body");

    const failingTool = createWebFetchTool({
      provider: {
        async fetch() {
          throw new Error("provider unavailable");
        },
      },
    });
    await expect(failingTool.execute(JSON.stringify({ url: "https://example.com" })))
      .resolves.toContain("Error fetching URL: provider unavailable");
  });

  test("applies URL policy and output caps before and after injected providers", async () => {
    const seen: WebFetchProviderRequest[] = [];
    const tool = createWebFetchTool({
      provider: {
        async fetch(request) {
          seen.push(request);
          return {
            url: request.url,
            status: 200,
            contentType: "text/plain",
            body: "abcdef",
          };
        },
      },
    });

    await expect(tool.execute(JSON.stringify({ url: "file:///etc/passwd" })))
      .resolves.toContain("only http and https URLs are supported");
    await expect(tool.execute(JSON.stringify({ url: "https://user:pass@example.com" })))
      .resolves.toContain("URLs with embedded credentials are not supported");
    await expect(tool.execute(JSON.stringify({ url: "http://127.0.0.1:1" })))
      .resolves.toContain("private, loopback, and link-local hosts are not supported");
    expect(seen).toEqual([]);

    const result = await tool.execute(JSON.stringify({
      url: "https://example.com/large",
      max_bytes: 4,
    }));

    expect(seen).toHaveLength(1);
    expect(result).toContain("Body:\nabcd");
    expect(result).toContain("web response truncated at 4 bytes");
  });

  test("returns validation and fetch errors as strings", async () => {
    const tool = createWebFetchTool({ timeoutMs: 50 });

    expect(await tool.execute("not json")).toContain("Error parsing WebFetch arguments");
    expect(await tool.execute(JSON.stringify({ url: "file:///etc/passwd" }))).toContain(
      "only http and https URLs are supported",
    );
    expect(await tool.execute(JSON.stringify({ url: "http://127.0.0.1:1" }))).toContain(
      "private, loopback, and link-local hosts are not supported",
    );
    expect(await tool.execute(JSON.stringify({ url: "http://[::ffff:7f00:1]:1" }))).toContain(
      "private, loopback, and link-local hosts are not supported",
    );
    expect(await tool.execute(JSON.stringify({ url: "https://example.test", timeout_ms: 0 }))).toContain(
      '"timeout_ms" must be >= 1',
    );
  });

  test("rejects redirects to private network targets", async () => {
    const tool = createWebFetchTool({
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:1234/secret" },
      }),
    });

    const result = await tool.execute(JSON.stringify({ url: "https://example.com/start" }));

    expect(result).toContain("private, loopback, and link-local hosts are not supported");
  });

  test("timeout covers slow response body reads", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            setTimeout(() => {
              try {
                controller.enqueue(new TextEncoder().encode(" late"));
                controller.close();
              } catch {
                // The client may abort before the delayed chunk is sent.
              }
            }, 200);
          },
        }), { headers: { "content-type": "text/plain" } });
      },
    });
    try {
      const tool = createWebFetchTool({ allowPrivateNetwork: true });
      const result = await tool.execute(JSON.stringify({
        url: `http://127.0.0.1:${server.port}/slow`,
        timeout_ms: 30,
      }));

      expect(result).toContain("Error fetching URL");
    } finally {
      await server.stop(true);
    }
  });

  test("truncates large response bodies with an explicit marker", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("abcdef", {
          headers: { "content-type": "text/plain" },
        });
      },
    });
    try {
      const tool = createWebFetchTool({ allowPrivateNetwork: true });
      const result = await tool.execute(JSON.stringify({
        url: `http://127.0.0.1:${server.port}/large`,
        max_bytes: 4,
      }));

      expect(result).toContain("Body:\nabcd");
      expect(result).toContain("web response truncated");
    } finally {
      await server.stop(true);
    }
  });
});
