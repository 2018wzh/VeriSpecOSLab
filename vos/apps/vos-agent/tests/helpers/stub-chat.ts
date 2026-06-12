import type OpenAI from "openai";
import type { ChatClient, ChatRequest } from "../../app/agent/loop.ts";

type Msg = OpenAI.Chat.ChatCompletionMessage;
type ToolCall = OpenAI.Chat.ChatCompletionMessageToolCall;

/** Conventional model name to pass to runAgent in tests. */
export const TEST_MODEL = "test-model";

/**
 * Build a final assistant text response (no tool calls). The agent loop
 * will terminate after seeing this.
 */
export function textResponse(content: string): Msg {
  return {
    role: "assistant",
    content,
    refusal: null,
  } as Msg;
}

/**
 * Build a tool-call response. `calls` is a list of {name, args} pairs;
 * IDs are auto-generated as `call_<index>`.
 */
export function toolCallResponse(
  calls: { name: string; args: Record<string, unknown>; id?: string }[],
): Msg {
  const tool_calls: ToolCall[] = calls.map((c, i) => ({
    id: c.id ?? `call_${i}`,
    type: "function",
    function: {
      name: c.name,
      arguments: JSON.stringify(c.args),
    },
  }));
  return {
    role: "assistant",
    content: null,
    refusal: null,
    tool_calls,
  } as Msg;
}

/**
 * Scripted chat client: returns the next response from `script` on each
 * call. Records every received request for assertions.
 */
export class ScriptedChatClient implements ChatClient {
  readonly requests: ChatRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: Msg[]) {}

  async chat(request: ChatRequest): Promise<Msg> {
    this.requests.push({
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      messages: [...request.messages],
      tools: request.tools,
    });
    if (this.cursor >= this.script.length) {
      throw new Error(
        `ScriptedChatClient: script exhausted after ${this.cursor} call(s)`,
      );
    }
    const reply = this.script[this.cursor];
    this.cursor++;
    return reply;
  }

  get callCount(): number {
    return this.cursor;
  }
}

/**
 * Dynamic chat client: pass a function that receives the request and
 * returns the next response, with access to call index for branching.
 */
export class CallbackChatClient implements ChatClient {
  readonly requests: ChatRequest[] = [];

  constructor(
    private readonly handler: (request: ChatRequest, callIndex: number) => Promise<Msg> | Msg,
  ) {}

  async chat(request: ChatRequest): Promise<Msg> {
    const index = this.requests.length;
    this.requests.push({
      model: request.model,
      reasoningEffort: request.reasoningEffort,
      messages: [...request.messages],
      tools: request.tools,
    });
    return await this.handler(request, index);
  }
}
