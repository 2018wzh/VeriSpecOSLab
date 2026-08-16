import { createContext, useContext, type ReactNode } from "react";
import type { PortalRole } from "vos-core/portal-contracts";

export type PortalScope = {
  role: PortalRole;
  courseId?: string;
  projectId?: string;
};

const ScopeContext = createContext<PortalScope | null>(null);

export function PortalScopeProvider({ scope, children }: { scope: PortalScope; children: ReactNode }) {
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function usePortalScope(): PortalScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("Portal scope is not available");
  return scope;
}

export function portalQueryKey(scope: PortalScope, ...segments: unknown[]) {
  return [
    "portal",
    scope.role,
    scope.courseId ?? "no-course",
    scope.projectId ?? "no-project",
    ...segments,
  ] as const;
}
