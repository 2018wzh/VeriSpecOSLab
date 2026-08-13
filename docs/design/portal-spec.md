# Portal boundary and connected contract

Portal is the online control plane for teaching and assessment. Its Fastify API, worker, Web UI, static Demo, Docker Compose deployment, and isolated Runner are versioned alongside the shared Portal contracts. The local student loop remains offline and is not changed by enabling online operations.

The student CLI stays in-process with `vos-agent/headless`. Online operations are explicit and live only under `vos portal`: device login, project binding, public runs, SSE status, evidence download, and authoritative submissions. Pipeline orchestration, hidden tests, and Runner execution remain Portal/worker capabilities rather than general-purpose student commands.
