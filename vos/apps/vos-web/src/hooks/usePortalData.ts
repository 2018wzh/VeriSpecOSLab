import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { portalApi } from "../api/client";

export function usePortalData(enabled: boolean) {
  const user = useQuery({ queryKey: ["me"], queryFn: portalApi.me, enabled });
  const isStaff = ["admin", "teacher", "ta"].includes(user.data?.role ?? "");
  const users = useQuery({ queryKey: ["users"], queryFn: portalApi.users, enabled: enabled && isStaff });
  const courses = useQuery({ queryKey: ["courses"], queryFn: portalApi.courses, enabled });
  const experiments = useQuery({ queryKey: ["experiments"], queryFn: portalApi.experiments, enabled });
  const projects = useQuery({ queryKey: ["projects"], queryFn: portalApi.projects, enabled });

  const activeProject = projects.data?.[0];
  const projectId = activeProject?.project.id;
  const activeExperiment = experiments.data?.[0] ?? (activeProject ? { id: activeProject.project.experiment_id } : undefined);
  const experimentId = activeExperiment?.id;

  const progress = useQuery({
    queryKey: ["progress", projectId],
    queryFn: () => portalApi.progress(projectId!),
    enabled: enabled && Boolean(projectId),
    refetchInterval: 5000
  });
  const evidence = useQuery({
    queryKey: ["evidence", projectId],
    queryFn: () => portalApi.evidence(projectId!),
    enabled: enabled && Boolean(projectId),
    refetchInterval: 5000
  });
  const scores = useQuery({
    queryKey: ["scores", projectId],
    queryFn: () => portalApi.scores(projectId!),
    enabled: enabled && Boolean(projectId)
  });
  const audit = useQuery({
    queryKey: ["audit", projectId],
    queryFn: () => portalApi.audit(projectId!),
    enabled: enabled && Boolean(projectId)
  });
  const teacherRows = useQuery({
    queryKey: ["teacherRows", experimentId],
    queryFn: () => portalApi.teacherRows(experimentId!),
    enabled: enabled && isStaff && Boolean(experimentId)
  });
  const rubrics = useQuery({
    queryKey: ["rubrics", experimentId],
    queryFn: () => portalApi.rubrics(experimentId),
    enabled: enabled && isStaff
  });
  const designSubmissions = useQuery({
    queryKey: ["designSubmissions", projectId],
    queryFn: () => portalApi.designSubmissions(projectId),
    enabled: enabled && isStaff
  });

  const error = [
    user.error,
    users.error,
    courses.error,
    experiments.error,
    projects.error,
    progress.error,
    evidence.error,
    scores.error,
    audit.error,
    teacherRows.error,
    rubrics.error,
    designSubmissions.error
  ].find(Boolean);

  return useMemo(
    () => ({
      user: user.data,
      users: users.data ?? [],
      courses: courses.data ?? [],
      experiments: experiments.data ?? [],
      projects: projects.data ?? [],
      activeProject,
      activeExperiment,
      progress: progress.data,
      evidence: evidence.data ?? [],
      scores: scores.data ?? [],
      audit: audit.data ?? [],
      teacherRows: teacherRows.data ?? [],
      rubrics: rubrics.data ?? [],
      designSubmissions: designSubmissions.data ?? [],
      error,
      loading:
        enabled &&
        (user.isLoading ||
          courses.isLoading ||
          experiments.isLoading ||
          projects.isLoading ||
          (isStaff && users.isLoading))
    }),
    [
      activeExperiment,
      activeProject,
      audit.data,
      audit.error,
      courses.data,
      courses.error,
      courses.isLoading,
      designSubmissions.data,
      designSubmissions.error,
      enabled,
      error,
      evidence.data,
      evidence.error,
      experiments.data,
      experiments.error,
      experiments.isLoading,
      progress.data,
      progress.error,
      projects.data,
      projects.error,
      projects.isLoading,
      rubrics.data,
      rubrics.error,
      scores.data,
      scores.error,
      teacherRows.data,
      teacherRows.error,
      user.data,
      user.error,
      user.isLoading,
      users.data,
      users.error,
      users.isLoading,
      isStaff
    ]
  );
}
