import { Bot, Flag, MessagesSquare } from "lucide-react";
import type { AgentAuditRecord } from "../lib/types";
import { Badge, Panel, PanelHeader } from "./ui";

export function AuditView({ audit }: { audit: AgentAuditRecord[] }) {
  return (
    <Panel>
      <PanelHeader
        title="AI Collaboration Audit"
        description="OpenAI-compatible gateway requests are attached to project, stage, policy, and risk markers."
      />
      <div className="flex flex-col gap-3 p-5">
        {audit.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Bot data-icon="inline-start" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{item.task_kind}</span>
                    <Badge tone={item.risk_level === "low" ? "success" : "warning"}>
                      {item.risk_level}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.model}</div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{item.created_at}</div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border bg-surface p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <MessagesSquare data-icon="inline-start" />
                  Prompt
                </div>
                <p className="mt-2 text-sm leading-6">{item.prompt_summary}</p>
              </div>
              <div className="rounded-md border border-border bg-surface p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Flag data-icon="inline-start" />
                  Response / risk
                </div>
                <p className="mt-2 text-sm leading-6">
                  {item.response_summary ?? "No response summary captured."}
                </p>
                {item.risk_flags.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.risk_flags.map((flag) => (
                      <Badge key={flag} tone="warning">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

