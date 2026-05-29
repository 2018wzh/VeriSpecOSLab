import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  ChevronDown,
  ClipboardCheck,
  GitBranch,
  GraduationCap,
  LayoutDashboard,
  ShieldCheck
} from "lucide-react";
import { clsx } from "clsx";
import type { Course, User } from "../lib/types";
import { Button } from "./ui";

export type ViewKey = "dashboard" | "architecture" | "evidence" | "audit" | "teacher" | "scores";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof LayoutDashboard }> = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "architecture", label: "Architecture", icon: Boxes },
  { key: "evidence", label: "Evidence", icon: Activity },
  { key: "audit", label: "Agent Audit", icon: Bot },
  { key: "teacher", label: "Teacher Admin", icon: ClipboardCheck },
  { key: "scores", label: "Scores", icon: BarChart3 }
];

export function AppShell({
  activeView,
  onViewChange,
  user,
  course,
  isStaff = false,
  children
}: {
  activeView: ViewKey;
  onViewChange: (view: ViewKey) => void;
  user?: User;
  course?: Course;
  isStaff?: boolean;
  children: React.ReactNode;
}) {
  const visibleNavItems = navItems.filter((item) => item.key !== "teacher" || isStaff);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck data-icon="inline-start" />
          </div>
          <div>
            <div className="text-sm font-semibold">VOS Portal</div>
            <div className="text-xs text-muted-foreground">SpecLab Course Ops</div>
          </div>
        </div>
        <nav className="mt-8 flex flex-col gap-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={clsx(
                  "focus-ring flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                  activeView === item.key
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                onClick={() => onViewChange(item.key)}
              >
                <Icon data-icon="inline-start" />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-8 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <GitBranch data-icon="inline-start" />
            Active adapter
          </div>
          <div className="mt-2 text-sm font-semibold">local-vos-os</div>
          <div className="mt-1 text-xs text-muted-foreground">Replaceable Gitea/Runner/Agent boundary</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <GraduationCap data-icon="inline-start" />
                {course?.code ?? "VOS-2026"} / {course?.term ?? "Spring 2026"}
              </div>
              <h1 className="mt-1 truncate text-lg font-semibold text-foreground">
                {course?.name ?? "VeriSpecOSLab Operating Systems"}
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline">
                {user?.display_name ?? "Demo Student"}
                <ChevronDown data-icon="inline-end" />
              </Button>
            </div>
          </div>
        </header>
        <div className="px-4 py-5 lg:px-6">{children}</div>
      </main>
    </div>
  );
}
