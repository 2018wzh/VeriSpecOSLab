import type { CommandStatus } from "./types.ts";

export class CliError extends Error {
  public readonly status: CommandStatus;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, status: CommandStatus, details?: Record<string, unknown>) {
    super(message);
    this.name = "CliError";
    this.status = status;
    this.details = details;
  }
}

export class PolicyBlockedError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "failed", details);
    this.name = "PolicyBlockedError";
  }
}

export class ValidationFailedError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "failed", details);
    this.name = "ValidationFailedError";
  }
}

export class AgentOutputError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "failed", details);
    this.name = "AgentOutputError";
  }
}

export class SpecError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "failed", details);
    this.name = "SpecError";
  }
}
