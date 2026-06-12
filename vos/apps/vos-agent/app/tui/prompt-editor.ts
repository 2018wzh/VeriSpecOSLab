import type { StarsPromptState } from "./stars-view.ts";

/** Prompt text plus cursor offset. Offsets are JavaScript string positions. */
export type PromptEditorState = StarsPromptState;

export type PromptMoveDirection = "left" | "right" | "home" | "end";

export type PromptKey =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{
    type:
      | "left"
      | "right"
      | "up"
      | "down"
      | "home"
      | "end"
      | "backspace"
      | "delete"
      | "delete-word-backward"
      | "clear-before-cursor"
      | "clear-after-cursor"
      | "enter";
  }>;

export type PromptAction =
  | Readonly<{ type: "insert"; text: string }>
  | Readonly<{ type: "move"; direction: PromptMoveDirection }>
  | Readonly<{
    type:
      | "backspace"
      | "delete"
      | "delete-word-backward"
      | "clear-before-cursor"
      | "clear-after-cursor"
      | "submit"
      | "noop";
  }>;

export type PromptEditResult = Readonly<{
  state: PromptEditorState;
  submitted?: string;
}>;

export function emptyPromptState(): PromptEditorState {
  return { text: "", cursor: 0 };
}

export function promptActionForKey(key: PromptKey): PromptAction {
  switch (key.type) {
    case "text":
      return { type: "insert", text: key.text };
    case "left":
    case "right":
    case "home":
    case "end":
      return { type: "move", direction: key.type };
    case "up":
    case "down":
      return { type: "noop" };
    case "backspace":
      return { type: "backspace" };
    case "delete":
      return { type: "delete" };
    case "delete-word-backward":
      return { type: "delete-word-backward" };
    case "clear-before-cursor":
      return { type: "clear-before-cursor" };
    case "clear-after-cursor":
      return { type: "clear-after-cursor" };
    case "enter":
      return { type: "submit" };
  }
}

/** Applies one terminal key to the immutable prompt editor state. */
export function applyPromptKey(state: PromptEditorState, key: PromptKey): PromptEditResult {
  return applyPromptAction(state, promptActionForKey(key));
}

/**
 * Pure prompt-editing reducer. Submission returns the submitted text and resets
 * the prompt, while empty/whitespace-only submissions just clear the editor.
 */
export function applyPromptAction(
  state: PromptEditorState,
  action: PromptAction,
): PromptEditResult {
  switch (action.type) {
    case "insert":
      return { state: insertText(state, action.text) };
    case "move":
      return { state: moveCursor(state, action.direction) };
    case "backspace":
      return { state: deleteBeforeCursor(state) };
    case "delete":
      return { state: deleteAtCursor(state) };
    case "delete-word-backward":
      return { state: deleteWordBeforeCursor(state) };
    case "clear-before-cursor":
      return { state: clearBeforeCursor(state) };
    case "clear-after-cursor":
      return { state: clearAfterCursor(state) };
    case "submit":
      return submitPrompt(state);
    case "noop":
      return { state: { text: state.text, cursor: promptCursor(state) } };
  }
}

function insertText(state: PromptEditorState, rawText: string): PromptEditorState {
  const text = sanitizePrintableText(rawText);
  const cursor = promptCursor(state);
  if (text.length === 0) {
    return { text: state.text, cursor };
  }

  return {
    text: `${state.text.slice(0, cursor)}${text}${state.text.slice(cursor)}`,
    cursor: cursor + text.length,
  };
}

function moveCursor(state: PromptEditorState, direction: PromptMoveDirection): PromptEditorState {
  const cursor = promptCursor(state);

  switch (direction) {
    case "left":
      return { text: state.text, cursor: Math.max(0, cursor - 1) };
    case "right":
      return { text: state.text, cursor: Math.min(state.text.length, cursor + 1) };
    case "home":
      return { text: state.text, cursor: 0 };
    case "end":
      return { text: state.text, cursor: state.text.length };
  }
}

function deleteBeforeCursor(state: PromptEditorState): PromptEditorState {
  const cursor = promptCursor(state);
  if (cursor === 0) {
    return { text: state.text, cursor };
  }

  return {
    text: `${state.text.slice(0, cursor - 1)}${state.text.slice(cursor)}`,
    cursor: cursor - 1,
  };
}

function deleteAtCursor(state: PromptEditorState): PromptEditorState {
  const cursor = promptCursor(state);
  if (cursor >= state.text.length) {
    return { text: state.text, cursor };
  }

  return {
    text: `${state.text.slice(0, cursor)}${state.text.slice(cursor + 1)}`,
    cursor,
  };
}

function deleteWordBeforeCursor(state: PromptEditorState): PromptEditorState {
  const cursor = promptCursor(state);
  if (cursor === 0) {
    return { text: state.text, cursor };
  }

  let start = cursor;
  while (start > 0 && isWhitespace(state.text.charCodeAt(start - 1))) {
    start -= 1;
  }
  while (start > 0 && !isWhitespace(state.text.charCodeAt(start - 1))) {
    start -= 1;
  }

  return {
    text: `${state.text.slice(0, start)}${state.text.slice(cursor)}`,
    cursor: start,
  };
}

function clearBeforeCursor(state: PromptEditorState): PromptEditorState {
  const cursor = promptCursor(state);
  return {
    text: state.text.slice(cursor),
    cursor: 0,
  };
}

function clearAfterCursor(state: PromptEditorState): PromptEditorState {
  const cursor = promptCursor(state);
  return {
    text: state.text.slice(0, cursor),
    cursor,
  };
}

function submitPrompt(state: PromptEditorState): PromptEditResult {
  const nextState = emptyPromptState();
  if (state.text.trim().length === 0) {
    return { state: nextState };
  }

  return { state: nextState, submitted: state.text };
}

function promptCursor(state: PromptEditorState): number {
  return clampInteger(state.cursor ?? state.text.length, 0, state.text.length);
}

function sanitizePrintableText(text: string): string {
  let result = "";

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) continue;

    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      result += char;
    }
  }

  return result;
}

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return max;
  }

  return Math.max(min, Math.min(max, Math.trunc(value)));
}
