# ADR-001: Agent Identity And Capability Refactor

## Status

Accepted.

## Context

The previous Agent design split responsibilities across multiple runtime roles,
per-role fixed prompt catalogs, separately composable tool/skill/MCP profiles,
proposal-only generation paths, and source marker edit regions. That design was
useful while the model was treated as a narrow code generator, but it created
three problems:

1. Authority was scattered across role names, prompt text, tool profiles, and
   wrapper rules.
2. Prompt configuration looked like a permission source even though only the
   runtime can enforce permissions.
3. Marker-oriented editing made specs depend on generated source comments rather
   than stable module, file, and symbol ownership.

The target runtime assumes a Claude Code/Codex-class project Agent that can read
the repository, plan work, edit allowed files, run tools, inspect evidence, and
repair failures. The governance layer still needs deterministic policy,
validation, stage gating, and audit.

## Decision

Replace the old Agent model with one strong Agent runner and task identities
bound to fixed capability packs.

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

Each `AgentIdentity` chooses exactly one role prompt and exactly one capability
pack. User persona, project policy, and stage gate can only narrow that pack.
They cannot add tools, paths, hidden context, or validation authority.

All write-generating Agent work is commit-bound. A generate, build, or submit
operation must begin from a clean Git tree, defined as no output from:

```text
git status --porcelain --untracked-files=all
```

Ignored build, cache, run, and QEMU artifacts do not count as dirty. After a
successful write-generating generate operation, VOS creates a commit and records
the reproducibility metadata in tracked history. Server-side evaluation accepts
a `commit_sha` as the reproducibility anchor and must not depend on uncommitted
local files, untracked files, or local `.vos/runs/` artifacts.

The required target identities are:

- `spec-author.v2`
- `implementer.v2`
- `debugger.v2`
- `reviewer.v2`
- `reporter.v2`
- `toolchain-author.v2`

## Incompatible Removals

The following mechanisms are removed from the target design:

- `GatewayAgent`, `SpecCompiler`, `SpecValidator`, and other runtime roles as
  separate implementation agents.
- Fixed prompt catalogs as an authority or routing mechanism.
- Freely composable `tool_profile`, `skill_profile`, and `mcp_profile` fields.
- Proposal-only generation as the default implementation path.
- Source marker editing through `editable_region`, `start_marker`, and
  `end_marker`.
- Agent-owned build-system generation from chat output.

The target schema uses `codegen.targets`:

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

Toolchain generation moves to deterministic VOS materialization:

```text
ToolchainSpec -> vos build generate -> build system + .vos/toolchain.json
.vos/toolchain.json -> vos build -> evidence
```

## Migration Requirements

1. Update design docs to use `AgentIdentity`, `CapabilityPack`,
   `codegen.targets`, and `vos build generate` as the only target-state terms.
2. Update CLI/runtime code to resolve a single identity into a single role
   prompt and single capability pack before a session starts.
3. Update policy gates so persona, stage, and project rules only subtract from
   the selected capability pack.
4. Migrate operation specs from `llm_codegen.editable_region` to
   `codegen.targets`.
5. Treat existing xv6 marker specs as legacy migration input, not as a
   supported target mechanism.
6. Replace Agent-generated build files with `ToolchainSpec` plus
   `vos build generate`.
7. Implement clean-tree gates before `vos build generate`, `vos build`, and
   `vos submit pack`.
8. Make successful write-generating generate runs create VOS-managed commits.
   No-op generate runs create no commit, but still record the no-op run.
9. Add tracked commit metadata through `.vos/commit-ledger.jsonl` or an
   equivalent tracked commit trailer model. The target design standardizes on
   `.vos/commit-ledger.jsonl`.
10. Require each ledger entry to bind `commit_sha`, `parent_sha`, actor,
    optional Agent identity metadata, spec refs, changed targets, evidence refs,
    and creation time.
11. Allow human commits between Agent runs only when they are also represented
    in the ledger with collaboration intent and whether they are based on Agent
    output.
12. Update server Pipeline and Judge flows to checkout the submitted commit,
    validate ledger consistency, run `vos build generate`, run `vos build`, and
    run verification from that commit.

## Consequences

The refactor is intentionally breaking. Existing specs, docs, and runtime code
that expect runtime role routing, prompt-based permission selection, or marker
regions must be migrated. The benefit is a smaller authority model: the Agent's
identity describes behavior, the capability pack describes tools, and VOS
runtime remains the sole enforcement and evidence layer.

The reproducibility model is also intentionally strict. Dirty worktrees block
generate, build, and submit. Server evaluation is reproducible from a single
commit SHA plus tracked metadata. Local run artifacts remain useful evidence
caches, but they are not submission inputs unless referenced by committed
metadata.
