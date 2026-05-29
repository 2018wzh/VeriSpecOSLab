import { Lock, PencilLine } from "lucide-react";
import type { ProjectOverview, ScoreItem } from "../lib/types";
import { Badge, Button, Panel, PanelHeader } from "./ui";

export function ScoresView({
  project,
  scores
}: {
  project: ProjectOverview;
  scores: ScoreItem[];
}) {
  return (
    <Panel>
      <PanelHeader
        title="Evidence-Linked Scorebook"
        description="Auto scores are recomputed from evidence; manual overrides remain explicit."
        action={
          <Button variant="outline">
            <PencilLine data-icon="inline-start" />
            Manual override
          </Button>
        }
      />
      <div className="p-5">
        <div className="mb-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-border bg-background p-4">
            <div className="text-2xl font-semibold">{project.score_summary.earned}</div>
            <div className="mt-1 text-xs text-muted-foreground">Earned points</div>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="text-2xl font-semibold">{project.score_summary.possible}</div>
            <div className="mt-1 text-xs text-muted-foreground">Possible points</div>
          </div>
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center gap-2 text-2xl font-semibold">
              <Lock data-icon="inline-start" />
              {project.score_summary.finalized ? "Final" : "Draft"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Publication status</div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Rubric</th>
                <th className="px-4 py-3 font-semibold">Auto</th>
                <th className="px-4 py-3 font-semibold">Manual</th>
                <th className="px-4 py-3 font-semibold">Final</th>
                <th className="px-4 py-3 font-semibold">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score) => (
                <tr key={score.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-4 font-medium">{score.rubric_id}</td>
                  <td className="px-4 py-4">{score.auto_score}</td>
                  <td className="px-4 py-4">{score.manual_score ?? "-"}</td>
                  <td className="px-4 py-4">
                    <Badge tone={score.is_final ? "success" : "neutral"}>
                      {score.is_final ? "final" : "draft"}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">{score.feedback ?? "No feedback"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  );
}

