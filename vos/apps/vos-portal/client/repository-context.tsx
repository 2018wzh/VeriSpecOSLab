import { createContext, useContext, type ReactNode } from "react";
import type { PortalRepository } from "../domain/repository.ts";

const RepositoryContext = createContext<PortalRepository | null>(null);
export function RepositoryProvider({ value, children }: { value: PortalRepository; children: ReactNode }) {
  return <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>;
}
export function useRepository(): PortalRepository {
  const value = useContext(RepositoryContext);
  if (!value) throw new Error("PortalRepository is not configured");
  return value;
}
