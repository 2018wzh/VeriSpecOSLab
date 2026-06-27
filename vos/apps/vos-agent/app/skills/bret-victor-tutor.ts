import type { BuiltInSkill } from "./types.ts";

export const BRET_VICTOR_TUTOR_PROMPT = String.raw`## Built-in skill: bret-victor-tutor

# Bret Victor Tutor - Interactive HTML Generator

Generate self-contained HTML files that teach through direct manipulation, not reading. Every
output must feel like a live system the learner can operate, not a diagram they observe.

## Core Philosophy

Bret Victor's central idea: the learner must see the system thinking.

This means:
- No next step buttons that hide intermediate states
- No static diagrams of dynamic processes
- No reading about behavior when behavior can be operated
- Every constant is a knob. Every variable is visible. Every moment in time is reachable.

The golden rule: if you find yourself writing an explanation that could instead be shown as a
manipulable state, throw away the explanation and build the manipulation.

## Step 1 - Concept Classification

Before writing code, classify the concept into a primary pattern:

| Concept type | Pattern to use |
| --- | --- |
| Algorithm with steps | Time scrubber: pre-compute all states and scrub through them |
| Data structure | Live manipulation: drag, insert, delete nodes |
| Mathematical formula | Parameter knobs: every constant is a slider |
| Process with phases | Phase stepper: synchronized views advance together |
| Comparison | Side-by-side sync: both run in lockstep |
| PDF with examples | Multi-file: one HTML per major concept |

A single HTML may combine multiple patterns.

## Step 2 - The Pre-Compute Pattern

For any algorithm visualization, use this architecture:

1. Run the full algorithm once on load and snapshot every intermediate state.
2. Store the snapshots in a global states[] array.
3. Every render function reads only from states[currentStep].
4. The scrubber only calls render().

Mandatory shape:

function computeAllStates(input) {
  const states = [];
  states.push({
    activeNode, visitedSet, stack, queue, assignments,
    liveVars, highlightedLine, description
  });
  return states;
}

const states = computeAllStates(input);

function render(step) {
  const s = states[step];
  drawGraphView(s);
  drawCodeView(s);
  drawTableView(s);
  updateDescription(s);
}

This makes time-travel free, keeps all views synchronized, separates algorithm logic from display
logic, and lets learners scrub backward to inspect causality.

## Step 3 - Required UI Elements

Every generated HTML must include:

- Full-width time scrubber at the bottom for step-based algorithms
- Play/pause button
- Step label
- Description strip explaining what just happened
- Keyboard controls: ArrowLeft, ArrowRight, Space, r
- At least two synchronized views updating from the same state object
- Clickable meaningful nodes/elements with tooltip, highlight, or detail log

Common synchronized views:

- Source code panel with highlighted active line + algorithm visualization
- Live range chart + interference graph + register file
- Pseudocode + data structure state + call stack
- For VOS debug: spec/code, verify/trace timeline, GDB/monitor state

## Step 4 - Visual Design System

Use consistent semantic colors:

--active: #5b6fff; currently executing / live
--new: #43d9ad; just born / just assigned
--dying: rgba(255,255,255,0.3); about to be freed; dashed border
--spill: #ff4444; error / spilled / failed
--inactive: rgba(255,255,255,0.08); not yet reached / dead
--focus: #ffd166; user-selected / focused

Category colors in order:
--cat-0 #5b6fff, --cat-1 #ff6b6b, --cat-2 #43d9ad, --cat-3 #ffd166,
--cat-4 #c792ea, --cat-5 #f78c6c.

Always use a dark theme:

--bg #0d0e11, --bg2 #13151a, --bg3 #1a1d24, --bg4 #20242d,
--border rgba(255,255,255,0.07), --text #e8e6e0, --text2 #8a8880,
--text3 #555350.

Typography:
- mono: Berkeley Mono, Fira Code, monospace
- sans: DM Sans, system-ui, sans-serif
- Optional Google Fonts are allowed; failure must not break reading.

Canvas rules:
- Resize canvas to container width/height before drawing
- clearRect at start of every draw
- Node radius scales with container
- Active node glow uses shadowColor/shadowBlur and resets afterward
- Always setLineDash([]) after dashed lines
- Edge width: 1.5px active, 1px inactive

## Step 5 - Layout Templates

Template A: side-by-side code + visualization:

header with title and controls
left source/IR pane
right main visualization
bottom full scrubber and description strip

Template B: multi-panel sync:

header
three synchronized panels
bottom full scrubber and description strip

Template C: parameter explorer:

header
large main visualization
sliders and derived values panel

## Step 6 - Interaction Patterns

Keyboard controls are mandatory:

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { step = Math.min(step+1, states.length-1); render(step); }
  if (e.key === 'ArrowLeft')  { step = Math.max(step-1, 0); render(step); }
  if (e.key === ' ')          { e.preventDefault(); togglePlay(); }
  if (e.key === 'r')          { step = 0; render(0); }
});

Playback is mandatory:

let playing = false, timer = null, step = 0;
function togglePlay() {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  if (playing) {
    if (step >= states.length - 1) step = 0;
    timer = setInterval(() => {
      step++;
      render(step);
      if (step >= states.length - 1) {
        playing = false;
        clearInterval(timer);
        playBtn.textContent = 'Play';
      }
    }, 650);
  } else {
    clearInterval(timer);
  }
}

Auto-play and resize handling are mandatory:

window.onload = () => { render(0); setTimeout(togglePlay, 400); };
window.addEventListener('resize', () => { if (states.length) render(step); });

## Step 7 - State Object Schema

Every snapshot should include, adapted to the concept:

{
  step: Number,
  active: String|null,
  visited: Set or Array,
  frontier: Array,
  assignments: Object,
  live: Array,
  newItems: Array,
  dyingItems: Array,
  activeLine: Number,
  description: String,
  phase: String
}

For VOS debug, states[] should additionally carry verify, trace, gdb, monitor, spec, and code
fields when evidence exists; use "not observed" when it does not.

## Step 8 - Writing Good Descriptions

Descriptions should be specific, causal, and consequence-oriented.

Good:
- Variable a becomes live and competes for a register.
- t interferes with a, b, and i; all neighbors already hold different registers, so t spills.

Bad:
- Step 7: t assigned to r2.
- The graph grows as the algorithm progresses.

## Step 9 - PDF Extraction Mode

When given a PDF:

1. Scan for algorithms, worked examples, data structures, theorems, and comparison tables
2. Rank by visualizability; algorithms and worked examples first
3. Plan one HTML per major concept, max 8 files for a typical lecture
4. Name files descriptively
5. Preserve the PDF's examples and variable names
6. Cross-link generated files
7. Report what each file covers before generating

## Step 10 - Quality Checklist

Before delivering, verify:

- All views read from states[step]; zero per-view state
- Scrubber spans the full algorithm
- ArrowLeft / ArrowRight / Space keyboard controls work
- Auto-play works on load
- Resize redraws without artifacts
- Descriptions explain cause, not just effect
- Active elements have glow or strong border emphasis
- Dying elements show a dashed transition state before disappearing
- New elements animate in
- At least two input programs/examples exist when the concept permits
- Fully self-contained; no external dependencies except optional fonts

## Reference Implementation Expectations

The canonical pattern:

- computeStates() runs the algorithm and snapshots everything
- Three synchronized views read from states[currentStep]
- Tokens or nodes are colored by current assignment/state
- New items pulse; dying items get dashed halos
- Multiple real examples share the same render logic through a selector
- Export button may save the current step's full state as JSON

## Anti-patterns

Never do these:

- Next button instead of scrubber
- Per-view state that can desynchronize
- setTimeout animation chains instead of precomputed states + scrubber
- Hiding intermediate states
- Prose as the primary teaching medium
- No replay mechanism
- Random colors
- External algorithm libraries for core logic`;

export const bretVictorTutorSkill: BuiltInSkill = {
  name: "bret-victor-tutor",
  promptText: BRET_VICTOR_TUTOR_PROMPT,
};
