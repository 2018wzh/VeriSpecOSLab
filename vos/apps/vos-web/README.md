# VOS Portal Prototype (`vos-portal`)

`vos-web` is the current prototype implementation of `vos-portal` and a
standalone front-end demo for the VeriSpecOSLab teaching portal. It uses local
fixtures and `localStorage`; it does not call `vos-agent`, a runner, a model
provider, `/api`, or `/v1` at runtime.

Demo accounts:

- `student/student`
- `teacher/teacher`
- `ta/ta`

The prototype uses a Gradescope-like structure with three primary areas:
**Labs**, **Runs**, and **Grades**. Lab details cover setup, stage gates,
submissions, review, rubric, appeals, and retrospective material. Run details
show a submission-style full-process log from submit through score freeze.

The global AI Assistant is a read-only mock control. Demo actions such as
replay, notes, checklist updates, and assistant turns are persisted locally
until the user clicks **Reset demo**.

Run from `vos/`:

```sh
bun run dev:web
```

Verification:

```sh
bun run typecheck
bun run test
bun run build
```
