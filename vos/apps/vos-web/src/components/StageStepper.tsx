import { Check, Lock, Timer } from "lucide-react";
import { clsx } from "clsx";
import type { StageProgress } from "../lib/types";

export function StageStepper({ progress }: { progress?: StageProgress }) {
  const stages = progress?.stages ?? [];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
      {stages.map((item) => {
        const active = item.stage.id === progress?.current_stage.id;
        const Icon = item.passed ? Check : item.unlocked ? Timer : Lock;
        return (
          <div
            key={item.stage.id}
            className={clsx(
              "rounded-lg border px-3 py-3",
              active ? "border-primary bg-primary/5" : "border-border bg-background",
              !item.unlocked && "opacity-65"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div
                className={clsx(
                  "flex size-7 items-center justify-center rounded-md",
                  item.passed && "bg-success/10 text-success",
                  active && !item.passed && "bg-primary/10 text-primary",
                  !item.unlocked && "bg-muted text-muted-foreground"
                )}
              >
                <Icon data-icon="inline-start" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {String(item.stage.sequence + 1).padStart(2, "0")}
              </span>
            </div>
            <div className="mt-3 text-sm font-semibold">{item.stage.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {item.passed
                ? "Passed"
                : item.unlocked
                  ? item.manual_review_status ?? "Active"
                  : "Locked"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

