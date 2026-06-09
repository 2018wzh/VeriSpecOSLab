import type { PromptKey } from "./prompt-editor.ts";

/**
 * Raw terminal input after it has been reduced to the prompt editor's small
 * vocabulary. Escape/control payloads that are not editing keys are consumed
 * here so they cannot leak into the user's prompt text.
 */
export type TerminalInputEvent =
  | Readonly<{ type: "key"; key: PromptKey }>
  | Readonly<{ type: "scroll"; direction: "up" | "down"; amount?: "line" | "page" }>
  | Readonly<{ type: "interrupt" }>
  | Readonly<{ type: "eof" }>;

type EscapeParseResult =
  | Readonly<{
    type: "complete";
    nextIndex: number;
    event?: TerminalInputEvent;
    key?: PromptKey;
  }>
  | Readonly<{ type: "incomplete" }>;

const ESC = "\x1b";
const controlCode = {
  ctrlA: 0x01,
  interrupt: 0x03,
  eof: 0x04,
  ctrlE: 0x05,
  bell: 0x07,
  backspace: 0x08,
  lineFeed: 0x0a,
  ctrlK: 0x0b,
  carriageReturn: 0x0d,
  ctrlU: 0x15,
  ctrlW: 0x17,
  space: 0x20,
  delete: 0x7f,
} as const;

/**
 * Streaming parser for stdin raw-mode chunks. Terminal escape sequences often
 * arrive split across chunks, so incomplete sequences are held until the next
 * parse call instead of being treated as literal text.
 */
export class TerminalInputParser {
  private pendingEscape = "";

  parse(chunk: string): TerminalInputEvent[] {
    const events: TerminalInputEvent[] = [];
    const input = this.pendingEscape + chunk;
    let text = "";
    let index = 0;

    this.pendingEscape = "";

    const pushText = (): void => {
      if (text.length === 0) {
        return;
      }

      events.push({ type: "key", key: { type: "text", text } });
      text = "";
    };

    while (index < input.length) {
      const char = input[index];
      if (char === undefined) {
        break;
      }

      const code = char.charCodeAt(0);

      if (char === ESC) {
        pushText();
        const escape = parseEscape(input, index);
        if (escape.type === "incomplete") {
          this.pendingEscape = input.slice(index);
          break;
        }

        if (escape.event !== undefined) {
          events.push(escape.event);
        } else if (escape.key !== undefined) {
          events.push({ type: "key", key: escape.key });
        }
        index = escape.nextIndex;
        continue;
      }

      switch (code) {
        case controlCode.carriageReturn:
        case controlCode.lineFeed:
          pushText();
          events.push({ type: "key", key: { type: "enter" } });
          index += 1;
          continue;
        case controlCode.delete:
        case controlCode.backspace:
          pushText();
          events.push({ type: "key", key: { type: "backspace" } });
          index += 1;
          continue;
        case controlCode.ctrlA:
          pushText();
          events.push({ type: "key", key: { type: "home" } });
          index += 1;
          continue;
        case controlCode.ctrlE:
          pushText();
          events.push({ type: "key", key: { type: "end" } });
          index += 1;
          continue;
        case controlCode.ctrlK:
          pushText();
          events.push({ type: "key", key: { type: "clear-after-cursor" } });
          index += 1;
          continue;
        case controlCode.ctrlU:
          pushText();
          events.push({ type: "key", key: { type: "clear-before-cursor" } });
          index += 1;
          continue;
        case controlCode.ctrlW:
          pushText();
          events.push({ type: "key", key: { type: "delete-word-backward" } });
          index += 1;
          continue;
        case controlCode.interrupt:
          pushText();
          events.push({ type: "interrupt" });
          index += 1;
          continue;
        case controlCode.eof:
          pushText();
          events.push({ type: "eof" });
          index += 1;
          continue;
      }

      if (isPrintableTextCode(code)) {
        text += char;
      }
      index += 1;
    }

    pushText();
    return events;
  }
}

function parseEscape(input: string, index: number): EscapeParseResult {
  // Keep the parser conservative: recognize editing/navigation keys, but also
  // consume complete terminal control sequences we do not use. That keeps OSC,
  // DCS, bracketed paste markers, and modified key variants out of prompt text.
  const introducer = input[index + 1];
  if (introducer === undefined) {
    return { type: "incomplete" };
  }

  if (isC0Control(introducer.charCodeAt(0))) {
    return { type: "complete", nextIndex: index + 1 };
  }

  switch (introducer) {
    case "[":
      return parseCsi(input, index);
    case "O":
      return parseSs3(input, index);
    case "]":
    case "P":
    case "X":
    case "^":
    case "_":
      return parseStringControl(input, index);
    case "(":
    case ")":
    case "*":
    case "+":
    case "-":
    case ".":
    case "/":
      return parseDesignateCharset(input, index);
    default:
      if (isEscIntermediateByte(introducer.charCodeAt(0))) {
        return parseGenericEscape(input, index);
      }
      return { type: "complete", nextIndex: index + 2 };
  }
}

function parseCsi(input: string, index: number): EscapeParseResult {
  let finalIndex = index + 2;

  while (finalIndex < input.length) {
    const code = input.charCodeAt(finalIndex);
    if (isC0Control(code)) {
      return { type: "complete", nextIndex: finalIndex };
    }
    if (code >= 0x40 && code <= 0x7e) {
      const final = input[finalIndex];
      if (final === undefined) {
        return { type: "incomplete" };
      }

      return {
        type: "complete",
        nextIndex: finalIndex + 1,
        event: eventForCsi(input.slice(index + 2, finalIndex), final),
        key: keyForCsi(input.slice(index + 2, finalIndex), final),
      };
    }
    if (!isCsiParameterByte(code) && !isCsiIntermediateByte(code)) {
      return { type: "complete", nextIndex: finalIndex + 1 };
    }
    finalIndex += 1;
  }

  return { type: "incomplete" };
}

function parseSs3(input: string, index: number): EscapeParseResult {
  const final = input[index + 2];
  if (final === undefined) {
    return { type: "incomplete" };
  }

  if (isC0Control(final.charCodeAt(0))) {
    return { type: "complete", nextIndex: index + 2 };
  }

  return {
    type: "complete",
    nextIndex: index + 3,
    key: keyForSs3(final),
  };
}

function parseStringControl(input: string, index: number): EscapeParseResult {
  let cursor = index + 2;

  while (cursor < input.length) {
    const char = input[cursor];
    if (char === undefined) {
      return { type: "incomplete" };
    }

    const code = char.charCodeAt(0);
    if (code === controlCode.interrupt || code === controlCode.eof) {
      return { type: "complete", nextIndex: cursor };
    }
    if (code === controlCode.bell) {
      return { type: "complete", nextIndex: cursor + 1 };
    }
    if (char === ESC) {
      const next = input[cursor + 1];
      if (next === undefined) {
        return { type: "incomplete" };
      }
      if (next === "\\") {
        return { type: "complete", nextIndex: cursor + 2 };
      }
    }

    cursor += 1;
  }

  return { type: "incomplete" };
}

function parseDesignateCharset(input: string, index: number): EscapeParseResult {
  const final = input[index + 2];
  if (final === undefined) {
    return { type: "incomplete" };
  }

  if (isC0Control(final.charCodeAt(0))) {
    return { type: "complete", nextIndex: index + 2 };
  }

  return { type: "complete", nextIndex: index + 3 };
}

function parseGenericEscape(input: string, index: number): EscapeParseResult {
  let cursor = index + 1;

  while (cursor < input.length) {
    const code = input.charCodeAt(cursor);
    if (isC0Control(code)) {
      return { type: "complete", nextIndex: cursor };
    }
    if (isEscFinalByte(code)) {
      return { type: "complete", nextIndex: cursor + 1 };
    }
    if (!isEscIntermediateByte(code)) {
      return { type: "complete", nextIndex: cursor + 1 };
    }
    cursor += 1;
  }

  return { type: "incomplete" };
}

function keyForCsi(params: string, final: string): PromptKey | undefined {
  if (eventForCsi(params, final) !== undefined) {
    return undefined;
  }

  switch (final) {
    case "A":
      return keyForArrowCsi(params, { type: "up" });
    case "B":
      return keyForArrowCsi(params, { type: "down" });
    case "D":
      return keyForArrowCsi(params, { type: "left" });
    case "C":
      return keyForArrowCsi(params, { type: "right" });
    case "H":
      return keyForArrowCsi(params, { type: "home" });
    case "F":
      return keyForArrowCsi(params, { type: "end" });
    case "~":
      return keyForTildeCsi(params);
    default:
      return undefined;
  }
}

function eventForCsi(params: string, final: string): TerminalInputEvent | undefined {
  if (final === "M" || final === "m") {
    return scrollEventForSgrMouse(params);
  }
  if (final === "~") {
    return scrollEventForTildeCsi(params);
  }
  if (final === "A") {
    return scrollEventForModifiedArrow(params, "up");
  }
  if (final === "B") {
    return scrollEventForModifiedArrow(params, "down");
  }

  return undefined;
}

function keyForArrowCsi(params: string, key: PromptKey): PromptKey | undefined {
  if (params === "" || /^1(;\d+)?$/.test(params)) {
    return key;
  }

  return undefined;
}

function keyForTildeCsi(params: string): PromptKey | undefined {
  const code = params.split(";", 1)[0];

  switch (code) {
    case "1":
    case "7":
      return { type: "home" };
    case "4":
    case "8":
      return { type: "end" };
    case "3":
      return { type: "delete" };
    default:
      return undefined;
  }
}

function scrollEventForTildeCsi(params: string): TerminalInputEvent | undefined {
  const code = params.split(";", 1)[0];

  switch (code) {
    case "5":
      return { type: "scroll", direction: "up", amount: "page" };
    case "6":
      return { type: "scroll", direction: "down", amount: "page" };
    default:
      return undefined;
  }
}

function scrollEventForModifiedArrow(
  params: string,
  direction: "up" | "down",
): TerminalInputEvent | undefined {
  const [code, modifierText] = params.split(";");
  if (code !== "1" || modifierText === undefined) {
    return undefined;
  }

  const modifier = Number.parseInt(modifierText, 10);
  // XTerm-style modifier values are 1 plus a bit mask: Shift=1,
  // Alt=2, Ctrl=4. Treat Ctrl-Up/Down variants as incremental
  // transcript scrolls alongside the mouse wheel.
  const hasCtrl = Number.isInteger(modifier) && ((modifier - 1) & 4) !== 0;
  return hasCtrl ? { type: "scroll", direction, amount: "line" } : undefined;
}

function scrollEventForSgrMouse(params: string): TerminalInputEvent | undefined {
  if (!params.startsWith("<")) {
    return undefined;
  }

  const button = Number.parseInt(params.slice(1).split(";", 1)[0] ?? "", 10);
  if (!Number.isInteger(button) || (button & 64) === 0) {
    return undefined;
  }

  const wheel = button & 3;
  if (wheel === 0) {
    return { type: "scroll", direction: "up", amount: "line" };
  }
  if (wheel === 1) {
    return { type: "scroll", direction: "down", amount: "line" };
  }

  return undefined;
}

function keyForSs3(final: string): PromptKey | undefined {
  switch (final) {
    case "A":
      return { type: "up" };
    case "B":
      return { type: "down" };
    case "D":
      return { type: "left" };
    case "C":
      return { type: "right" };
    case "H":
      return { type: "home" };
    case "F":
      return { type: "end" };
    default:
      return undefined;
  }
}

function isPrintableTextCode(code: number): boolean {
  return code >= controlCode.space && code !== controlCode.delete;
}

function isC0Control(code: number): boolean {
  return code >= 0x00 && code <= 0x1f;
}

function isCsiParameterByte(code: number): boolean {
  return code >= 0x30 && code <= 0x3f;
}

function isCsiIntermediateByte(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

function isEscIntermediateByte(code: number): boolean {
  return code >= 0x20 && code <= 0x2f;
}

function isEscFinalByte(code: number): boolean {
  return code >= 0x30 && code <= 0x7e;
}
