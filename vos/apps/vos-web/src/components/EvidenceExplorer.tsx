import { FileJson, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { EvidenceRecord } from "../lib/types";
import { Badge, Panel, PanelHeader } from "./ui";

export function EvidenceExplorer({ evidence }: { evidence: EvidenceRecord[] }) {
  const [selectedId, setSelectedId] = useState(evidence[0]?.id);
  const selected = useMemo(
    () => evidence.find((item) => item.id === selectedId) ?? evidence[0],
    [evidence, selectedId]
  );
  const suites = useMemo(() => {
    const groups = new Map<string, EvidenceRecord[]>();
    evidence.forEach((item) => {
      groups.set(item.suite, [...(groups.get(item.suite) ?? []), item]);
    });
    return [...groups.entries()];
  }, [evidence]);

  return (
    <Panel className="min-h-[620px]">
      <PanelHeader
        title="Evidence Explorer"
        description="Structured records from VOS runs, CI uploads, QEMU logs, and trace outputs."
        action={
          <div className="hidden h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground md:flex">
            <Search data-icon="inline-start" />
            suite / case / artifact
          </div>
        }
      />
      <div className="grid min-h-[540px] gap-0 md:grid-cols-[320px_1fr]">
        <div className="border-b border-border md:border-b-0 md:border-r">
          {suites.map(([suite, rows]) => (
            <div key={suite} className="border-b border-border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {suite}
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((item) => (
                  <button
                    key={item.id}
                    className={clsx(
                      "focus-ring rounded-md border px-3 py-2 text-left transition",
                      selected?.id === item.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background hover:bg-muted"
                    )}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.case_name}</span>
                      <ResultBadge result={item.result} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.kind}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-5">
          {selected ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{selected.case_name}</h2>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {selected.suite} / {selected.kind}
                  </div>
                </div>
                <ResultBadge result={selected.result} />
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <FileJson data-icon="inline-start" />
                  Metrics
                </div>
                <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-6 text-slate-100">
                  {JSON.stringify(selected.metrics, null, 2)}
                </pre>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <div className="text-sm font-semibold">Log segment</div>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-6 text-foreground">
                  {selected.log_segment ?? "No public log segment was attached to this evidence item."}
                </pre>
              </div>
              <div className="text-xs text-muted-foreground">
                Artifact: {selected.artifact_uri ?? "not published"}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No evidence records available.
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ResultBadge({ result }: { result: EvidenceRecord["result"] }) {
  if (result === "pass") return <Badge tone="success">pass</Badge>;
  if (result === "fail" || result === "error") return <Badge tone="danger">{result}</Badge>;
  return <Badge tone="neutral">{result}</Badge>;
}

