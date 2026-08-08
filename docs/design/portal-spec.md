# Portal frozen boundary

Portal/Demo is retained only as a platform boundary in this phase. Its API, worker, Web UI, and static Demo may continue to build and pass unit tests, but they do not define the student file contract and do not participate in the local student loop.

The student CLI stays in-process with `vos-agent/headless`. Any HTTP/OpenAI-compatible service is an internal Portal capability; `agent serve`, pipeline orchestration, hidden tests, and connected teaching acceptance are not public student commands.
