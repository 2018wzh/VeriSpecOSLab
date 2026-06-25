# KnowledgeBaseAgent v1 Design

## 1. Purpose

KnowledgeBaseAgent is the student-facing design Q&A role for VeriSpecOSLab. It helps students interpret the current experiment, stage gate, spec clauses, public evidence, course manuals, and approved reference material before they write or modify code.

It is not a patch generator. It may show small illustrative snippets, command suggestions, and design tradeoffs, but it must not produce complete modules, full patches, hidden-test guesses, or staff-only rubric content.

## 2. Identity

```yaml
agent_identity:
  id: knowledgebase.v1
  role_prompt_id: knowledgebase.v1
  capability_pack_id: readonly-knowledgebase.v1
  default_task_kinds:
    - knowledgebase_qa
    - reference_lookup
    - explain_concept
    - compare_design
```

`knowledgebase.v1` replaces the earlier prototype profile `knowledgebase-agent.v1`. It is a formal AgentIdentity and is selected by `vos agent ask`.

## 3. Teaching Contract

KnowledgeBaseAgent answers must be tied to the active experiment stage:

- name the current stage/spec scope when available
- identify the design goal being protected
- cite local KB sources, course docs, spec files, public evidence, or web snapshots
- recommend next design checks before implementation
- avoid bypassing the learning objective with a complete solution

The success criterion is not answer fluency. The answer is acceptable when it helps the student reach the stage's design objective and preserves the teaching effect.

## 4. Knowledge Sources

The KB source set is intentionally small and auditable:

| Source kind | Examples | Storage |
| --- | --- | --- |
| `course` | lecture notes, lab handout, course manual | object store + local KB index |
| `project` | `spec/`, public `.vos` evidence, selected code files | local workspace, optionally mirrored as object refs |
| `external` | approved web references, standards, manual pages | object store snapshot + source URL |

Student-added project KB sources are local to the project unless staff promotes them. Web search is allowed in this design, and complete context may be sent to the search/model provider, but the request and fetched snapshot must be audited.

## 5. vos-kb Module

`vos-kb` is the shared KB module used by `vos-cli`, `vos-agent`, and the Portal prototype. The v1 implementation is deliberately boring but complete for local/runner replay:

- local registry: `.vos/kb/sources.json`
- local vector index: `.vos/kb/vectors.sqlite`
- local chunk metadata: `.vos/kb/index.json`
- local cached content: `.vos/kb/objects/`
- deterministic ids derived from source path/URL and content hash
- sqlite-vec retrieval over paragraph/title chunks
- OpenAI-compatible embeddings configured by `vos-cli`
- file, recursive directory, codebase, HTTP/HTTPS snapshot, PDF, Word, and PPT ingestion
- object refs and object manifest import/export for runner replay

Vector rows are local runtime artifacts. Object manifests export sources and cached object content; runner import rebuilds the sqlite-vec index using the project embedding configuration.

## 6. CLI Surface

```sh
vos agent ask [-i|--interactive] [--stage <stage>] [--scope <scope>] [question]
vos kb add <path-or-url> [--source-kind course|project|external] [--stage <stage>] [--title <title>] [--recursive] [--manifest <path>]
vos kb list
vos kb search <query>
vos kb remove <source-id>
vos kb clear
vos kb export-manifest [--out <path>]
vos kb import-manifest <path>
```

Embedding configuration is owned by `vos-cli` in `.vos/config.toml`:

```toml
[kb.embedding]
provider = "openai-compatible"
model = "text-embedding-3-small"
base_url = "https://api.openai.com/v1"

[kb.embedding.auth]
env = "OPENAI_API_KEY"
```

If `[kb.embedding]` is absent, `vos-cli` may reuse an OpenAI-compatible `[agent]` provider. `vos-kb` receives an explicit embedder/config from `vos-cli`; it does not discover credentials itself.

`vos agent ask <question>` builds the normal Agent context bundle, adds the current stage/spec projection, attaches KB search hints and object manifest, injects the local `vos-kb` MCP server, and calls `vos-agent` with task kind `knowledgebase_qa`. Its output is validated against `knowledgebase_answer.v1`.

`vos agent ask` without a question starts a controlled teaching REPL. `vos agent ask -i <question>` answers the first question and then stays open for follow-up turns. The REPL keeps the `knowledgebase.v1` profile fixed across turns, disables `/mode` and project slash commands, and keeps only `/help`, `/quit`, `/new`, `/thread`, and `/todos`.

This is intentionally different from finite `vos agent ... -i` commands such as `agent plan -i`, where `-i` means readonly TUI flow display rather than a prompt-accepting REPL.

The `vos kb` commands manage only the local project KB. They do not change course-global KB state.

## 7. MCP Knowledge Service

The target MCP server is `vos-kb`. It exposes:

- `kb_search({ query, stage_key?, limit? })`
- `kb_lookup({ id })`
- `kb_add_source({ uri, source_kind, stage_key?, title?, recursive? })`
- `kb_list_sources({ source_kind? })`
- `kb_remove_source({ id })`
- `kb_clear({})`

`knowledgebase.v1` may call readonly file tools, `WebSearch`, `WebFetch`, and `vos-kb` MCP tools. It must not call write tools or patch tools.

## 8. Answer Schema

```json
{
  "answer": "student-readable answer",
  "stage_key": "memory-management",
  "design_goal_alignment": ["allocator invariant", "public evidence target"],
  "citations": [
    { "source_id": "kb-...", "title": "Memory Lab Manual", "object_ref": "s3://..." }
  ],
  "suggested_next_steps": ["update ModuleSpec invariant", "run vos verify public --stage memory-management"],
  "allowed_snippets": ["short illustrative snippet only"]
}
```

## 9. Portal And Object Storage

Portal adds a Q&A page for project/stage-bound design help. The Portal stores question threads, citations, and uploaded/reference files as object refs. It does not execute workspace tools.

Cloud runner replay uses an object manifest:

```json
{
  "objects": [
    {
      "id": "obj-memory-manual",
      "uri": "s3://vos-demo/course/memory-manual.md",
      "sha256": "...",
      "content_type": "text/markdown",
      "size": 1234,
      "visibility": "student"
    }
  ]
}
```

Runner setup restores those refs into `.vos/kb/` and rebuilds `.vos/kb/vectors.sqlite` before running `vos agent ask` or verification. This makes Q&A context reproducible without making Portal a workspace Agent runtime.

## 10. Governance

Every Q&A turn records:

- `agent_identity_id: knowledgebase.v1`
- `task_kind: knowledgebase_qa`
- project id, stage key, user id
- source ids/object refs used
- web search URLs or snapshots used
- risk flags
- answer summary

Student-visible audit contains source and boundary summaries. Staff-visible audit may include full prompt/context if policy permits.

## 11. Implementation Status

The v1 local/runner replay contract is implemented in the Bun workspace:

- `packages/vos-kb` owns ingestion, sqlite-vec retrieval, chunk/citation metadata, object manifest import/export, and the `vos-kb` stdio MCP server.
- `apps/vos-cli` owns `vos kb ...`, `vos agent ask`, schema validation, evidence artifacts, and `vos serve` runner endpoints.
- `apps/vos-agent` owns the `knowledgebase.v1` profile and Portal demo APIs for KB sources, object manifests, Q&A threads, and audit ingestion.
- `apps/vos-web`（`vos-portal` prototype） owns the Q&A prototype view and local object/source fixtures.

The v1 implementation intentionally does not include a real S3/OSS backend, OCR, or local embedding fallback. Those are adapters behind the same manifest and search contracts.
