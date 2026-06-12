import type { ChatClient } from "../agent/loop.ts";
import type { Config } from "../config.ts";
import { createAnthropicChatClient } from "./anthropic-client.ts";
import { createOpenAIChatClient } from "./openai-client.ts";
import {
  createRoutedChatClient,
  matchesPrefix,
  stripPrefix,
  type Route,
} from "./router.ts";

const ANTHROPIC_PREFIXES = [
  "claude",
  "opus",
  "sonnet",
  "haiku",
  "anthropic:",
  "anthropic/",
];
const OPENAI_PREFIXES = ["gpt", "o1", "o3", "o4", "openai:", "openai/"];
const STRIPPED_ANTHROPIC_PREFIXES = ["anthropic:"];
const STRIPPED_OPENAI_PREFIXES = ["openai:"];

/**
 * Build a routed ChatClient from a Config. Only providers whose
 * credentials are present are instantiated. The router dispatches by
 * model-name prefix:
 *
 *   claude*, opus*, sonnet*, haiku*, anthropic:* → Anthropic
 *   gpt*, o1*, o3*, o4*, openai:*               → OpenAI-compatible
 *
 * Colon prefixes are routing hints and are stripped before the SDK
 * call. Slash prefixes such as `anthropic/claude-*` are provider/model
 * namespaces used by some gateways and are preserved.
 *
 * If exactly one provider is configured, it is also used as the
 * fallback so unprefixed model names route to it cleanly. When both
 * providers are configured, only models matching a known prefix
 * resolve; anything else throws a clear error.
 */
export function createChatClientFromConfig(config: Config): ChatClient {
  const routes: Route[] = [];
  let onlyConfiguredClient: ChatClient | undefined;

  if (config.anthropic) {
    const client = createAnthropicChatClient(config.anthropic);
    routes.push({
      match: matchesPrefix(...ANTHROPIC_PREFIXES),
      client,
      rewriteModel: stripPrefix(...STRIPPED_ANTHROPIC_PREFIXES),
    });
    onlyConfiguredClient = client;
  } else {
    routes.push({
      match: matchesPrefix(...ANTHROPIC_PREFIXES),
      client: missingProviderClient("Anthropic", "ANTHROPIC_API_KEY"),
    });
  }
  if (config.openai) {
    const client = createOpenAIChatClient(config.openai);
    routes.push({
      match: matchesPrefix(...OPENAI_PREFIXES),
      client,
      rewriteModel: stripPrefix(...STRIPPED_OPENAI_PREFIXES),
    });
    onlyConfiguredClient = onlyConfiguredClient ? undefined : client;
  } else {
    routes.push({
      match: matchesPrefix(...OPENAI_PREFIXES),
      client: missingProviderClient("OpenAI", "OPENAI_API_KEY"),
    });
  }

  return createRoutedChatClient({
    routes,
    fallback: onlyConfiguredClient,
  });
}

function missingProviderClient(provider: string, envVar: string): ChatClient {
  const providerError = (model: string) =>
    new Error(
      `${provider} provider is not configured for model "${model}". Set ${envVar} or choose a configured model.`,
    );

  return {
    capabilities(model) {
      throw providerError(model);
    },

    async chat(request) {
      throw providerError(request.model);
    },
  };
}
