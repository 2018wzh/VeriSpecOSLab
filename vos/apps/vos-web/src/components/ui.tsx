import { clsx } from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost" }) {
  return (
    <button
      className={clsx(
        "focus-ring inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        variant === "outline" &&
          "border border-border bg-surface text-foreground hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={clsx("rounded-lg border border-border bg-surface shadow-panel", className)}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action ? (
        <div className="flex w-full min-w-0 shrink-0 justify-start sm:w-auto sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
          {action}
        </div>
      ) : null}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-primary/10 text-primary"
      )}
    >
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-3">
      <div
        className={clsx(
          "text-lg font-semibold",
          tone === "neutral" && "text-foreground",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-destructive"
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
