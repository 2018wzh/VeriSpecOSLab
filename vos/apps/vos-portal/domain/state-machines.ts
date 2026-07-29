export type CourseState = "draft" | "published" | "active" | "grading" | "appeal" | "closed" | "archived";
export type ProjectState = "provisioning" | "active" | "frozen" | "graded" | "archived";

const courseTransitions: Record<CourseState, readonly CourseState[]> = {
  draft: ["published"], published: ["active"], active: ["grading"], grading: ["appeal"],
  appeal: ["closed"], closed: ["archived"], archived: [],
};
const projectTransitions: Record<ProjectState, readonly ProjectState[]> = {
  provisioning: ["active"], active: ["frozen"], frozen: ["graded"], graded: ["archived"], archived: [],
};

export function transitionCourse(from: CourseState, to: CourseState): CourseState {
  if (!courseTransitions[from].includes(to)) throw new Error(`invalid course transition: ${from} -> ${to}`);
  return to;
}

export function transitionProject(from: ProjectState, to: ProjectState): ProjectState {
  if (!projectTransitions[from].includes(to)) throw new Error(`invalid project transition: ${from} -> ${to}`);
  return to;
}
