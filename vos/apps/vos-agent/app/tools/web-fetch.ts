import type { Tool } from "./types.ts";
import {
  DEFAULT_TOOL_OUTPUT_MAX_BYTES,
  formatError,
  parseToolArguments,
  readOptionalIntegerArgument,
  requireStringArgument,
} from "./common.ts";

export interface WebFetchOptions {
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Default maximum UTF-8 bytes returned from the body. */
  maxOutputBytes?: number;
  /** Replace the default HTTP fetch implementation with another provider. */
  provider?: WebFetchProvider;
  /** Allow loopback/private/link-local HTTP targets. Intended for tests/local labs. */
  allowPrivateNetwork?: boolean;
  /** Injectable fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface WebFetchProviderRequest {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface WebFetchProviderResponse {
  url: string;
  status: number;
  statusText?: string;
  contentType?: string;
  body: string;
  bodyTruncated?: boolean;
}

export interface WebFetchProvider {
  fetch(request: WebFetchProviderRequest): Promise<WebFetchProviderResponse>;
}

export interface HttpWebFetchProviderOptions {
  /** Allow loopback/private/link-local HTTP targets. Intended for tests/local labs. */
  allowPrivateNetwork?: boolean;
  /** Injectable fetch implementation for tests. Defaults to global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;

export function createWebFetchTool(opts: WebFetchOptions = {}): Tool {
  const defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxBytes = opts.maxOutputBytes ?? DEFAULT_TOOL_OUTPUT_MAX_BYTES;
  const allowPrivateNetwork = opts.allowPrivateNetwork ?? false;
  const provider = opts.provider ?? createHttpWebFetchProvider({
    allowPrivateNetwork,
    fetchImpl: opts.fetchImpl,
  });

  return {
    name: "WebFetch",
    schema: {
      type: "function",
      function: {
        name: "WebFetch",
        description:
          "Fetch an HTTP(S) URL and return response metadata plus a truncated text body.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "HTTP or HTTPS URL to fetch.",
            },
            max_bytes: {
              type: "integer",
              description:
                `Maximum response-body bytes to return. Defaults to ${defaultMaxBytes}.`,
            },
            timeout_ms: {
              type: "integer",
              description:
                `Request timeout in milliseconds. Defaults to ${defaultTimeoutMs}; max ${MAX_TIMEOUT_MS}.`,
            },
          },
          required: ["url"],
        },
      },
    },
    async execute(argumentsJson: string): Promise<string> {
      const parsed = parseToolArguments("WebFetch", argumentsJson);
      if (!parsed.ok) return parsed.error;

      const urlArg = requireStringArgument("WebFetch", parsed.args, "url", {
        trimForEmptyCheck: true,
      });
      if (!urlArg.ok) return urlArg.error;

      const url = parseHttpUrl(urlArg.value, allowPrivateNetwork);
      if (!url.ok) return `Error fetching URL: ${url.error}`;

      const maxBytes = readOptionalIntegerArgument("WebFetch", parsed.args, "max_bytes", {
        defaultValue: defaultMaxBytes,
        min: 1,
        max: MAX_BODY_BYTES,
      });
      if (!maxBytes.ok) return maxBytes.error;

      const timeoutMs = readOptionalIntegerArgument("WebFetch", parsed.args, "timeout_ms", {
        defaultValue: defaultTimeoutMs,
        min: 1,
        max: MAX_TIMEOUT_MS,
      });
      if (!timeoutMs.ok) return timeoutMs.error;

      const controller = new AbortController();
      const timeout = timeoutPromise(controller, timeoutMs.value);
      try {
        const fetched = await Promise.race([
          provider.fetch({
            url: url.value.toString(),
            maxBytes: maxBytes.value,
            timeoutMs: timeoutMs.value,
            signal: controller.signal,
          }),
          timeout.promise,
        ]);
        return formatFetchResult(fetched, maxBytes.value);
      } catch (e) {
        return `Error fetching URL: ${formatError(e)}`;
      } finally {
        timeout.clear();
      }
    },
  };
}

export const webFetchTool: Tool = createWebFetchTool();

export function createHttpWebFetchProvider(
  opts: HttpWebFetchProviderOptions = {},
): WebFetchProvider {
  const allowPrivateNetwork = opts.allowPrivateNetwork ?? false;
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async fetch(request: WebFetchProviderRequest): Promise<WebFetchProviderResponse> {
      const url = parseHttpUrl(request.url, allowPrivateNetwork);
      if (!url.ok) throw new Error(url.error);

      const fetched = await fetchWithRedirects(fetchImpl, url.value, {
        allowPrivateNetwork,
        signal: request.signal,
      });
      const body = await readResponseBody(fetched.response, request.maxBytes);
      return {
        url: fetched.response.url || fetched.url.toString(),
        status: fetched.response.status,
        statusText: fetched.response.statusText || undefined,
        contentType: fetched.response.headers.get("content-type") ?? undefined,
        body: body.text,
        bodyTruncated: body.truncated,
      };
    },
  };
}

type UrlParseResult =
  | { ok: true; value: URL }
  | { ok: false; error: string };

function parseHttpUrl(rawUrl: string, allowPrivateNetwork: boolean): UrlParseResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return { ok: false, error: `invalid URL: ${formatError(e)}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "only http and https URLs are supported" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "URLs with embedded credentials are not supported" };
  }
  if (!allowPrivateNetwork && isPrivateNetworkHost(url.hostname)) {
    return { ok: false, error: "private, loopback, and link-local hosts are not supported" };
  }
  return { ok: true, value: url };
}

interface FetchResult {
  response: Response;
  url: URL;
}

async function fetchWithRedirects(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  initialUrl: URL,
  opts: { allowPrivateNetwork: boolean; signal: AbortSignal },
): Promise<FetchResult> {
  let url = initialUrl;
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
    const nextUrl = parseHttpUrl(
      new URL(location, url).toString(),
      opts.allowPrivateNetwork,
    );
    if (!nextUrl.ok) throw new Error(nextUrl.error);
    url = nextUrl.value;
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

function formatBody(body: BodyReadResult, maxBytes: number): string {
  return body.truncated
    ? `${body.text}\n[web response truncated at ${maxBytes} bytes]`
    : body.text;
}

function formatFetchResult(result: WebFetchProviderResponse, maxBytes: number): string {
  const status = result.statusText
    ? `${result.status} ${result.statusText}`
    : String(result.status);
  return [
    `URL: ${result.url}`,
    `Status: ${status}`,
    `Content-Type: ${result.contentType ?? "unknown"}`,
    "Body:",
    enforceBodyLimit(result.body, maxBytes, result.bodyTruncated ?? false),
  ].join("\n");
}

function enforceBodyLimit(body: string, maxBytes: number, bodyTruncated: boolean): string {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= maxBytes) return formatBody({ text: body, truncated: bodyTruncated }, maxBytes);
  const truncated = Buffer.from(body, "utf8").subarray(0, maxBytes).toString("utf8");
  return formatBody({ text: truncated, truncated: true }, maxBytes);
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
