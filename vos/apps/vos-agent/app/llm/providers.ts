import type { ChatClient } from "../agent/loop.ts";
import type { Config } from "../config.ts";
import { createAnthropicChatClient } from "./anthropic-client.ts";
import { createDeepSeekChatClient } from "./deepseek-client.ts";
import { createOpenAICompatibleChatClient } from "./openai-compatible-client.ts";
import { createOpenAIChatClient } from "./openai-client.ts";
import {
  createRoutedChatClient,
  matchesPrefix,
  stripPrefix,
  type Route,
} from "./router.ts";
import { withRetryingChatClient } from "./retry.ts";

const ANTHROPIC_PREFIXES = [
  "claude",
  "opus",
  "sonnet",
  "haiku",
  "anthropic:",
  "anthropic/",
];
const DEEPSEEK_PREFIXES = ["deepseek:", "deepseek/", "deepseek-"];
const OPENAI_COMPATIBLE_PREFIXES = [
  "openai-compatible:",
  "openai-compatible/",
  "compat:",
  "compat/",
];
const OPENAI_PREFIXES = ["gpt", "o1", "o3", "o4", "openai:", "openai/"];
const STRIPPED_ANTHROPIC_PREFIXES = ["anthropic:"];
const STRIPPED_DEEPSEEK_PREFIXES = ["deepseek:"];
const STRIPPED_OPENAI_COMPATIBLE_PREFIXES = ["openai-compatible:", "compat:"];
const STRIPPED_OPENAI_PREFIXES = ["openai:"];

/**
 * Build a routed ChatClient from a Config. Only providers whose
 * credentials are present are instantiated. The router dispatches by
 * model-name prefix:
 *
 *   claude*, opus*, sonnet*, haiku*, anthropic:* → Anthropic
 *   deepseek*, deepseek:*                        → DeepSeek
 *   openai-compatible:*, compat:*               → OpenAI-compatible
 *   gpt*, o1*, o3*, o4*, openai:*               → OpenAI
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
  if (config.deepseek) {
    const client = createDeepSeekChatClient(config.deepseek);
    routes.push({
      match: matchesPrefix(...DEEPSEEK_PREFIXES),
      client,
      rewriteModel: stripPrefix(...STRIPPED_DEEPSEEK_PREFIXES),
    });
    onlyConfiguredClient = onlyConfiguredClient ? undefined : client;
  } else {
    routes.push({
      match: matchesPrefix(...DEEPSEEK_PREFIXES),
      client: missingProviderClient("DeepSeek", "DEEPSEEK_API_KEY"),
    });
  }
  if (config.openaiCompatible) {
    const client = createOpenAICompatibleChatClient(config.openaiCompatible);
    routes.push({
      match: matchesPrefix(...OPENAI_COMPATIBLE_PREFIXES),
      client,
      rewriteModel: stripPrefix(...STRIPPED_OPENAI_COMPATIBLE_PREFIXES),
    });
    onlyConfiguredClient = onlyConfiguredClient ? undefined : client;
  } else {
    routes.push({
      match: matchesPrefix(...OPENAI_COMPATIBLE_PREFIXES),
      client: missingProviderClient("OpenAI-compatible", "OPENAI_COMPATIBLE_API_KEY"),
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

  const routed = createRoutedChatClient({
    routes,
    fallback: onlyConfiguredClient,
  });
  return withRetryingChatClient(routed, config.chatRetry);
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
