# The agent loop

The agent loop is the central control structure of the system. It is
defined in a single function, [runAgent](../app/agent/loop.ts), and
governs every conversation between the model and the tools.

The loop is provider-agnostic: it depends only on the `ChatClient`
interface and uses the OpenAI message shape as its canonical
internal format. Non-OpenAI providers (e.g. Anthropic) translate at
their own boundaries — the loop does not branch on provider.

This document specifies its exact contract.

## Algorithm

```diagram
       ┌────────────────────────────────────────────┐
       │   Initialise transcript                    │
       │     [system?, user(prompt)]                │
       └────────────────────┬───────────────────────┘
                            ▼
              ╭─────────────────────────────╮
              │  for iteration in 1..max:   │
              │                             │
              │  msg = chat({ messages,     │
              │               tools })      │
              │  append msg to transcript   │
              │                             │
              │  if !msg.tool_calls:        │
              │      return { msg.content,  │
              │               transcript,   │
              │               iteration }   │◀──────┐
              │                             │       │ terminates
              │  for call in msg.tool_calls │       │ when model
              │      result = registry      │       │ emits no
              │              .execute(call) │       │ tool_calls
              │      append tool result     │       │
              │      to transcript          │       │
              ╰──────────────┬──────────────╯       │
                             └────────────────────────────────┘
                                       loop
```

`runAgent` returns a `RunAgentResult`:

```ts
export interface RunAgentResult {
  content: string | null;                              // final assistant text
  messages: OpenAI.Chat.ChatCompletionMessageParam[];  // full transcript
  iterations: number;                                  // model round-trips
}
```

## Message lifecycle

For each iteration, three kinds of messages may be appended to the
transcript:

| Role        | When appended                                          | Source                       |
| ----------- | ------------------------------------------------------ | ---------------------------- |
| `system`    | Once, at start, if `system` option is provided.        | Caller of `runAgent`.        |
| `user`      | Once, at start.                                        | `prompt` option.             |
| `assistant` | Each iteration, immediately after `chat()` returns.   | Verbatim from the model.    |
| `tool`      | Once per tool call inside the latest assistant turn.  | Result of `registry.execute`.|

The assistant message is appended **verbatim**, including the
`refusal` field. This matters: the OpenAI SDK rejects requests when
the assistant message that triggered tool calls is sent back with a
missing or reconstructed shape.

A tool message is shaped:

```json
{
  "role": "tool",
  "tool_call_id": "<id from the assistant tool_call>",
  "content": "<string returned by Tool.execute>"
}
```

The `tool_call_id` must match the `id` field of the corresponding
`tool_calls[]` entry exactly.

## Termination

The loop terminates as soon as the model returns an assistant message
with no `tool_calls`. `content` may be `null` per the OpenAI
specification; callers should treat it as such.

`maxIterations` (default 50) is a hard ceiling that protects against
runaway loops. If reached, the loop throws — the caller should treat
this as a configuration or prompt issue, not a user-recoverable
state.

## Invariants the loop guarantees

1. Every `assistant` message returned by `chat()` is appended to the
   transcript before any tool result is computed.
2. The order of `tool` messages within a single iteration matches the
   order of `tool_calls` in the assistant message.
3. The `messages` array in `RunAgentResult` is the same array that was
   sent on every request; iterating from `[0]` to `[length-1]` yields
   the conversation in chronological order.
4. The loop never invokes `chat()` again after observing a terminating
   assistant message, so the transcript ends with the final
   `assistant` message and no trailing `tool` results.

## Failure modes

| Failure                                       | Behaviour                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `chat()` throws                               | Propagates. `runAgent` does not retry.                                                     |
| Tool returns an error string                  | Sent to the model as the `tool` content. The loop continues.                               |
| Tool throws                                   | Propagates. Treat as a bug in the tool — tools must return errors as strings.              |
| Model emits a non-`function` tool_call type   | `runAgent` throws (`unsupported tool call type`). Custom tool types are not yet supported. |
| Model emits a tool call for an unknown tool   | Registry returns `"Unknown tool: …"` to the model and the loop continues.                  |
| `maxIterations` exceeded                       | `runAgent` throws.                                                                         |

Cross-cutting policy: retries, exponential backoff, circuit breakers,
and cost budgets belong in a `ChatClient` decorator, not inside the
loop. See [Architecture](architecture.md).

## Options

| Option          | Type                       | Default | Notes                                                  |
| --------------- | -------------------------- | ------- | ------------------------------------------------------ |
| `chat`          | `ChatClient`               | —       | Required.                                              |
| `registry`      | `ToolRegistry`             | —       | Required.                                              |
| `prompt`        | `string`                   | —       | Required. The initial user message content.            |
| `model`         | `string`                   | —       | Required. Sent on every chat request; drives router.   |
| `system`        | `string \| undefined`      | —       | Prepended as a `system` message if provided.           |
| `maxIterations` | `number`                   | `50`    | Hard ceiling on model round-trips.                     |

## Example: scripted dry run

```ts
import { runAgent } from "./app/agent/loop.ts";
import { ToolRegistry } from "./app/tools/types.ts";
import { readTool } from "./app/tools/read.ts";
import {
  ScriptedChatClient,
  textResponse,
  toolCallResponse,
} from "./tests/helpers/stub-chat.ts";

const chat = new ScriptedChatClient([
  toolCallResponse([{ name: "Read", args: { file_path: "x.txt" } }]),
  textResponse("file says: hello"),
]);

const result = await runAgent({
  chat,
  registry: new ToolRegistry([readTool]),
  prompt: "what's in x.txt?",
  model: "test-model",
});

console.log(result.content);    // "file says: hello"
console.log(result.iterations); // 2
```
