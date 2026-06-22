# Headless Profile API

VOS Agent has two headless surfaces:

- A package API from `vos-agent/headless`, used by `vos-cli` and local
  TypeScript integrations.
- A VOS-native HTTP API served by `vos-agent serve` or
  `startAgentHttpServer(...)`, used by the `vos-portal` frontend (prototype:
  `vos-web`) and local tools.

The public API deliberately does **not** expose VOS Role objects.
Task-to-profile resolution is VOS-owned and may change without breaking
`vos-portal` frontend, CLI, or third-party callers. External callers pass task
context and, when needed, an explicit task profile containing the
capabilities the receiver needs:

```ts
type AgentTaskProfile = {
  promptId: string;
  systemPrompt: string;
  mode: string;
  skills: string[];
  mcpServers: string[];
  outputSchema: string;
};
```

The receiver decides how to interpret that profile. In the current VOS
Agent implementation, the profile is used to build the fixed system
prompt, choose the default mode, constrain tools, advertise skill/MCP
intent, and annotate the prompt envelope.

## Boundary

The boundary is:

```text
caller
  -> task_kind + requested_scope + task + context
  -> optional agent_profile override
  -> VOS Agent resolves an AgentTaskProfile
  -> runSessionTurn
  -> content + structured_output + events + agent_profile
```

The boundary is **not**:

```text
caller -> role_id / runtime_role / course_persona
```

Those remain internal implementation details.

## Internal Mapping

VOS keeps an internal mapping from task kinds to default profiles in
[app/agent/profiles.ts](../app/agent/profiles.ts). Callers should depend
only on the public `AgentTaskProfile` fields.

Default public profiles are resolved from `taskKind`:

| Task kind examples                       | Default prompt id        | Mode    | Skills                                     | MCP servers                    | Output schema             |
|------------------------------------------|--------------------------|---------|--------------------------------------------|--------------------------------|---------------------------|
| `plan`, `design_review`, `spec_revision` | `spec-assistant.v1`      | `deep`  | `os-spec-authoring`                        | `spec-index`, `course-kb`      | `spec_revision_draft.v1`  |
| `codegen`, `skeleton_generation`         | `spec-compiler.v1`       | `deep`  | `operation-codegen`                        | `spec-index`                   | `spec_compiler_output.v1` |
| `debug`, `explain_log`, `failure_triage` | `debug-agent.v1`         | `smart` | `verification-diagnosis`                   | `evidence-store`, `spec-index` | `debug_output.v1`         |
| `knowledgebase_qa`, `reference_lookup`   | `knowledgebase.v1`       | `smart` | `reference-policy`, `teaching-explanation` | `vos-kb`, `course-kb`, `spec-index` | `knowledgebase_answer.v1` |
| `validate`, `review_patch`               | `spec-validator.v1`      | `deep`  | `verification-diagnosis`, `audit-review`   | `spec-index`, `evidence-store` | `validator_feedback.v1`   |

Callers can override public profile fields with `agentProfile` /
`agent_profile`. Overrides do not expose or mutate the internal role.

For `knowledgebase_qa`, `vos-cli` injects a local `vos-kb` stdio MCP server via
`extraMcpServers`. `vos-cli` resolves the project OpenAI-compatible embedding
config and passes only the needed base URL/model/token to that process. The
server reads the project `.vos/kb/` registry and sqlite-vec index, exposes
`kb_search`, `kb_lookup`, `kb_list_sources`, `kb_add_source`,
`kb_remove_source`, and `kb_clear`, and keeps Portal as a control plane rather
than a workspace tool runtime.

## Package API

Import from `vos-agent/headless`:

```ts
import {
  resolveAgentTaskProfile,
  runAgentTask,
  runHeadlessAgentPrompt,
  startAgentHttpServer,
} from "vos-agent/headless";
```

### `resolveAgentTaskProfile(options)`

Returns the public profile VOS Agent would use for a task.

```ts
const profile = resolveAgentTaskProfile({
  taskKind: "debug",
});

console.log(profile.promptId);      // debug-agent.v1
console.log(profile.skills);        // ["verification-diagnosis"]
console.log(profile.mcpServers);    // ["evidence-store", "spec-index"]
```

Use this when a UI or wrapper needs to show or forward the prompt,
skills, MCP servers, schema, or mode without exposing internal role
state.

You can apply an override:

```ts
const profile = resolveAgentTaskProfile({
  taskKind: "explain_concept",
  agentProfile: {
    promptId: "knowledgebase.v1",
    skills: ["teaching-explanation", "reference-policy"],
    mcpServers: ["vos-kb", "course-kb"],
    outputSchema: "knowledgebase_answer.v1",
  },
});
```

### `runAgentTask(request)`

Primary course-aware package API.

```ts
const result = await runAgentTask({
  projectRoot: "/path/to/project",
  taskKind: "debug",
  requestedScope: "agent.debug",
  task: "Explain why the latest QEMU run failed.",
  contextRefs: [".vos/runs/latest/manifest.json"],
  allowedVosCommands: ["build", "verify public", "run qemu"],
  courseMode: true,
});

console.log(result.threadId);
console.log(result.agentProfile.outputSchema);
console.log(result.content);
console.log(result.structuredOutput);
```

Request fields:

| Field                          | Purpose                                                                            |
|--------------------------------|------------------------------------------------------------------------------------|
| `projectRoot`                  | Workspace root. Threads, settings, plugins, and tools are scoped here.             |
| `task`                         | User-visible task text.                                                            |
| `taskKind`                     | Public task kind such as `debug`, `codegen`, or `explain_concept`.                 |
| `requestedScope`               | Caller-defined scope such as `agent.generate`.                                     |
| `agentProfile`                 | Optional public profile override: prompt, skills, MCP servers, schema, mode.       |
| `context`                      | Structured context bundle. This is serialized into the prompt envelope.            |
| `contextRefs` / `evidenceRefs` | References to local context/evidence artifacts.                                    |
| `allowedPaths`                 | Paths the outer runtime allows this task to discuss or propose changes for.        |
| `requiredValidations`          | Validation names expected before accepting output.                                 |
| `policyFlags`                  | Policy snapshot markers for audit and prompt context.                              |
| `promptOverride`               | Compatibility escape hatch. Uses an already-built prompt as the user prompt.       |
| `model` / `mode`               | Optional model override. If omitted, the resolved profile mode is used.            |
| `threadId`                     | Continue an existing local thread.                                                 |
| `courseMode`                   | Defaults to `true`; hides direct write/edit tools in profile-based runs.           |
| `allowedVosCommands`           | Project policy whitelist. Intersected with internal tool policy.                   |
| `toolPolicy`                   | Additional caller-supplied tool policy. Composed with the internal profile policy. |
| `onEvent`                      | Receives session events from `runSessionTurn`.                                     |

Result fields:

| Field                                | Purpose                                                                                              |
|--------------------------------------|------------------------------------------------------------------------------------------------------|
| `content`                            | Final assistant text.                                                                                |
| `structuredOutput`                   | Best-effort JSON parsed from `content`. Schema validation remains the caller/runtime responsibility. |
| `events`                             | Raw `SessionEvent[]`.                                                                                |
| `threadId`                           | Local VOS thread id.                                                                                 |
| `agentProfile`                       | Public profile used for the run.                                                                     |
| `model` / `mode` / `reasoningEffort` | Concrete model settings used for the run.                                                            |
| `prompt`                             | Final user prompt/envelope sent to the session layer.                                                |

### `runHeadlessAgentPrompt(request)`

Compatibility API. It runs a prompt without resolving a task profile.

```ts
const result = await runHeadlessAgentPrompt({
  projectRoot: "/path/to/project",
  prompt: "Summarize README.md",
  mode: "smart",
});
```

Use this for older integrations or simple local automation. New
course-aware wrappers should use `runAgentTask()`.

### `startAgentHttpServer(options)`

Starts the HTTP gateway and portal API:

```ts
const server = startAgentHttpServer({
  projectRoot: "/path/to/project",
  host: "127.0.0.1",
  port: 8787,
});

console.log(server.url);
```

The returned server hosts:

- `/health`
- `/v1/models`
- `/v1/chat/completions`
- `/api/v1/agent/profile`
- `/api/v1/agent/tasks`
- `/api/v1/agent/sessions/:id`
- `/api/v1/agent/sessions/:id/turns`
- the VOS portal REST API under `/api/v1/...`

## HTTP API

Start the server:

```sh
vos-agent serve --host 127.0.0.1 --port 8787
```

or through the CLI wrapper:

```sh
vos agent serve --host 127.0.0.1 --port 8787
```

### `POST /api/v1/agent/profile`

Returns the public profile for a task kind and optional override.

```sh
curl -s http://127.0.0.1:8787/api/v1/agent/profile \
  -H 'Content-Type: application/json' \
  -d '{"task_kind":"debug"}'
```

Response:

```json
{
  "agent_profile": {
    "promptId": "debug-agent.v1",
    "systemPrompt": "You are VOS Agent running a fixed VOS task profile...",
    "mode": "smart",
    "skills": ["verification-diagnosis"],
    "mcpServers": ["evidence-store", "spec-index"],
    "outputSchema": "debug_output.v1"
  }
}
```

### `POST /api/v1/agent/tasks`

Runs one profile-based task.

```sh
curl -s http://127.0.0.1:8787/api/v1/agent/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "project_id": "project-demo-student",
    "user_id": "student-demo",
    "task_kind": "debug",
    "task": "Explain the latest boot failure.",
    "allowed_vos_commands": ["build", "verify public", "run qemu"]
  }'
```

Response:

```json
{
  "session_id": "VOS-...",
  "thread_id": "VOS-...",
  "agent_profile": {
    "promptId": "debug-agent.v1",
    "systemPrompt": "You are VOS Agent running a fixed VOS task profile...",
    "mode": "smart",
    "skills": ["verification-diagnosis"],
    "mcpServers": ["evidence-store", "spec-index"],
    "outputSchema": "debug_output.v1"
  },
  "model": "opus4.7",
  "mode": "smart",
  "content": "{...}",
  "structured_output": {},
  "events": []
}
```

HTTP task fields use snake_case equivalents of the package API:

| HTTP field             | Package field         |
|------------------------|-----------------------|
| `task_kind`            | `taskKind`            |
| `requested_scope`      | `requestedScope`      |
| `agent_profile`        | `agentProfile`        |
| `context_refs`         | `contextRefs`         |
| `evidence_refs`        | `evidenceRefs`        |
| `allowed_paths`        | `allowedPaths`        |
| `required_validations` | `requiredValidations` |
| `policy_flags`         | `policyFlags`         |
| `allowed_vos_commands` | `allowedVosCommands`  |
| `thread_id`            | `threadId`            |
| `max_iterations`       | `maxIterations`       |
| `disabled_tools`       | `disabledTools`       |
| `course_mode`          | `courseMode`          |

Streaming HTTP task responses are not implemented yet. Requests with
`stream: true` return a structured error.

### Session endpoints

Continue an existing thread:

```http
POST /api/v1/agent/sessions/{sessionId}/turns
```

The body is the same as `/api/v1/agent/tasks`; the path supplies
`thread_id`.

Inspect thread metadata:

```http
GET /api/v1/agent/sessions/{sessionId}
```

This returns title, timestamps, model/mode metadata, message count, and
thread todos. It does not return the full transcript.

## `vos-portal` Frontend Usage

`vos-portal` frontend (`vos-web` prototype) exposes typed helpers in
[src/api/client.ts](../../vos-web/src/api/client.ts):

```ts
const profile = await portalApi.resolveAgentProfile({
  task_kind: "explain_concept",
});

const response = await portalApi.runAgentTask({
  project_id: projectId,
  user_id: user.id,
  task_kind: "explain_concept",
  task: "Explain how trap return differs from syscall dispatch.",
  agent_profile: profile,
});

console.log(response.agent_profile.skills);
console.log(response.structured_output);
```

The frontend should pick:

- `task_kind` from the concrete UI action, not from free-form user text.
- `agent_profile` only when the UI or platform intentionally overrides
  prompt, skills, MCP servers, output schema, or mode.

The frontend should not know or send VOS internal role names.

## CLI Wrapper Usage

`vos-cli` calls the same package API through
[app/agent/runner.ts](../../vos-cli/app/agent/runner.ts).

Current command mapping:

| CLI command          | Task kind |
|----------------------|-----------|
| `vos agent plan`     | `plan`    |
| `vos agent generate` | `codegen` |
| `vos agent debug`    | `debug`   |

The deterministic CLI wrapper still owns:

- `ContextBundle` construction.
- Policy and allowed-path collection.
- Patch application and validation gates.
- Evidence and `AICollaborationLog` writes.

The model never becomes the patch gate. It returns a structured proposal
that deterministic `vos` commands inspect and apply.

## Tool Policy

The public profile does not expose the exact tool policy. VOS maps a
task profile to an internal tool policy before the turn. In profile-based
course runs, `courseMode` defaults to `true`.

Course mode:

- Allows read/search tools plus task-approved `Vos` commands.
- Hides direct `Write` and `Edit`.
- Uses `Vos` instead of free shell execution.
- Intersects project policy commands with internal command intent.
- Blocks recursive `vos agent ...` calls through the `Vos` tool.

Examples:

- `task_kind: "debug"` may use `build`, `verify public`, and `run qemu`
  if the project policy also allows those intents.
- `task_kind: "codegen"` may use `spec lint`, `arch lint`, `build`,
  and `verify public`.
- `task_kind: "explain_concept"` is reference-focused and does not
  expose `Vos` by default.

Tool denials are returned as tool-result text so the model can recover
inside the normal loop.

## Audit

HTTP task runs record portal audit entries when `project_id` refers to
a known portal project.

The audit record includes:

- `session_id`
- `user_id`
- `project_id`
- `model`
- `task_kind`
- prompt and response summaries
- `risk_flags`
- derived `risk_level`

Risk flags are collected from `structured_output.risk_flags` when the
model returns JSON. The platform can later harden this into schema
validation per `outputSchema`; the current API deliberately keeps
parsing best-effort and leaves final acceptance to deterministic gates.

## Compatibility

Existing callers can keep using:

- `runHeadlessAgentPrompt(...)`
- `vos-agent -p "..."`.
- `vos-agent --stream-json -p "..."`.
- `/v1/chat/completions`.

Those surfaces are prompt-level compatibility APIs. They do not resolve
an `AgentTaskProfile` and should not be used for new course-aware task
features.

## Common Patterns

### Debug skill

```ts
await runAgentTask({
  projectRoot,
  taskKind: "debug",
  task: logText,
  evidenceRefs: [logRef],
  allowedVosCommands: ["build", "verify public", "run qemu"],
});
```

### Teaching/reference skill

```ts
await runAgentTask({
  projectRoot,
  taskKind: "explain_concept",
  task: "Explain copyin/copyout without giving a full solution.",
  agentProfile: {
    skills: ["teaching-explanation", "reference-policy"],
    mcpServers: ["course-kb"],
  },
});
```

### Spec-bound codegen

```ts
await runAgentTask({
  projectRoot,
  taskKind: "codegen",
  task: "Generate the syscall stage patch proposal.",
  context: contextBundle,
  allowedPaths: contextBundle.allowed_paths,
  policyFlags: contextBundle.policy_flags,
  allowedVosCommands: ["spec lint", "arch lint", "build", "verify public"],
});
```
