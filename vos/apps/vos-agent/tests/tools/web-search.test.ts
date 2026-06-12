import { describe, expect, test } from "bun:test";
import {
  createWebSearchTool,
  webSearchTool,
  type WebSearchProviderRequest,
} from "../../app/tools/web-search.ts";

describe("webSearchTool", () => {
  test("schema advertises query as required", () => {
    expect(webSearchTool.schema.function.name).toBe("WebSearch");
    const params = webSearchTool.schema.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties.query).toBeDefined();
    expect(params.properties.max_results).toBeDefined();
    expect(params.properties.timeout_ms).toBeDefined();
    expect(params.required).toEqual(["query"]);
  });

  test("queries a search endpoint and formats deterministic results", async () => {
    const seenUrls: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seenUrls.push(req.url);
        return Response.json({
          Heading: "Stars agent",
          AbstractText: "A coding agent project.",
          AbstractURL: "https://example.com/stars",
          RelatedTopics: [
            { Text: "Stars docs - Documentation", FirstURL: "https://example.com/docs" },
            { Topics: [{ Text: "Stars tests - Test guide", FirstURL: "https://example.com/tests" }] },
          ],
        });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
      });
      const result = await tool.execute(JSON.stringify({
        query: "stars agent",
        max_results: 2,
      }));

      expect(new URL(seenUrls[0]).searchParams.get("q")).toBe("stars agent");
      expect(result).toContain("Search query: stars agent");
      expect(result).toContain("1. Stars agent");
      expect(result).toContain("URL: https://example.com/stars");
      expect(result).toContain("Snippet: A coding agent project.");
      expect(result).toContain("2. Stars docs");
      expect(result).not.toContain("Stars tests");
    } finally {
      await server.stop(true);
    }
  });

  test("delegates searching to an injected provider after parsing arguments", async () => {
    const seen: WebSearchProviderRequest[] = [];
    const tool = createWebSearchTool({
      provider: {
        async search(request) {
          seen.push(request);
          return [
            { title: "Provider result A", url: "https://example.com/a", snippet: "first" },
            { title: "Provider result A duplicate", url: "https://example.com/a", snippet: "dupe" },
            { title: "Provider result B", url: "https://example.com/b", snippet: "second" },
            { title: "Provider result C", url: "https://example.com/c", snippet: "third" },
          ];
        },
      },
    });

    const result = await tool.execute(JSON.stringify({
      query: "stars provider",
      max_results: 2,
      timeout_ms: 789,
    }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      query: "stars provider",
      maxResults: 2,
      timeoutMs: 789,
    });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(result).toContain("Search query: stars provider");
    expect(result).toContain("1. Provider result A");
    expect(result).toContain("URL: https://example.com/a");
    expect(result).toContain("Snippet: first");
    expect(result).toContain("2. Provider result B");
    expect(result).not.toContain("Provider result A duplicate");
    expect(result).not.toContain("Provider result C");

    const failingTool = createWebSearchTool({
      provider: {
        async search() {
          throw new Error("provider unavailable");
        },
      },
    });
    await expect(failingTool.execute(JSON.stringify({ query: "stars" })))
      .resolves.toContain("Error searching web: provider unavailable");
  });

  test("returns validation and endpoint errors as strings", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("not json", { status: 200 });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
      });

      expect(await tool.execute("not json")).toContain("Error parsing WebSearch arguments");
      expect(await tool.execute(JSON.stringify({ query: "" }))).toContain(
        '"query" must be non-empty',
      );
      expect(await tool.execute(JSON.stringify({ query: "stars", max_results: 0 }))).toContain(
        '"max_results" must be >= 1',
      );
      expect(await tool.execute(JSON.stringify({ query: "stars" }))).toContain(
        "Error searching web: invalid JSON response",
      );

      const privateEndpointTool = createWebSearchTool({
        endpoint: "http://[::ffff:7f00:1]:1/search",
      });
      expect(await privateEndpointTool.execute(JSON.stringify({ query: "stars" }))).toContain(
        "private, loopback, and link-local search endpoints are not supported",
      );
    } finally {
      await server.stop(true);
    }
  });

  test("reports when no results are found", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ RelatedTopics: [] });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
      });

      expect(await tool.execute(JSON.stringify({ query: "missing" }))).toBe(
        "No web search results found for: missing",
      );
    } finally {
      await server.stop(true);
    }
  });

  test("extracts DuckDuckGo Results entries", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          Results: [{ Text: "Official Stars - Project home", FirstURL: "https://example.com/home" }],
        });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
      });

      const result = await tool.execute(JSON.stringify({ query: "stars" }));

      expect(result).toContain("1. Official Stars");
      expect(result).toContain("Snippet: Project home");
    } finally {
      await server.stop(true);
    }
  });

  test("bounds successful search response bodies before parsing", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ RelatedTopics: [{ Text: "x".repeat(200), FirstURL: "https://example.com" }] });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
        maxResponseBytes: 20,
      });

      expect(await tool.execute(JSON.stringify({ query: "stars" }))).toContain(
        "search response exceeded 20 bytes",
      );
    } finally {
      await server.stop(true);
    }
  });

  test("timeout covers slow search response body reads", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"));
            setTimeout(() => {
              try {
                controller.enqueue(new TextEncoder().encode("}\n"));
                controller.close();
              } catch {
                // The client may abort before the delayed chunk is sent.
              }
            }, 200);
          },
        }), { headers: { "content-type": "application/json" } });
      },
    });
    try {
      const tool = createWebSearchTool({
        endpoint: `http://127.0.0.1:${server.port}/search`,
        allowPrivateEndpoint: true,
      });

      const result = await tool.execute(JSON.stringify({ query: "stars", timeout_ms: 30 }));

      expect(result).toContain("Error searching web");
    } finally {
      await server.stop(true);
    }
  });
});
