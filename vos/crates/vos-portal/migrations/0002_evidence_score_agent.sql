CREATE TABLE pipeline_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    stage_scope TEXT,
    public_summary JSONB,
    retry_of UUID REFERENCES pipeline_runs(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE evidence_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pipeline_run_id UUID NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    kind TEXT NOT NULL,
    suite TEXT NOT NULL,
    case_name TEXT NOT NULL,
    result TEXT NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    log_segment TEXT,
    artifact_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX evidence_project_commit_case_idx
    ON evidence_records(project_id, commit_sha, suite, case_name);

CREATE TABLE evaluation_rubrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    target_kind TEXT NOT NULL,
    target_suite TEXT,
    target_case TEXT,
    weight REAL NOT NULL CHECK (weight >= 0),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rubric_id UUID NOT NULL REFERENCES evaluation_rubrics(id) ON DELETE CASCADE,
    auto_score REAL NOT NULL DEFAULT 0 CHECK (auto_score >= 0),
    manual_score REAL CHECK (manual_score >= 0),
    feedback TEXT,
    is_final BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(project_id, rubric_id)
);

CREATE TABLE agent_audit_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    task_kind TEXT NOT NULL,
    prompt_summary TEXT NOT NULL,
    response_summary TEXT,
    context_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_level TEXT NOT NULL DEFAULT 'low',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_audit_project_created_idx
    ON agent_audit_records(project_id, created_at DESC);

