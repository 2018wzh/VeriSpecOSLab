# Agent Identity And Capability Model

This directory is the single target-state Agent design for SpecLab and
VeriSpecOSLab. The previous split-agent design was removed by
[`ADR-001-agent-identity-capability-refactor`](../adr/ADR-001-agent-identity-capability-refactor.md).


## Core Model

The runtime exposes one strong project Agent runner. A session chooses exactly
one task identity, and that identity is bound to exactly one capability pack.
The system prompt defines behavior; the capability pack defines tools. They are
resolved together and audited together.

```yaml
agent_identity:
  id:
  role_prompt_id:
  capability_pack_id:
  output_contract:
  audit_level:
```

```yaml
capability_pack:
  id:
  allowed_tools:
  allowed_vos_commands:
  allowed_mcp_servers:
  allowed_skills:
  readable_context:
  writable_targets:
  required_gates:
  forbidden_actions:
```

The task identity is not a user persona. `Student`, `TA`, `Teacher`, `Review`,
and `Report` personas only set visibility and policy ceilings. They can remove
capabilities from the selected pack, but they cannot add capabilities.

## Required Identities

| Identity | Purpose | Capability pack |
|---|---|---|
| `spec-author.v2` | Write and review Architecture, Module, Operation, Composition, Goal, and SpecPatch documents. | Read docs/specs, write spec targets, run `vos spec lint` and `vos arch lint`. |
| `implementer.v2` | Implement stage-bounded code from approved specs. | Read project context, write `codegen.targets`, run build and public verification. |
| `debugger.v2` | Diagnose build, QEMU, trace, and public verification failures. | Read logs/evidence/source, run diagnostic build/run/debug commands, no code writes. |
| `reviewer.v2` | Review patches, evidence, risk flags, and audit records. | Read patch/spec/evidence, no implementation writes. |
| `reporter.v2` | Produce reports and evidence maps. | Read evidence/spec/report inputs, write report targets only. |
| `toolchain-author.v2` | Maintain build/run/debug semantics. | Write `spec/toolchain/**`, run `vos build generate` and `vos build`. |
| `knowledgebase.v1` | Help students make stage-bounded design decisions from course/project/reference knowledge. | Read course KB, public specs/evidence/code, approved web snapshots, no workspace writes. |

`knowledgebase.v1` is specified in
[`knowledgebase-agent-v1.md`](./knowledgebase-agent-v1.md). It replaces the
older prototype `knowledgebase-agent.v1` profile and is entered through
`vos agent ask`.

## Session Envelope

```yaml
agent_session:
  agent_identity_id:
  role_prompt_id:
  capability_pack_id:
  user_persona:
  visibility_scope:
  task_brief:
  spec_bindings:
  policy_snapshot_ref:
  required_evidence:
```

Rules:

1. Selecting an identity selects its single `role_prompt_id` and single
   `capability_pack_id`.
2. A system prompt cannot grant tools, paths, credentials, hidden material, or
   validation authority.
3. A capability pack cannot change the Agent's task identity or output
   obligations.
4. Project policy, stage gates, and persona visibility can only narrow the
   selected capability pack.
5. All writes, generated build systems, validation results, and audit entries
   are produced or accepted by deterministic VOS runtime gates.

## Local CLI Wrapper Boundary

`vos-cli` calls `vos-agent/headless` through profile-based task APIs. The CLI
does not construct role prompts or profile envelopes. It supplies only:

- `taskKind` and `requestedScope`
- user-visible task text
- deterministic context bundles, evidence refs, allowed paths, validations,
  and policy flags
- local MCP bindings such as `vos-kb` for knowledge-base questions

`vos-agent` owns the system prompt, tool profile, skill/MCP intent, output
schema, and provider-neutral `StructuredOutput` contract. CLI handlers parse
`structuredOutput` and then apply deterministic VOS gates before accepting any
patch, report, toolchain draft, debug diagnosis, or knowledge-base answer.

## Code Generation Boundary

The target-state spec schema uses `codegen.targets`; source marker regions are
not a supported design mechanism.

```yaml
codegen:
  targets:
    - kind: file | symbol | module | test | build
      path:
      symbols:
      owner:
      mode: create | modify | replace
  forbidden_changes:
  required_followup_checks:
```

`implementer.v2` may edit only targets admitted by the active specs, project
policy, stage gate, and persona visibility. The Agent may generate all modules
enabled by the current stage or a requested module dependency closure. It may
not generate future-stage modules or bypass a required commit-backed SpecPatch
gate.

## Commit-Bound Reproducibility

All write-generating Agent work is bounded by Git commits. The reproducible
unit for local audit and server-side evaluation is the current `HEAD`
`commit_sha`, not a workspace snapshot, unstaged file, untracked file, or local
run directory.

Clean tree means this command returns no output:

```text
git status --porcelain --untracked-files=all
```

Files ignored by `.gitignore`, such as build outputs, caches, QEMU run
artifacts, and `.vos/runs/`, do not make the tree dirty.

Rules:

1. `implementer.v2` and `toolchain-author.v2` must pass the clean tree gate
   before any write-generating `generate` operation.
2. `vos build generate` and `vos build` must start from a clean tree. Build
   evidence is therefore attributable to the current `HEAD`.
3. A successful write-generating `generate` operation must create a VOS-managed
   commit. The commit includes generated tracked changes and the matching
   `.vos/commit-ledger.jsonl` entry.
4. A no-op generate run creates no commit, but it still records a no-op run
   record and evidence reference.
5. `vos submit pack` and server submissions require a clean tree and submit
   only the current `HEAD` commit.
6. Human commits are allowed between VOS operations, but each human commit must
   have a ledger record before the next generate, build, or submit gate passes.
7. Agent sessions may only begin write work from a clean `HEAD`, so human draft
   files cannot be silently mixed into Agent evidence.

The tracked commit ledger is `.vos/commit-ledger.jsonl`. Each line records:

```yaml
commit_sha:
parent_sha:
actor: agent | human
agent_identity_id:
capability_pack_id:
run_id:
spec_patch_id:
spec_refs:
changed_targets:
evidence_refs:
created_at:
collaboration_intent:
based_on_agent_output:
```

`agent_identity_id`, `capability_pack_id`, and `run_id` are required for Agent
commits and optional for human commits. Human commits must still record
`collaboration_intent` and whether the change is based on Agent output.

## Toolchain Boundary

The Agent edits `ToolchainSpec`. VOS materializes the build system:

```text
spec/toolchain/** -> vos build generate -> build files + .vos/toolchain.json
.vos/toolchain.json -> vos build -> evidence
```

Generated build files are deterministic artifacts. `vos build` executes the
manifest and records evidence; it does not infer new build semantics from chat.

## Audit Requirements

Every Agent session records:

- `agent_identity_id`
- `role_prompt_id`
- `capability_pack_id`
- `commit_sha`
- `parent_sha`
- `spec_patch_id` when the session implements or reviews a SpecPatch
- `.vos/commit-ledger.jsonl` record
- user persona and visibility scope
- policy snapshot
- advertised tools and commands
- loaded skills and MCP servers
- KB source ids and object refs used by `knowledgebase.v1`
- changed targets or generated reports
- validation and evidence refs
- clean tree gate status
- user accepted/rejected status
- risk flags

Risk flags include unbound writes, policy denial, hidden-context requests,
checker bypass attempts, stage-boundary violations, schema failures, dirty tree
gate failures, missing ledger records, and commit/evidence mismatches.
