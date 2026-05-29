import { FormEvent, ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { portalApi } from "../api/client";
import type {
  Course,
  DesignSubmission,
  EvaluationRubric,
  Experiment,
  ProjectOverview,
  TeacherProjectRow,
  User
} from "../lib/types";
import { Badge, Button, Panel, PanelHeader } from "./ui";

export function TeacherAdmin({
  rows,
  courses,
  experiments,
  users,
  projects,
  rubrics,
  designSubmissions
}: {
  rows: TeacherProjectRow[];
  courses: Course[];
  experiments: Experiment[];
  users: User[];
  projects: ProjectOverview[];
  rubrics: EvaluationRubric[];
  designSubmissions: DesignSubmission[];
}) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();
  const createCourse = useMutation({ mutationFn: portalApi.createCourse, onSuccess: invalidate });
  const createExperiment = useMutation({ mutationFn: portalApi.createExperiment, onSuccess: invalidate });
  const createStage = useMutation({
    mutationFn: (body: {
      experiment_id: string;
      key: string;
      name: string;
      sequence: number;
      gate_type: string;
      config: Record<string, unknown>;
    }) => portalApi.createStageGate(body.experiment_id, body),
    onSuccess: invalidate
  });
  const createProject = useMutation({ mutationFn: portalApi.createProject, onSuccess: invalidate });
  const createRubric = useMutation({ mutationFn: portalApi.createRubric, onSuccess: invalidate });
  const updateScore = useMutation({
    mutationFn: (body: { project_id: string; rubric_id: string; manual_score: number; feedback?: string }) =>
      portalApi.updateScore(body.project_id, {
        rubric_id: body.rubric_id,
        manual_score: body.manual_score,
        feedback: body.feedback,
        is_final: false
      }),
    onSuccess: invalidate
  });
  const reviewSubmission = useMutation({
    mutationFn: (body: { id: string; review_status: string; feedback?: string }) =>
      portalApi.updateDesignSubmission(body.id, {
        review_status: body.review_status,
        feedback: body.feedback
      }),
    onSuccess: invalidate
  });

  const progressData = Object.values(
    rows.reduce<Record<string, { stage: string; passed: number; active: number }>>((acc, row) => {
      const stage = row.current_stage.name;
      acc[stage] ??= { stage, passed: 0, active: 0 };
      if (row.latest_pipeline?.status === "passed") {
        acc[stage].passed += 1;
      } else {
        acc[stage].active += 1;
      }
      return acc;
    }, {})
  );
  const failing = rows.filter((row) => row.latest_pipeline?.status === "failed");
  const flagged = rows.filter((row) => row.risk_flags.length > 0);
  const firstCourse = courses[0];
  const firstExperiment = experiments[0];
  const firstProject = projects[0]?.project;
  const studentUsers = users.filter((user) => user.role === "student");

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <Panel>
        <PanelHeader
          title="Student Progress Matrix"
          description="Teacher and TA operational view for real project, evidence, score, and risk data."
          action={
            <Button variant="outline">
              <ClipboardList data-icon="inline-start" />
              Review queue
            </Button>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Student</th>
                <th className="px-5 py-3 font-semibold">Stage</th>
                <th className="px-5 py-3 font-semibold">Pipeline</th>
                <th className="px-5 py-3 font-semibold">Score</th>
                <th className="px-5 py-3 font-semibold">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.project.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-4 font-medium">{row.student.display_name}</td>
                  <td className="px-5 py-4">{row.current_stage.name}</td>
                  <td className="px-5 py-4">
                    <Badge tone={row.latest_pipeline?.status === "passed" ? "success" : "warning"}>
                      {row.latest_pipeline?.status ?? "none"}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    {row.score_summary.earned}/{row.score_summary.possible}
                  </td>
                  <td className="px-5 py-4">
                    {row.risk_flags.length ? (
                      <Badge tone="warning">{row.risk_flags.length} flags</Badge>
                    ) : (
                      <Badge tone="success">clear</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="px-5 py-8 text-center text-muted-foreground" colSpan={5}>
                    No projects are visible in the database.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Stage Distribution" description="Aggregated from teacher project rows." />
          <div className="h-72 p-5">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={progressData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="stage" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="passed" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="active" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Operational Alerts" description="Derived from current project data." />
          <div className="flex flex-col gap-3 p-5">
            <AlertRow
              tone={failing.length ? "warning" : "success"}
              title={failing.length ? "Verification failures" : "No active public failures"}
              detail={failing.length ? `${failing.length} project(s) currently failed.` : "Visible projects have no failed latest pipeline."}
            />
            <AlertRow
              tone={flagged.length ? "warning" : "success"}
              title={flagged.length ? "AI audit flags" : "AI audit clear"}
              detail={flagged.length ? `${flagged.length} project(s) have risk flags.` : "No high-risk audit flags are visible."}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Course Operations" description="Create records in PostgreSQL-backed APIs." />
          <div className="grid gap-4 p-5">
            <CrudForm title="Create Course" onSubmit={(data) => createCourse.mutate({
              code: text(data, "code"),
              name: text(data, "name"),
              term: text(data, "term"),
              description: optionalText(data, "description")
            })}>
              <TextInput name="code" placeholder="Code" />
              <TextInput name="name" placeholder="Name" />
              <TextInput name="term" placeholder="Term" defaultValue="Spring 2026" />
              <TextInput name="description" placeholder="Description" />
            </CrudForm>
            <CrudForm title="Create Experiment" onSubmit={(data) => createExperiment.mutate({
              course_id: text(data, "course_id") || firstCourse?.id || "",
              title: text(data, "title"),
              experiment_type: text(data, "experiment_type") || "os",
              publish_state: "draft",
              spec_version: "draft",
              config: {}
            })}>
              <SelectInput name="course_id" options={courses.map((course) => [course.id, course.code])} />
              <TextInput name="title" placeholder="Title" />
              <TextInput name="experiment_type" placeholder="Type" defaultValue="os" />
            </CrudForm>
            <CrudForm title="Create Stage Gate" onSubmit={(data) => createStage.mutate({
              experiment_id: text(data, "experiment_id") || firstExperiment?.id || "",
              key: text(data, "key"),
              name: text(data, "name"),
              sequence: Number(text(data, "sequence") || "0"),
              gate_type: text(data, "gate_type") || "hybrid",
              config: { required_artifacts: [], required_evidence: [], manual_review_required: false }
            })}>
              <SelectInput name="experiment_id" options={experiments.map((experiment) => [experiment.id, experiment.title])} />
              <TextInput name="key" placeholder="Key" />
              <TextInput name="name" placeholder="Name" />
              <TextInput name="sequence" placeholder="Sequence" defaultValue="0" />
              <TextInput name="gate_type" placeholder="Gate type" defaultValue="hybrid" />
            </CrudForm>
            <CrudForm title="Create Project" onSubmit={(data) => createProject.mutate({
              student_user_id: text(data, "student_user_id"),
              experiment_id: text(data, "experiment_id") || firstExperiment?.id || "",
              repo_url: optionalText(data, "repo_url")
            })}>
              <SelectInput name="student_user_id" options={studentUsers.map((user) => [user.id, user.display_name])} />
              <SelectInput name="experiment_id" options={experiments.map((experiment) => [experiment.id, experiment.title])} />
              <TextInput name="repo_url" placeholder="Repo URL" />
            </CrudForm>
            <CrudForm title="Create Rubric" onSubmit={(data) => createRubric.mutate({
              experiment_id: text(data, "experiment_id") || firstExperiment?.id,
              name: text(data, "name"),
              target_kind: text(data, "target_kind") || "test",
              target_suite: optionalText(data, "target_suite"),
              target_case: optionalText(data, "target_case"),
              weight: Number(text(data, "weight") || "0"),
              description: optionalText(data, "description")
            })}>
              <SelectInput name="experiment_id" options={experiments.map((experiment) => [experiment.id, experiment.title])} />
              <TextInput name="name" placeholder="Name" />
              <TextInput name="target_kind" placeholder="Kind" defaultValue="test" />
              <TextInput name="target_suite" placeholder="Suite" />
              <TextInput name="target_case" placeholder="Case" />
              <TextInput name="weight" placeholder="Weight" defaultValue="10" />
              <TextInput name="description" placeholder="Description" />
            </CrudForm>
            <CrudForm title="Override Score" onSubmit={(data) => updateScore.mutate({
              project_id: text(data, "project_id") || firstProject?.id || "",
              rubric_id: text(data, "rubric_id"),
              manual_score: Number(text(data, "manual_score") || "0"),
              feedback: optionalText(data, "feedback")
            })}>
              <SelectInput name="project_id" options={projects.map((project) => [project.project.id, project.project.repo_url ?? project.project.id])} />
              <SelectInput name="rubric_id" options={rubrics.map((rubric) => [rubric.id, rubric.name])} />
              <TextInput name="manual_score" placeholder="Manual score" />
              <TextInput name="feedback" placeholder="Feedback" />
            </CrudForm>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Design Review Queue" description="Review persisted design submissions." />
          <div className="flex flex-col gap-3 p-5">
            {designSubmissions.map((submission) => (
              <div key={submission.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{submission.commit_sha}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{submission.review_status}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => reviewSubmission.mutate({ id: submission.id, review_status: "approved" })}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => reviewSubmission.mutate({ id: submission.id, review_status: "rejected" })}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ))}
            {!designSubmissions.length ? <div className="text-sm text-muted-foreground">No design submissions.</div> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AlertRow({ tone, title, detail }: { tone: "success" | "warning"; title: string; detail: string }) {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex gap-3 rounded-md border p-3 ${tone === "success" ? "border-success/30 bg-success/10" : "border-warning/30 bg-warning/10"}`}>
      <Icon className={tone === "success" ? "text-success" : "text-warning"} data-icon="inline-start" />
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function CrudForm({
  title,
  children,
  onSubmit
}: {
  title: string;
  children: ReactNode;
  onSubmit: (data: FormData) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget));
    event.currentTarget.reset();
  }
  return (
    <form className="rounded-md border border-border bg-background p-3" onSubmit={submit}>
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
      <Button className="mt-3" variant="outline">Save</Button>
    </form>
  );
}

function TextInput({ name, placeholder, defaultValue }: { name: string; placeholder: string; defaultValue?: string }) {
  return (
    <input
      className="h-9 rounded-md border border-border bg-surface px-3 text-sm"
      defaultValue={defaultValue}
      name={name}
      placeholder={placeholder}
    />
  );
}

function SelectInput({ name, options }: { name: string; options: Array<[string, string]> }) {
  return (
    <select className="h-9 rounded-md border border-border bg-surface px-3 text-sm" name={name}>
      <option value="">Select</option>
      {options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

function text(data: FormData, name: string) {
  return String(data.get(name) ?? "").trim();
}

function optionalText(data: FormData, name: string) {
  const value = text(data, name);
  return value ? value : undefined;
}
