import { AlertTriangle, ArrowRight, CheckCircle2, GitCommit, PlayCircle } from "lucide-react";
import type { EvidenceRecord, ProjectOverview, ScoreItem, StageProgress } from "../lib/types";
import { Badge, Button, Metric, Panel, PanelHeader } from "./ui";
import { StageStepper } from "./StageStepper";

export function Dashboard({
  project,
  progress,
  evidence,
  scores,
  onOpenEvidence
}: {
  project: ProjectOverview;
  progress?: StageProgress;
  evidence: EvidenceRecord[];
  scores: ScoreItem[];
  onOpenEvidence: () => void;
}) {
  const latest = project.latest_pipeline;
  const failing = evidence.filter((item) => item.result === "fail" || item.result === "error");
  const scorePercent =
    project.score_summary.possible > 0
      ? Math.round((project.score_summary.earned / project.score_summary.possible) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <PanelHeader
          title="Student Project"
          description="Stage gates enforce design-first implementation and evidence-backed progress."
          action={
            <Button>
              <PlayCircle data-icon="inline-start" />
              Trigger public verify
            </Button>
          }
        />
        <div className="flex flex-col gap-5 p-5">
          <StageStepper progress={progress} />
          <div className="grid gap-4 md:grid-cols-4">
            <Metric label="Current stage" value={project.current_stage.name} />
            <Metric
              label="Latest run"
              value={latest?.status ?? "none"}
              tone={latest?.status === "passed" ? "success" : "warning"}
            />
            <Metric label="Auto score" value={`${scorePercent}%`} tone="success" />
            <Metric label="Open failures" value={String(failing.length)} tone={failing.length ? "danger" : "success"} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel>
          <PanelHeader
            title="Latest Verification"
            description="Public summary from the most recent VOS pipeline run."
            action={<Badge tone={latest?.status === "passed" ? "success" : "warning"}>{latest?.status ?? "idle"}</Badge>}
          />
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-3 rounded-md border border-border bg-background p-4">
              {failing.length ? (
                <AlertTriangle className="mt-1 text-warning" data-icon="inline-start" />
              ) : (
                <CheckCircle2 className="mt-1 text-success" data-icon="inline-start" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {latest?.public_summary?.message ?? "No pipeline has published evidence yet."}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <GitCommit data-icon="inline-start" />
                    {latest?.commit_sha ?? project.project.last_commit_sha ?? "uncommitted"}
                  </span>
                  <span>{latest?.stage_scope ?? project.current_stage.key}</span>
                  <span>{latest?.public_summary?.passed ?? 0} passed</span>
                  <span>{latest?.public_summary?.failed ?? 0} failed</span>
                </div>
              </div>
            </div>
            <Button variant="outline" onClick={onOpenEvidence}>
              Open evidence explorer
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Score Items" description="Automatic scoring remains evidence-linked." />
          <div className="flex flex-col gap-3 p-5">
            {scores.map((score) => (
              <div key={score.id} className="flex items-center justify-between gap-4 rounded-md border border-border bg-background px-3 py-3">
                <div>
                  <div className="text-sm font-semibold">{score.rubric_id.replace("rubric-", "")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{score.feedback ?? "No feedback yet"}</div>
                </div>
                <Badge tone={score.auto_score > 0 ? "success" : "warning"}>
                  {score.manual_score ?? score.auto_score}
                </Badge>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

