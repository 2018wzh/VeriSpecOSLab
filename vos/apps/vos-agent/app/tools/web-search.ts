import type { Tool } from "./types.ts";
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  formatError,
  parseToolArguments,
  readOptionalIntegerArgument,
  requireStringArgument,
  truncateUtf8,
} from "./common.ts";

export interface WebSearchOptions {
  /** Search endpoint. Defaults to DuckDuckGo's JSON API. */
  endpoint?: string;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Maximum UTF-8 bytes returned to the model. */
  maxOutputBytes?: number;
  /** Maximum bytes read from the search endpoint before parsing. */
  maxResponseBytes?: number;
  /** Replace the default HTTP search endpoint with another provider. */
  provider?: WebSearchProvider;
  /** Allow loopback/private/link-local search endpoints. Intended for tests/local labs. */
  allowPrivateEndpoint?: boolean;
  /** Injectable fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface SearchResult {
  title: string;
  url?: string;
  snippet?: string;
}

export interface WebSearchProviderRequest {
  query: string;
  maxResults: number;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface WebSearchProvider {
  search(request: WebSearchProviderRequest): Promise<readonly SearchResult[]>;
}

export interface HttpWebSearchProviderOptions {
  /** Search endpoint. Defaults to DuckDuckGo's JSON API. */
  endpoint?: string;
  /** Maximum bytes read from the search endpoint before parsing. */
  maxResponseBytes?: number;
  /** Allow loopback/private/link-local search endpoints. Intended for tests/local labs. */
  allowPrivateEndpoint?: boolean;
  /** Injectable fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_SEARCH_ENDPOINT = "https://api.duckduckgo.com/";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 20;
const MAX_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

export function createWebSearchTool(opts: WebSearchOptions = {}): Tool {
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  const provider = opts.provider ?? createHttpWebSearchProvider({
    endpoint: opts.endpoint,
    maxResponseBytes: opts.maxResponseBytes,
    allowPrivateEndpoint: opts.allowPrivateEndpoint,
    fetchImpl: opts.fetchImpl,
  });

  return {
    name: "WebSearch",
    schema: {
      type: "function",
      function: {
        name: "WebSearch",
        description:
          "Search the web for a text query and return a small deterministic result list.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query text.",
            },
            max_results: {
              type: "integer",
              description: `Maximum results to return. Defaults to ${DEFAULT_MAX_RESULTS}; max ${MAX_RESULTS}.`,
            },
            timeout_ms: {
              type: "integer",
              description:
                `Request timeout in milliseconds. Defaults to ${defaultTimeoutMs}; max ${MAX_TIMEOUT_MS}.`,
            },
          },
          required: ["query"],
        },
      },
    },
    async execute(argumentsJson: string): Promise<string> {
      const parsed = parseToolArguments("WebSearch", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const query = requireStringArgument("WebSearch", parsed.args, "query", {
        trimForEmptyCheck: true,
      });
      if (!query.ok) return query.error;

      const maxResults = readOptionalIntegerArgument("WebSearch", parsed.args, "max_results", {
        defaultValue: DEFAULT_MAX_RESULTS,
        min: 1,
        max: MAX_RESULTS,
      });
      if (!maxResults.ok) return maxResults.error;

      const timeoutMs = readOptionalIntegerArgument("WebSearch", parsed.args, "timeout_ms", {
        defaultValue: defaultTimeoutMs,
        min: 1,
        max: MAX_TIMEOUT_MS,
      });
      if (!timeoutMs.ok) return timeoutMs.error;

      const controller = new AbortController();
      const timeout = timeoutPromise(controller, timeoutMs.value);
      try {
        const providerResults = await Promise.race([
          provider.search({
            query: query.value,
            maxResults: maxResults.value,
            timeoutMs: timeoutMs.value,
            maxOutputBytes,
            signal: controller.signal,
          }),
          timeout.promise,
        ]);
        const results = dedupeResults(providerResults).slice(0, maxResults.value);
        if (results.length === 0) {
          return `No web search results found for: ${query.value}`;
        }
        return truncateUtf8(
          formatSearchResults(query.value, results),
          maxOutputBytes,
          "web search results",
        );
      } catch (e) {
        return `Error searching web: ${formatError(e)}`;
      } finally {
        timeout.clear();
      }
    },
  };
}

export const webSearchTool: Tool = createWebSearchTool();

export function createHttpWebSearchProvider(
  opts: HttpWebSearchProviderOptions = {},
): WebSearchProvider {
  const endpoint = opts.endpoint ?? DEFAULT_SEARCH_ENDPOINT;
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const allowPrivateEndpoint = opts.allowPrivateEndpoint ?? false;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async search(request: WebSearchProviderRequest): Promise<readonly SearchResult[]> {
      const searchUrl = buildSearchUrl(endpoint, request.query, allowPrivateEndpoint);
      if (!searchUrl.ok) throw new Error(searchUrl.error);

      const response = await fetchWithRedirects(fetchImpl, searchUrl.value, {
        allowPrivateEndpoint,
        signal: request.signal,
      });
      const body = await readResponseBody(response.response, maxResponseBytes);
      if (!response.response.ok) {
        throw new Error(formatHttpError(response.response, body, request.maxOutputBytes, maxResponseBytes));
      }
      if (body.truncated) {
        throw new Error(`search response exceeded ${maxResponseBytes} bytes`);
      }
      let json: unknown;
      try {
        json = JSON.parse(body.text);
      } catch (e) {
        throw new Error(`invalid JSON response: ${formatError(e)}`);
      }
      return dedupeResults(extractResults(json));
    },
  };
}

type SearchUrlResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

function buildSearchUrl(
  endpoint: string,
  query: string,
  allowPrivateEndpoint: boolean,
): SearchUrlResult {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (e) {
    return { ok: false, error: `invalid search endpoint: ${formatError(e)}` };
  }
  const checked = validateSearchEndpointUrl(url, allowPrivateEndpoint);
  if (!checked.ok) return checked;
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("skip_disambig", "1");
  return { ok: true, value: url.toString() };
}

type SearchEndpointUrlResult =
  | { ok: true; value: URL }
  | { ok: false; error: string };

function validateSearchEndpointUrl(
  url: URL,
  allowPrivateEndpoint: boolean,
): SearchEndpointUrlResult {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "search endpoint must be http or https" };
  }
  if (!allowPrivateEndpoint && isPrivateNetworkHost(url.hostname)) {
    return { ok: false, error: "private, loopback, and link-local search endpoints are not supported" };
  }
  return { ok: true, value: url };
}

interface FetchResult {
  response: Response;
  url: URL;
}

async function fetchWithRedirects(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  initialUrl: string,
  opts: { allowPrivateEndpoint: boolean; signal: AbortSignal },
): Promise<FetchResult> {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetchImpl(url.toString(), {
      signal: opts.signal,
      redirect: "manual",
      headers: { "User-Agent": "stars-agent" },
    });
    if (!isRedirect(response.status)) {
      return { response, url };
    }
    const location = response.headers.get("location");
    if (!location) return { response, url };
    if (redirects === MAX_REDIRECTS) {
      throw new Error(`too many redirects (max ${MAX_REDIRECTS})`);
    }
    const checked = validateSearchEndpointUrl(
      new URL(location, url),
      opts.allowPrivateEndpoint,
    );
    if (!checked.ok) throw new Error(checked.error);
    url = checked.value;
  }
  throw new Error(`too many redirects (max ${MAX_REDIRECTS})`);
}

interface BodyReadResult {
  text: string;
  truncated: boolean;
}

async function readResponseBody(response: Response, maxBytes: number): Promise<BodyReadResult> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let storedBytes = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - storedBytes;
      if (chunk.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(chunk.subarray(0, remaining));
          storedBytes += remaining;
        }
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(chunk);
      storedBytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function formatHttpError(
  response: Response,
  body: BodyReadResult,
  maxOutputBytes: number,
  maxResponseBytes: number,
): string {
  const status = response.statusText
    ? `${response.status} ${response.statusText}`
    : String(response.status);
  const text = body.truncated
    ? `${body.text}\n[web search response truncated at ${maxResponseBytes} bytes]`
    : body.text;
  const output = truncateUtf8(text, maxOutputBytes, "web search error body");
  return output
    ? `HTTP ${status}\n${output}`
    : `HTTP ${status}`;
}

function timeoutPromise(
  controller: AbortController,
  timeoutMs: number,
): { promise: Promise<never>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`operation timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    }),
    clear() {
      if (timer) clearTimeout(timer);
    },
  };
}

function extractResults(value: unknown): SearchResult[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  const results: SearchResult[] = [];

  const heading = stringValue(raw.Heading);
  const abstractText = stringValue(raw.AbstractText);
  const abstractUrl = stringValue(raw.AbstractURL);
  if (heading && (abstractText || abstractUrl)) {
    results.push({
      title: heading,
      ...(abstractUrl ? { url: abstractUrl } : {}),
      ...(abstractText ? { snippet: abstractText } : {}),
    });
  }

  collectDuckDuckGoTopics(raw.Results, results);
  collectDuckDuckGoTopics(raw.RelatedTopics, results);
  collectGenericResults(raw.results, results);
  collectGenericResults(raw.items, results);
  const webPages = raw.webPages as { value?: unknown } | undefined;
  if (webPages && typeof webPages === "object") {
    collectGenericResults(webPages.value, results);
  }

  return results;
}

function collectDuckDuckGoTopics(value: unknown, results: SearchResult[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    if (Array.isArray(raw.Topics)) {
      collectDuckDuckGoTopics(raw.Topics, results);
      continue;
    }
    const text = stringValue(raw.Text);
    const url = stringValue(raw.FirstURL);
    if (!text && !url) continue;
    const split = splitTitleAndSnippet(text ?? url ?? "Result");
    results.push({
      title: split.title,
      ...(url ? { url } : {}),
      ...(split.snippet ? { snippet: split.snippet } : {}),
    });
  }
}

function collectGenericResults(value: unknown, results: SearchResult[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const title = stringValue(raw.title) ?? stringValue(raw.name);
    const url = stringValue(raw.url) ?? stringValue(raw.link);
    const snippet = stringValue(raw.snippet) ?? stringValue(raw.description) ?? stringValue(raw.text);
    if (!title && !url && !snippet) continue;
    results.push({
      title: title ?? url ?? snippet ?? "Result",
      ...(url ? { url } : {}),
      ...(snippet ? { snippet } : {}),
    });
  }
}

function dedupeResults(results: readonly SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    const key = (result.url ?? result.title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function splitTitleAndSnippet(text: string): { title: string; snippet?: string } {
  const parts = text.split(" - ");
  const title = parts.shift()?.trim() || text;
  const snippet = parts.join(" - ").trim();
  return snippet ? { title, snippet } : { title };
}

function formatSearchResults(query: string, results: readonly SearchResult[]): string {
  const lines = [`Search query: ${query}`, "Results:"];
  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    if (result.url) lines.push(`   URL: ${result.url}`);
    if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
  });
  return lines.join("\n");
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    return isPrivateIpv4(ipv4);
  }

  const mappedIpv4 = parseIpv4MappedIpv6(host);
  if (mappedIpv4) {
    return isPrivateIpv4(mappedIpv4);
  }

  if (host === "::1") return true;
  const firstHextet = Number.parseInt(host.split(":")[0] ?? "", 16);
  if (Number.isNaN(firstHextet)) return false;
  return (firstHextet & 0xfe00) === 0xfc00
    || (firstHextet & 0xffc0) === 0xfe80;
}

function parseIpv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte, index) =>
    !Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== parts[index]
  )) {
    return undefined;
  }
  return bytes as [number, number, number, number];
}

function parseIpv4MappedIpv6(host: string): [number, number, number, number] | undefined {
  if (!host.startsWith("::ffff:")) return undefined;
  const suffix = host.slice("::ffff:".length);
  const dotted = parseIpv4(suffix);
  if (dotted) return dotted;

  const parts = suffix.split(":");
  if (parts.length !== 2) return undefined;
  const high = parseHextet(parts[0]);
  const low = parseHextet(parts[1]);
  if (high === undefined || low === undefined) return undefined;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function parseHextet(value: string): number | undefined {
  if (!/^[0-9a-f]{1,4}$/i.test(value)) return undefined;
  const parsed = Number.parseInt(value, 16);
  return parsed >= 0 && parsed <= 0xffff ? parsed : undefined;
}

function isPrivateIpv4(ipv4: [number, number, number, number]): boolean {
  const [a, b] = ipv4;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}
