export class DemoApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "DemoApiError";
  }
}

export interface DemoSession {
  ok: true;
  projectRoot: string;
  sessionId: string;
  quota: { used: number; sessionLimit: number; dailyLimit: number };
}

export interface DebugTarget {
  runId: string;
  status: string;
  command?: string[];
  artifactsCount?: number;
  startedAt?: string;
}

export interface CreatedRun {
  id: string;
  status: string;
}

export interface DemoRun {
  id: string;
  kind: "ask" | "debug";
  status: string;
  threadId?: string;
  question?: string;
  targetRunId?: string;
  answer?: Record<string, unknown>;
  debug?: Record<string, unknown>;
  error?: string;
  events?: Array<{ type: string; payload?: Record<string, unknown>; ts?: string }>;
  artifacts?: Array<{ kind: string; path: string }>;
  visualizations?: Array<{ id: string; title: string }>;
}

type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

export function createDemoApiClient(fetcher: Fetcher = defaultFetch) {
  return {
    login: (accessCode: string) => request<DemoSession>(fetcher, "/api/demo/login", {
      method: "POST",
      body: JSON.stringify({ accessCode }),
    }),
    session: () => request<DemoSession>(fetcher, "/api/demo/session"),
    debugTargets: () => request<{ targets: DebugTarget[] }>(fetcher, "/api/demo/debug-targets"),
    ask: (body: { question: string; scope?: string; threadId?: string | null }) =>
      request<CreatedRun>(fetcher, "/api/demo/ask", {
        method: "POST",
        body: JSON.stringify(clean(body)),
      }),
    debug: (body: { runId?: string | null; message?: string; threadId?: string | null }) =>
      request<CreatedRun>(fetcher, "/api/demo/debug", {
        method: "POST",
        body: JSON.stringify(clean(body)),
      }),
    run: (id: string) => request<DemoRun>(fetcher, `/api/demo/runs/${encodeURIComponent(id)}`),
  };
}

async function request<T>(fetcher: Fetcher, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetcher(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new DemoApiError(typeof data.error === "string" ? data.error : response.statusText, response.status);
  }
  return data as T;
}

function defaultFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, init);
}

function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== "")) as T;
}
