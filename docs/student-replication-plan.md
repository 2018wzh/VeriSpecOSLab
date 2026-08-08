# Student v2 replication checklist

This checklist supersedes the historical command transcript. It records only the current public chain:

```text
init → design/spec → implement → build → verify → QEMU/Hardware → report → submit
```

- [ ] `vos init` creates the empty DesignSpec, toolchain ModuleSpec, manifest, ignore rules, and initial commit.
- [ ] strict schema tests cover unknown fields, old kinds, references, duplicate IDs, traversal, ABI boundaries, and SpecPatch impact.
- [ ] Runner tests cover structured argv, dirty development evidence, clean verification, QEMU timeout/panic, and hardware `pending_human_review`.
- [ ] Agent tests cover confirmation, detached worktree, owns union, HEAD drift, failed/no-change outcomes, automatic commit, read-only roles, and maxIterations.
- [ ] KB tests cover locked revision/content hash, audit query snippets, path/credential redaction, and hash-chain replay.
- [ ] `report` and `submit` bind commits, Spec IDs, tests, logs, evidence, and commit/spec/config hashes.
- [ ] Portal/Demo remain frozen and continue typecheck/build/unit-test checks.
- [ ] Real provider validation completes `agent spec → implement → commit → verify`; Fixture/model stubs do not close this gate.
