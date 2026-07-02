import { relativePosixPath } from "vos-platform";

export function relativeProjectPath(from: string, to: string): string {
  return relativePosixPath(from, to);
}
