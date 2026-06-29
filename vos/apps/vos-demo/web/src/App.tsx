import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Bug,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Loader2,
  MessageSquare,
  PanelRight,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { createDemoApiClient, type DebugTarget, type DemoRun, type DemoSession } from "./api.ts";

type Mode = "ask" | "debug";
type Role = "user" | "assistant" | "system";

interface ChatMessage {
  id: string;
  role: Role;
  text: string;
  run?: DemoRun;
}

interface Conversation {
  id: string;
  title: string;
  mode: Mode;
  threadId?: string;
  targetRunId?: string;
  messages: ChatMessage[];
}

const api = createDemoApiClient();
const STORE_KEY = "vos-demo-conversations";

export function App() {
  const [session, setSession] = useState<DemoSession | null>();
  const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string>(() => loadConversations()[0]?.id ?? "");
  const [targets, setTargets] = useState<DebugTarget[]>([]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState("public demo");
  const [targetRunId, setTargetRunId] = useState("");
  const [busy, setBusy] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [canvasWidth, setCanvasWidth] = useState(390);
  const [error, setError] = useState<string>();

  const active = conversations.find((item) => item.id === activeId) ?? conversations[0];

  useEffect(() => {
    api.session().then(setSession).catch(() => setSession(null));
    api.debugTargets().then((value) => {
      setTargets(value.targets);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  const canvasRun = useMemo(() => {
    const messages = active?.messages ?? [];
    return [...messages].reverse().find((message) => message.run?.visualizations?.length || message.run?.events?.length)?.run;
  }, [active]);

  if (session === undefined) return <main className="center"><Loader2 className="spin" /> Loading demo...</main>;
  if (!session) return <Login onLogin={setSession} />;

  function startConversation(mode: Mode) {
    const next = starterConversation(mode);
    setConversations((items) => [next, ...items]);
    setActiveId(next.id);
    setInput("");
  }

  async function submit() {
    if (!active || busy) return;
    const text = input.trim();
    if (!text) return;
    setBusy(true);
    setError(undefined);
    setInput("");
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
    const assistantId = crypto.randomUUID();
    const runningAssistant: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "Agent is working through the flow...",
    };
    updateConversation(active.id, { messages: [...active.messages, userMessage, runningAssistant] });
    try {
      const created = active.mode === "ask"
        ? await api.ask({ question: text, scope, threadId: active.threadId })
        : await api.debug({ runId: (active.targetRunId ?? targetRunId) || undefined, message: text, threadId: active.threadId });
      setCanvasOpen(true);
      const run = await waitForRun(created.id, (next) => {
        replaceMessage(active.id, assistantId, {
          text: summarizeRun(next),
          run: next,
        });
      });
      updateConversation(active.id, {
        title: titleFrom(text),
        threadId: run.threadId ?? active.threadId,
        targetRunId: active.mode === "debug" ? ((active.targetRunId ?? targetRunId) || undefined) : undefined,
      });
      if (run.visualizations?.length) setCanvasOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      replaceMessage(active.id, assistantId, {
        text: `Run failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  function updateConversation(id: string, patch: Partial<Conversation>) {
    setConversations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function replaceMessage(conversationId: string, messageId: string, patch: Partial<ChatMessage>) {
    setConversations((items) => items.map((item) => item.id === conversationId
      ? {
        ...item,
        messages: item.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
      }
      : item));
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (sidebarCollapsed) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const maxWidth = Math.max(320, Math.min(560, window.innerWidth - 620));
    const resize = (moveEvent: PointerEvent) => {
      setSidebarWidth(Math.min(maxWidth, Math.max(260, startWidth + moveEvent.clientX - startX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startCanvasResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canvasOpen) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = canvasWidth;
    const minWidth = 320;
    const maxWidth = Math.max(minWidth, Math.min(720, window.innerWidth - 520));
    const resize = (moveEvent: PointerEvent) => {
      setCanvasWidth(Math.min(maxWidth, Math.max(minWidth, startWidth + startX - moveEvent.clientX)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
  }

  return (
    <main
      className={[
        "app-shell",
        sidebarCollapsed ? "sidebar-collapsed" : "",
        canvasOpen ? "canvas-open" : "canvas-closed",
      ].filter(Boolean).join(" ")}
      style={{ "--sidebar-width": `${sidebarWidth}px`, "--canvas-width": `${canvasWidth}px` } as CSSProperties}
    >
      {sidebarCollapsed ? (
        <button className="sidebar-float" onClick={() => setSidebarCollapsed(false)} aria-label="Expand sidebar">
          <PanelLeftOpen size={18} />
        </button>
      ) : null}
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={18} />
          <span>VOS Demo</span>
          <button
            className="icon-button sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <button className="new-chat" onClick={() => startConversation("ask")} title="New Ask"><Plus size={16} /> <span>New Ask</span></button>
        <button className="new-chat" onClick={() => startConversation("debug")} title="New Debug"><Bug size={16} /> <span>New Debug</span></button>
        <div className="history">
          {conversations.map((item) => (
            <button key={item.id} className={item.id === active?.id ? "history-item active" : "history-item"} onClick={() => setActiveId(item.id)}>
              {item.mode === "ask" ? <MessageSquare size={15} /> : <Bug size={15} />}
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        <div className="quota">
          <strong>{session.quota.used}/{session.quota.sessionLimit}</strong>
          <span>session quota</span>
        </div>
        <div className="sidebar-resizer" onPointerDown={startSidebarResize} aria-hidden="true" />
      </aside>

      <section className="chat">
        <header className="chat-top">
          <div>
            <strong>{active?.mode === "debug" ? "Debug REPL" : "Ask REPL"}</strong>
            <span>{session.projectRoot}</span>
          </div>
          <button className="icon-button" onClick={() => setCanvasOpen((value) => !value)} aria-label="Toggle canvas">
            <PanelRight size={18} />
          </button>
        </header>

        {!active ? (
          <div className="empty">
            <Bot size={42} />
            <h1>How can VOS help?</h1>
            <button onClick={() => startConversation("ask")}>Start Ask</button>
            <button onClick={() => startConversation("debug")}>Start Debug</button>
          </div>
        ) : (
          <>
            <div className="messages">
              {active.messages.map((message) => <Message key={message.id} message={message} />)}
            </div>
            <div className="composer-wrap">
              {active.mode === "debug" ? (
                <select value={active.targetRunId ?? targetRunId} onChange={(event) => {
                  setTargetRunId(event.target.value);
                  updateConversation(active.id, { targetRunId: event.target.value || undefined });
                }}>
                  <option value="">Default Debug REPL - no runId</option>
                  {validationFailedTargets(targets).map((target) => (
                    <option key={target.runId} value={target.runId}>{target.runId} - {target.status}</option>
                  ))}
                </select>
              ) : (
                <input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Scope or stage" />
              )}
              <div className="composer">
                <textarea
                  value={input}
                  placeholder={active.mode === "debug" ? "Ask the debug agent to explain this run..." : "Ask about specs, design goals, or verification evidence..."}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
                <button onClick={() => void submit()} disabled={busy || !input.trim()} aria-label="Send"><Send size={18} /></button>
              </div>
              {error ? <p className="error"><CircleAlert size={14} /> {error}</p> : null}
            </div>
          </>
        )}
      </section>

      <aside className={canvasOpen ? "canvas open" : "canvas"}>
        <div className="canvas-resizer" onPointerDown={startCanvasResize} aria-hidden="true" />
        <button className="canvas-toggle" onClick={() => setCanvasOpen(false)}><ChevronRight size={16} /> Close</button>
        <Canvas run={canvasRun} />
      </aside>
    </main>
  );
}

function Login({ onLogin }: { onLogin: (session: DemoSession) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  return (
    <main className="login">
      <form onSubmit={async (event) => {
        event.preventDefault();
        try { onLogin(await api.login(code)); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      }}>
        <Sparkles size={28} />
        <h1>VOS Demo</h1>
        <p>Access-code protected Ask and Debug REPL for public demonstrations.</p>
        <input value={code} onChange={(event) => setCode(event.target.value)} type="password" placeholder="Access code" autoFocus />
        <button>Enter</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </main>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const Icon = message.role === "user" ? User : message.role === "system" ? FileText : Bot;
  return (
    <article className={`message ${message.role}`}>
      <Icon className="avatar" size={22} />
      <div className="bubble">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        {message.run ? <RunDetails run={message.run} /> : null}
      </div>
    </article>
  );
}

function RunDetails({ run }: { run: DemoRun }) {
  const items = run.kind === "ask"
    ? arrayValue(run.answer?.citations)
    : arrayValue(run.debug?.evidence_chain);
  const progress = run.status === "running" ? progressItems(run).slice(-4) : [];
  return (
    <div className="run-details">
      {progress.length ? (
        <div className="chat-progress" aria-label="Run progress">
          {progress.map((item, index) => (
            <div className={item.current ? "chat-progress-item current" : "chat-progress-item"} key={`${item.label}-${index}`}>
              {item.current ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {items.length ? (
        <details open>
          <summary>{run.kind === "ask" ? "Citations" : "Evidence chain"}</summary>
          {items.map((item, index) => <div className="detail-row" key={index}>{labelFor(item)}</div>)}
        </details>
      ) : null}
      {arrayValue(run.answer?.suggested_next_steps ?? run.debug?.next_diagnostic_commands).length ? (
        <details>
          <summary>Next steps</summary>
          {arrayValue(run.answer?.suggested_next_steps ?? run.debug?.next_diagnostic_commands).map((item, index) => (
            <div className="detail-row" key={index}>{String(item)}</div>
          ))}
        </details>
      ) : null}
    </div>
  );
}

function Canvas({ run }: { run?: DemoRun }) {
  if (!run) return <div className="canvas-empty"><ChevronLeft size={20} /> Visualizations and artifacts appear here.</div>;
  const viz = run.visualizations?.[0];
  return (
    <div className="canvas-body">
      <div className="canvas-head">
        <div>
          <h2>Canvas</h2>
          <span>{run.kind} · {run.status} · {run.targetRunId ?? run.id}</span>
        </div>
        {run.status === "running" ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
      </div>
      {viz ? <iframe title={viz.title} sandbox="allow-scripts" src={`/api/demo/visualizations/${viz.id}`} /> : <p className="muted">No visualization for this run.</p>}
      <section>
        <h3>Artifacts</h3>
        {(run.artifacts ?? []).length
          ? (run.artifacts ?? []).map((artifact) => <div className="event-row" key={artifact.path}>{artifact.kind}: {artifact.path}</div>)
          : <p className="muted">Artifacts appear after the run produces them.</p>}
      </section>
    </div>
  );
}

function progressItems(run: DemoRun): Array<{ label: string; detail: string; current: boolean }> {
  const events = run.events ?? [];
  const items = events.map((event) => {
    const payload = event.payload ?? {};
    const agentEvent = typeof payload.agent_event === "string" ? payload.agent_event : "";
    const message = typeof payload.message === "string" ? payload.message : "";
    return {
      label: agentEvent ? agentEvent.replaceAll(".", " ") : event.type.replaceAll("_", " "),
      detail: message || progressDetail(agentEvent, payload),
      current: false,
    };
  }).filter((item) => item.label);
  const compact = compactProgress(items);
  if (!compact.length) {
    compact.push({
      label: run.status === "running" ? "waiting for agent" : run.status,
      detail: run.status === "running" ? "The run has been accepted and will report progress shortly." : "Run finished.",
      current: run.status === "running",
    });
  }
  compact[compact.length - 1].current = run.status === "running";
  return compact.slice(-12);
}

function progressDetail(agentEvent: string, payload: Record<string, unknown>): string {
  if (agentEvent === "thread.created") return "Conversation thread is ready.";
  if (agentEvent === "model.usage") return "Model usage was recorded.";
  if (agentEvent === "assistant.message") return "Assistant produced an intermediate message.";
  if (agentEvent === "tool.call") return "Agent requested project context or evidence.";
  if (agentEvent === "tool.result") return "Project context or evidence returned to the agent.";
  return Object.keys(payload).length ? JSON.stringify(payload) : "Progress event received.";
}

function compactProgress(items: Array<{ label: string; detail: string; current: boolean }>) {
  const out: Array<{ label: string; detail: string; current: boolean; count?: number }> = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last?.label === item.label && last.detail === item.detail) {
      last.count = (last.count ?? 1) + 1;
      continue;
    }
    out.push({ ...item });
  }
  return out.map((item) => ({
    label: item.count ? `${item.label} x${item.count}` : item.label,
    detail: item.detail,
    current: item.current,
  }));
}

async function waitForRun(id: string, onUpdate?: (run: DemoRun) => void): Promise<DemoRun> {
  for (let i = 0; i < 600; i++) {
    const run = await api.run(id);
    onUpdate?.(run);
    if (run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Run ${id} did not finish`);
}

function summarizeRun(run: DemoRun): string {
  if (run.error) return run.error;
  if (run.status === "running") return "Agent is working through the flow...";
  if (run.kind === "ask") return String(run.answer?.answer ?? "Ask completed.");
  return String(run.debug?.summary ?? "Debug completed.");
}

function loadConversations(): Conversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [starterConversation("ask")];
  } catch {
    return [starterConversation("ask")];
  }
}

function starterConversation(mode: Mode): Conversation {
  return {
    id: crypto.randomUUID(),
    mode,
    title: mode === "ask" ? "New Ask" : "New Debug",
    messages: [{
      id: crypto.randomUUID(),
      role: "system",
      text: mode === "ask"
        ? "Ask a spec-grounded question. The agent will show context, citations, and next steps."
        : "Pick a validation_failed run, or leave the default Debug REPL with no runId.",
    }],
  };
}

function validationFailedTargets(targets: DebugTarget[]): DebugTarget[] {
  return targets.filter((target) => target.status === "validation_failed" && (target.artifactsCount ?? 0) > 0);
}

function titleFrom(value: string): string {
  return value.length > 42 ? `${value.slice(0, 39)}...` : value;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function labelFor(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const record = value as Record<string, unknown>;
  return String(record.title ?? record.label ?? record.observation ?? record.source_id ?? JSON.stringify(value));
}
