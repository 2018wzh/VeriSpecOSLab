import { Boxes, GitMerge, Shield } from "lucide-react";
import type { StageProgress } from "../lib/types";
import { Badge, Panel, PanelHeader } from "./ui";

export function ArchitectureView({ progress }: { progress?: StageProgress }) {
  const stages = progress?.stages ?? [];
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <Panel>
        <PanelHeader
          title="Architecture Slices"
          description="Current projection from staged architecture and module specs."
        />
        <div className="flex flex-col gap-3 p-5">
          {stages.map((item) => (
            <div key={item.stage.id} className="rounded-md border border-border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Boxes data-icon="inline-start" />
                  <span className="text-sm font-semibold">{item.stage.name}</span>
                </div>
                <Badge tone={item.unlocked ? "info" : "neutral"}>
                  {item.unlocked ? "visible" : "locked"}
                </Badge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Required artifacts: {item.stage.config.required_artifacts.length || 0}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Spec Projection"
          description="Public architecture graph rendered from the course-stage boundary."
        />
        <div className="p-5">
          <div className="grid gap-3 md:grid-cols-3">
            {["ArchitectureSeed", "ModuleSpec", "OperationContract"].map((label) => (
              <div key={label} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Shield data-icon="inline-start" />
                  {label}
                </div>
                <div className="mt-2 text-xs leading-5 text-muted-foreground">
                  Visible to student and Agent according to current StageGate policy.
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-border bg-background p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <GitMerge data-icon="inline-start" />
              Derived dependency path
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {["headers", "boot", "memory", "trap", "process", "syscall"].map((node, index) => (
                <span key={node} className="inline-flex items-center gap-2">
                  <span className="rounded-md border border-border bg-surface px-3 py-2 font-medium">
                    {node}
                  </span>
                  {index < 5 ? <span className="text-muted-foreground">/</span> : null}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

