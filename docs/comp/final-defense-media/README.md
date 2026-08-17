# Final Defense CLI Media

This directory contains reproducible terminal captures for slides P8–P11. The capture pipeline uses Charmbracelet VHS for scripted terminal rendering, Bun for evidence collection, Git for revision-bound source reads, and FFmpeg/FFprobe for media validation.

## Evidence levels

| Slide | Artifact | Evidence level | Boundary |
|---|---|---|---|
| P8 | `videos/p08-kb-citation.mp4` | real accepted Agent result | Reads a provider-produced, schema-accepted `agent ask` result and its repository citations. Citations expose the basis of a claim; they do not make it automatically correct. |
| P9 | `videos/p09-kernel-debug.mp4` | real failed run and diagnosis | Reads a real failed build, the Agent's evidence chain and its next diagnostic command. The read-only diagnosis does not change verification status. |
| P10 | `videos/p10-qemu-port.mp4` | real H5 QEMU and Orange Pi Prime evidence | Shows the QEMU trace suite and the separately captured four-core physical-board workload. QEMU remains `qemu_only`; only the serial evidence closes the board gate. |
| P11 | `videos/p11-commit-replay.mp4` | real connected Portal closure | Queries the live Portal dashboard for xv6 and Glenda, then checks out both exact commits from their Portal repositories and verifies the restored HEADs. |

Do not remove the evidence-level labels or the boundary sentence when editing the videos into the presentation.

## Reproduce

From the repository root:

```sh
bun --env-file=.env.portal-local --env-file=.env.glenda-replay.local \
  docs/comp/final-defense-media/capture/collect.ts \
  --glenda-root ../glenda-spec-lab-v2 \
  --debug-report <real-debug-report.json> \
  --xv6-project-id <xv6-project-id> \
  --glenda-project-id <glenda-project-id> \
  --xv6-submission-id <xv6-lab10-submission-id> \
  --glenda-submission-id <glenda-lab10-submission-id>
docker run --rm -v "$PWD:/vhs" -w /vhs ghcr.io/charmbracelet/vhs docs/comp/final-defense-media/capture/p08-kb-citation.tape
docker run --rm -v "$PWD:/vhs" -w /vhs ghcr.io/charmbracelet/vhs docs/comp/final-defense-media/capture/p09-kernel-debug.tape
docker run --rm -v "$PWD:/vhs" -w /vhs ghcr.io/charmbracelet/vhs docs/comp/final-defense-media/capture/p10-qemu-port.tape
docker run --rm -v "$PWD:/vhs" -w /vhs ghcr.io/charmbracelet/vhs docs/comp/final-defense-media/capture/p11-commit-replay.tape
bun docs/comp/final-defense-media/capture/normalize.ts
bun docs/comp/final-defense-media/capture/validate.ts
```

The collector fails if the accepted Agent result, failed-run diagnosis, H5 QEMU report, physical serial markers, connected Portal records, or exact Portal Git commits are unavailable. It never falls back to fixtures. Local absolute paths and email addresses are redacted before transcripts are written. The normalization step converts VHS output to presentation-safe H.264, 1600×900, 30 fps, yuv420p MP4 with fast-start metadata.
