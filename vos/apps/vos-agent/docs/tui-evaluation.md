# Stars TUI evaluation guide

Use this guide to manually evaluate the Stars TUI for responsiveness,
terminal correctness, and everyday agent ergonomics. It includes both a
real-agent checklist and a deterministic tmux benchmark that removes LLM
network variance.

## 1. Prepare a compatible tmux session

Stars works outside tmux, but tmux is a useful repeatable test harness.
For the best TUI behavior, configure tmux with these settings:

```tmux
# Stars/Amp-style terminal compatibility
set -g allow-passthrough all
set -ga terminal-features ",*:hyperlinks"
set -s set-clipboard on
set -s extended-keys on
set -g mouse on
bind -n S-Enter send-keys -l "\x1b[13;2u"
```

To apply them only to the current tmux server while testing:

```sh
tmux set -g allow-passthrough all
tmux set -ga terminal-features ',*:hyperlinks'
tmux set -s set-clipboard on
tmux set -s extended-keys on
tmux set -g mouse on
tmux bind -n S-Enter send-keys -l "\x1b[13;2u"
```

Verify:

```sh
tmux show-options -g allow-passthrough
tmux show-options -g terminal-features
tmux show-options -s set-clipboard
tmux show-options -s extended-keys
tmux show-options -g mouse
tmux list-keys | grep 'S-Enter'
```

Expected essentials:

- `allow-passthrough all`
- `*:hyperlinks` appears in `terminal-features`
- `set-clipboard on`
- `extended-keys on`
- `mouse on` if you want mouse-wheel transcript scrolling inside tmux
- `S-Enter` binding exists

## 2. Run the real TUI

From a real terminal or tmux pane:

```sh
bun run app/main.ts
```

The TUI path is active when both stdin and stdout are TTYs. Piped or
non-TTY usage keeps the line-oriented fallback.

### First impression checklist

Confirm these before deeper testing:

- Stars enters an alternate-screen TUI and restores the shell on `/quit`.
- The welcome view is centered when there is no transcript yet.
- The bottom prompt box shows mode/running/tool state and cwd in its border.
- The prompt cursor is visible and tracks typed text.
- Long transcript rows and long prompt drafts wrap instead of clipping off screen.
- The first TTY welcome plays a short galloping-horse animation before settling on the welcome screen.
- Typing `/` opens a centered command palette above the prompt and filters choices as text is entered.
- Arrow keys move the palette selection, and Enter activates the selected entry.
- Neutral prompt, palette, and border text uses the terminal's default foreground for light/dark theme readability.
- The input panel is tall enough to leave multiple blank prompt rows below a one-line draft.
- Submitted user prompts use a slim green vertical rail plus green italic text, distinct from assistant output.
- Assistant output uses the terminal's default foreground without repeated `assistant:` labels, and routine thread/model/tool metadata does not appear as blue transcript rows.
- Smart and deep mode labels in the prompt border use different colors.
- Typing feels immediate, with no whole-screen flicker.
- The final shell prompt is usable after exit; cursor visibility is restored.

## 3. Manual UX scenarios

### Prompt editing

At the `>` prompt, verify:

| Action | Expected behavior |
| --- | --- |
| Type normal text | Text appears immediately at the prompt. |
| Left / Right | Cursor moves within the prompt. |
| Home / End or Ctrl-A / Ctrl-E | Cursor jumps to start/end. |
| Backspace / Delete | Deletes before/under cursor. |
| Ctrl-U | Clears text before cursor. |
| Ctrl-K | Clears text after cursor. |
| Ctrl-W | Deletes previous word. |
| Ctrl-C with draft text | Clears the draft, shows a second-press exit hint, stays in TUI. |
| Ctrl-C on empty prompt | Shows a second-press exit hint, stays in TUI. |
| Second Ctrl-C after the hint | Exits input and restores terminal. |
| Ctrl-D on empty prompt | Exits input and restores terminal. |
| Ctrl-D with non-empty prompt | Does not exit; leaves the draft usable. |

### Prompt history

Submit two prompts, for example:

```text
first history check
second history check
```

Then verify:

- Up recalls `second history check`.
- Up again recalls `first history check`.
- Down returns to `second history check`.
- Down again restores the draft you had before history navigation.
- Editing a recalled prompt submits the edited text, not the original.

### Transcript history and copyability

Create enough transcript output to overflow the visible pane, then verify:

- Mouse wheel or Ctrl-Up scrolls incrementally to older transcript rows
  and the prompt border shows a `history -N` indicator. Inside tmux,
  `tmux show-options -g mouse` must report `mouse on`.
- PageUp jumps by a visible transcript page and still shows assistant or
  tool rows, not only submitted user prompts.
- Mouse wheel or Ctrl-Down scrolls incrementally toward the live bottom;
  PageDown jumps by a visible transcript page.
- Because mouse-wheel scrolling uses terminal mouse reporting, plain
  drag selection may be intercepted by the terminal/tmux. Use tmux copy
  mode or your terminal's selection modifier (often Shift-drag) when
  selecting assistant output, submitted user prompts, or command output.

### Agent turn rendering

Use prompts that exercise different event types:

```text
Say hello in one short sentence.
Read docs/README.md and summarize it in three bullets.
Run bun test tests/tui/input.test.ts and tell me the result.
```

Check:

- Submitted user prompts appear in the transcript with a slim green vertical rail and green italic text.
- Active tools appear in the prompt border while running.
- Tool calls/results appear as transcript rows.
- Errors clear stale `running` / active-tool status.
- The final assistant response appears once.
- New transcript rows stay visible at the bottom when the view fills.
- Long assistant/tool lines wrap with continuation indentation.
- Release TUI frames do not prefix every assistant response with `assistant:`; debug-label rendering may still show it.
- Routine thread, model, tool-list, turn-complete, and saved-thread metadata stays out of the transcript.

### Slash commands

Try:

```text
/
/m
/help
/mode
/mode rush
/new
/thread
/quit
```

Check that typing `/` opens the command palette, arrow keys move the
highlight, Enter activates the selected entry, typing `/m` filters it
toward mode commands, submitting `/help` shows the palette/help surface,
other command output appears in the transcript, and invalid slash
commands report an error without breaking later prompts.

### Light and dark terminal themes

Switch your terminal between a dark and a light theme, then reopen Stars
and type `/`.

Expected behavior:

- Prompt text, prompt borders, palette borders, and unselected palette
  rows remain readable in both themes.
- Accent colors such as the user rail, palette title, and selected row
  remain visible.
- No neutral UI text is forced to white on a light background.

### Resize behavior

While Stars is open:

1. Shrink the terminal width.
2. Grow it again.
3. Shrink height to a very small value, then restore it.

Expected behavior:

- The screen redraws without stale text fragments.
- The prompt remains visible when height is at least two rows.
- The prompt border prioritizes live state (`running`, active tools) over long IDs.
- Wrapped prompt text keeps the cursor visible when the pane narrows.

### Unicode prompt preservation

Type a prompt containing non-ASCII and Chinese wide-character text:

```text
Repeat this exactly: café 中文 🙂
```

Expected behavior:

- The text appears in the prompt while typing; Chinese characters occupy
  two terminal cells and do not overwrite adjacent borders or text.
- Wrapping keeps full characters visible instead of clipping half of a
  wide character at the right edge.
- The submitted user turn displays the same text in the transcript with
  the slim green rail and green italic text.
- The prompt text is preserved when submitted to the model.

## 4. Deterministic tmux benchmark

Use this when you want to benchmark TUI overhead without model/network
latency. It runs `runInteractive` with a local fake `ChatClient`.

Create a temporary harness:

```sh
cat > /tmp/stars-tui-harness.ts <<'EOF'
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = process.env.STARS_REPO ?? process.cwd();
const { runInteractive } = await import(`${repo}/app/terminal/repl.ts`);
const { ThreadStore } = await import(`${repo}/app/session/thread-store.ts`);
const root = mkdtempSync(join(tmpdir(), "stars-tui-run-"));
const delay = Number(process.env.STARS_BENCH_DELAY_MS ?? "0");
const config = {
  defaultMode: "smart",
  modes: { smart: { model: "bench-model" } },
  tools: { disabled: [] },
};
const store = new ThreadStore({ stateDir: join(root, ".stars"), workspaceRoot: root });
const chat = {
  async chat(request: any) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const lastUser = request.messages
      .filter((message: any) => message.role === "user")
      .at(-1)?.content ?? "";
    return { role: "assistant", content: `bench response: ${String(lastUser).slice(0, 80)}` };
  },
};

try {
  await runInteractive({ chat, config, store, workspaceRoot: root, startDir: root });
} finally {
  rmSync(root, { recursive: true, force: true });
}
EOF
```

Start it in tmux:

```sh
tmux kill-session -t stars-tui-bench 2>/dev/null || true
tmux new-session -d -s stars-tui-bench -x 100 -y 30 \
  'cd /path/to/stars && STARS_REPO=/path/to/stars STARS_BENCH_DELAY_MS=0 bun /tmp/stars-tui-harness.ts'
tmux capture-pane -t stars-tui-bench -p
```

Replace `/path/to/stars` with the repository path.

### Measure submit-to-visible-response latency

```sh
start=$(date +%s%3N)
tmux send-keys -t stars-tui-bench 'hello from tmux' Enter
for i in $(seq 1 300); do
  out=$(tmux capture-pane -t stars-tui-bench -p)
  if printf '%s' "$out" | grep -q 'bench response: hello from tmux'; then
    end=$(date +%s%3N)
    echo "turn_ms=$((end-start))"
    break
  fi
  sleep 0.01
done
```

On the development machine used for this implementation, zero-network
turns measured about **42–65 ms** through tmux capture polling.

To estimate TUI overhead with simulated model delay:

```sh
tmux kill-session -t stars-tui-bench 2>/dev/null || true
tmux new-session -d -s stars-tui-bench -x 100 -y 30 \
  'cd /path/to/stars && STARS_REPO=/path/to/stars STARS_BENCH_DELAY_MS=250 bun /tmp/stars-tui-harness.ts'
```

Expected result: measured latency should be approximately model delay +
40–80 ms on a typical local machine.

### Measure keypress-to-visible-prompt latency

```sh
start=$(date +%s%3N)
tmux send-keys -t stars-tui-bench 'x'
for i in $(seq 1 200); do
  out=$(tmux capture-pane -t stars-tui-bench -p)
  if printf '%s' "$out" | grep -q '^> x'; then
    end=$(date +%s%3N)
    echo "keypress_ms=$((end-start))"
    tmux send-keys -t stars-tui-bench C-c
    break
  fi
  sleep 0.005
done
```

On the development machine, this measured about **10–15 ms** through
tmux capture polling.

### Microbenchmark render/diff throughput

This measures pure frame rendering/diff output without tmux polling:

```sh
bun --eval '
import { TerminalDriver } from "./app/tui/terminal.ts";
import { renderStarsViewFrame } from "./app/tui/stars-view.ts";
const output = { bytes: 0, write(value) { this.bytes += value.length; } };
const driver = new TerminalDriver(output);
const base = {
  status: { mode: "smart", threadId: "T-bench", activeTools: [] },
  transcript: Array.from({ length: 80 }, (_, i) => ({
    type: i % 2 ? "assistant" : "user",
    text: `line ${i} with useful text`,
  })),
  prompt: { text: "" },
};
driver.start();
driver.renderFrame(renderStarsViewFrame(base, { width: 100, height: 30 }));
const n = 2000;
const start = performance.now();
for (let i = 0; i < n; i++) {
  const text = `prompt ${i}`;
  driver.renderFrame(renderStarsViewFrame({
    ...base,
    prompt: { text, cursor: text.length },
  }, { width: 100, height: 30 }));
}
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  frames: n,
  elapsed_ms: Number(elapsed.toFixed(2)),
  frame_ms: Number((elapsed / n).toFixed(4)),
  fps_capacity: Math.round(n / (elapsed / 1000)),
  bytes: output.bytes,
}, null, 2));
'
```

During implementation, this measured about **1.10 ms/frame** at 100x30
with 80 transcript items, or roughly **900 fps capacity** for prompt-only
updates.

### Cleanup

```sh
tmux kill-session -t stars-tui-bench 2>/dev/null || true
rm -f /tmp/stars-tui-harness.ts
```

## 5. Suggested acceptance thresholds

Use these as practical thresholds, not hard protocol guarantees:

| Area | Good result |
| --- | --- |
| Keypress echo | Under 50 ms by tmux polling; subjectively instant. |
| Zero-network turn | Under 100 ms by tmux polling. |
| Render microbenchmark | Under 3 ms/frame for 100x30 prompt-only updates. |
| Terminal restore | Cursor visible and normal screen restored after `/quit`, Ctrl-C, Ctrl-D, and errors. |
| Flicker | No full-screen flashing during typing or cursor movement. |
| Tool status | Active tools visible while running and cleared after completion/error. |

## 6. Feedback template

When reporting TUI feedback, include:

```text
Terminal app:
tmux version:
Shell:
OS:
Window size:
Stars command:
Scenario:
Expected:
Actual:
Latency measurement, if relevant:
Screenshot or tmux capture, if possible:
```

Useful capture command:

```sh
tmux capture-pane -t stars-tui-bench -p -S -200
```
