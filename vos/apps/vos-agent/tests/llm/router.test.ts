import { describe, expect, test } from "bun:test";
import type OpenAI from "openai";
import {
  TEXT_ONLY_CHAT_CLIENT_CAPABILITIES,
  chatClientCapabilities,
  type ChatClient,
  type ChatClientCapabilities,
  type ChatRequest,
} from "../../app/agent/loop.ts";
import {
  createRoutedChatClient,
  matchesPrefix,
  stripPrefix,
  type Route,
} from "../../app/llm/router.ts";

function fakeClient(label: string): { client: ChatClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    client: {
      async chat(req: ChatRequest) {
        calls.push(req.model);
        return {
          role: "assistant",
          content: label,
          refusal: null,
        } as OpenAI.Chat.ChatCompletionMessage;
      },
    },
  };
}

function emptyRequest(model: string): ChatRequest {
  return {
    model,
    messages: [{ role: "user", content: "x" }],
    tools: [],
  };
}

const MULTIMODAL_CAPABILITIES: ChatClientCapabilities = {
  input: { text: true, image: true, pdf: true },
};

describe("createRoutedChatClient", () => {
  test("dispatches by first matching route", async () => {
    const a = fakeClient("A");
    const b = fakeClient("B");
    const router = createRoutedChatClient({
      routes: [
        { match: matchesPrefix("claude"), client: a.client },
        { match: matchesPrefix("gpt-"), client: b.client },
      ],
    });

    const r1 = await router.chat(emptyRequest("claude-haiku-4-5"));
    const r2 = await router.chat(emptyRequest("gpt-4o-mini"));

    expect(r1.content).toBe("A");
    expect(r2.content).toBe("B");
    expect(a.calls).toEqual(["claude-haiku-4-5"]);
    expect(b.calls).toEqual(["gpt-4o-mini"]);
  });

  test("uses fallback when no route matches", async () => {
    const a = fakeClient("A");
    const fallback = fakeClient("FB");
    const router = createRoutedChatClient({
      routes: [{ match: matchesPrefix("claude"), client: a.client }],
      fallback: fallback.client,
    });

    const r = await router.chat(emptyRequest("mistral-large"));
    expect(r.content).toBe("FB");
    expect(fallback.calls).toEqual(["mistral-large"]);
  });

  test("throws when no route matches and no fallback is given", async () => {
    const a = fakeClient("A");
    const router = createRoutedChatClient({
      routes: [{ match: matchesPrefix("claude"), client: a.client }],
    });

    await expect(router.chat(emptyRequest("gpt-4o"))).rejects.toThrow(
      /no chat client registered for model "gpt-4o"/,
    );
  });

  test("matchesPrefix is case-insensitive", () => {
    const m = matchesPrefix("Claude", "anthropic:");
    expect(m("claude-haiku-4-5")).toBe(true);
    expect(m("CLAUDE-OPUS")).toBe(true);
    expect(m("anthropic:claude")).toBe(true);
    expect(m("gpt-4o")).toBe(false);
  });

  test("routes evaluated in declared order — first match wins", async () => {
    const general = fakeClient("general");
    const specific = fakeClient("specific");
    const router = createRoutedChatClient({
      routes: [
        // Intentionally place the broad rule before the narrow one.
        { match: () => true, client: general.client },
        { match: matchesPrefix("claude"), client: specific.client },
      ] satisfies Route[],
    });

    const r = await router.chat(emptyRequest("claude-haiku"));
    expect(r.content).toBe("general");
    expect(specific.calls).toEqual([]);
  });

  test("route rewriteModel can strip provider routing prefixes", async () => {
    const openai = fakeClient("openai");
    const router = createRoutedChatClient({
      routes: [
        {
          match: matchesPrefix("openai:"),
          rewriteModel: stripPrefix("openai:"),
          client: openai.client,
        },
      ],
    });

    const r = await router.chat(emptyRequest("openai:gpt-4o-mini"));
    expect(r.content).toBe("openai");
    expect(openai.calls).toEqual(["gpt-4o-mini"]);
  });

  test("routes capability lookups through matching and model rewrites", () => {
    const seenModels: string[] = [];
    const capable: ChatClient = {
      capabilities(model) {
        seenModels.push(model);
        return MULTIMODAL_CAPABILITIES;
      },
      async chat() {
        return {
          role: "assistant",
          content: "unused",
          refusal: null,
        } as OpenAI.Chat.ChatCompletionMessage;
      },
    };
    const router = createRoutedChatClient({
      routes: [
        {
          match: matchesPrefix("openai:"),
          rewriteModel: stripPrefix("openai:"),
          client: capable,
        },
      ],
    });

    expect(chatClientCapabilities(router, "openai:gpt-4o-mini")).toEqual(
      MULTIMODAL_CAPABILITIES,
    );
    expect(seenModels).toEqual(["gpt-4o-mini"]);
  });

  test("capability helper defaults plain test doubles to text-only", () => {
    const plain = fakeClient("plain").client;
    expect(chatClientCapabilities(plain, "any-model")).toEqual(
      TEXT_ONLY_CHAT_CLIENT_CAPABILITIES,
    );
  });
});
