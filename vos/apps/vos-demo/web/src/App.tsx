import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Bug,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Loader2,
  MessageSquare,
  PanelRight,
  Plus,
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
  const [error, setError] = useState<string>();

  const active = conversations.find((item) => item.id === activeId) ?? conversations[0];

  useEffect(() => {
    api.session().then(setSession).catch(() => setSession(null));
    api.debugTargets().then((value) => {
      setTargets(value.targets);
      setTargetRunId((current) => current || pickTarget(value.targets));
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
    updateConversation(active.id, { messages: [...active.messages, userMessage] });
    try {
      const created = active.mode === "ask"
        ? await api.ask({ question: text, scope, threadId: active.threadId })
        : await api.debug({ runId: active.targetRunId ?? targetRunId, message: text, threadId: active.threadId });
      const run = await waitForRun(created.id);
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: summarizeRun(run),
        run,
      };
      updateConversation(active.id, {
        title: titleFrom(text),
        threadId: run.threadId ?? active.threadId,
        targetRunId: active.mode === "debug" ? (active.targetRunId ?? targetRunId) : undefined,
        messages: [...active.messages, userMessage, assistant],
      });
      if (run.visualizations?.length) setCanvasOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      updateConversation(active.id, {
        messages: [...active.messages, userMessage, { id: crypto.randomUUID(), role: "assistant", text: `Run failed: ${err instanceof Error ? err.message : String(err)}` }],
      });
    } finally {
      setBusy(false);
    }
  }

  function updateConversation(id: string, patch: Partial<Conversation>) {
    setConversations((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><Sparkles size={18} /> VOS Demo</div>
        <button className="new-chat" onClick={() => startConversation("ask")}><Plus size={16} /> New Ask</button>
        <button className="new-chat" onClick={() => startConversation("debug")}><Bug size={16} /> New Debug</button>
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
              {busy ? <div className="message assistant"><Bot className="avatar" size={22} /><div className="bubble muted"><Loader2 className="spin" size={16} /> Agent is working through the flow...</div></div> : null}
            </div>
            <div className="composer-wrap">
              {active.mode === "debug" ? (
                <select value={active.targetRunId ?? targetRunId} onChange={(event) => {
                  setTargetRunId(event.target.value);
                  updateConversation(active.id, { targetRunId: event.target.value });
                }}>
                  {targets.map((target) => (
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
        <ReactMarkdown>{message.text}</ReactMarkdown>
        {message.run ? <RunDetails run={message.run} /> : null}
      </div>
    </article>
  );
}

function RunDetails({ run }: { run: DemoRun }) {
  const items = run.kind === "ask"
    ? arrayValue(run.answer?.citations)
    : arrayValue(run.debug?.evidence_chain);
  return (
    <div className="run-details">
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
  if (!run) return <div className="canvas-empty"><ChevronLeft size={20} /> Progress, evidence, and visualizations appear here.</div>;
  const viz = run.visualizations?.[0];
  return (
    <div className="canvas-body">
      <h2>Canvas</h2>
      {viz ? <iframe title={viz.title} sandbox="allow-scripts" src={`/api/demo/visualizations/${viz.id}`} /> : <p className="muted">No visualization for this run.</p>}
      <section>
        <h3>Progress</h3>
        {(run.events ?? []).map((event, index) => <div className="event-row" key={index}>{event.type}: {JSON.stringify(event.payload ?? {})}</div>)}
      </section>
      <section>
        <h3>Artifacts</h3>
        {(run.artifacts ?? []).map((artifact) => <div className="event-row" key={artifact.path}>{artifact.kind}: {artifact.path}</div>)}
      </section>
    </div>
  );
}

async function waitForRun(id: string): Promise<DemoRun> {
  for (let i = 0; i < 600; i++) {
    const run = await api.run(id);
    if (run.status !== "running") return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Run ${id} did not finish`);
}

function summarizeRun(run: DemoRun): string {
  if (run.error) return run.error;
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
        : "Pick a failed build/verify run, then ask the debug agent for the evidence chain and visualization.",
    }],
  };
}

function pickTarget(targets: DebugTarget[]): string {
  return targets.find((target) => ["failed", "validation_failed"].includes(target.status) && (target.artifactsCount ?? 0) > 0)?.runId
    ?? targets[0]?.runId
    ?? "";
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
