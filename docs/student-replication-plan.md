# Student v2 replication checklist

This checklist supersedes the historical command transcript. It records only the current public chain:

```text
init → ask → handwrite Spec → lint/review → manual commit
     → implement → build/QEMU/Hardware → verify → report → submit
```

- [ ] `vos init` creates the empty DesignSpec, toolchain ModuleSpec, manifest, ignore rules, and initial commit.
- [ ] strict schema tests cover unknown fields, old kinds, references, duplicate IDs, traversal, ABI boundaries, and SpecPatch impact.
- [ ] Runner tests cover structured argv, dirty development evidence, clean verification, QEMU timeout/panic, and hardware `pending_human_review`.
- [ ] Agent tests cover read-only review, detached worktrees, owns unions, HEAD drift, structured-submission repair, failed-run isolation, automatic commits, and maxIterations.
- [ ] KB tests cover command-managed sources, revision/content hashes, snippets actually shown to the student, path/credential redaction, and hash-chain replay.
- [ ] `report` and `submit` bind commits, Spec IDs, tests, logs, evidence, and commit/spec/config hashes.
- [x] Portal/Demo connected Compose control plane, isolated Runner, and static Demo are validated separately from the offline student chain.
- [ ] Real provider validation completes `ask → handwritten Spec → lint → review → manual commit → implement → verify`; Fixture/model stubs do not close this gate.
