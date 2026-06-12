import {
  chatClientCapabilities,
  type ChatClient,
  type ChatRequest,
} from "../agent/loop.ts";

/**
 * A routing rule: if `match(model)` returns true, requests for that
 * model are forwarded to `client`. The router tries routes in order
 * and uses the first match. If no route matches the request's model,
 * the optional `fallback` is used; otherwise the router throws.
 *
 * This is what enables mixing models from different providers inside
 * a single agent run — the loop only sees one ChatClient, but each
 * turn can resolve to a different backend.
 */
export interface Route {
  match: (model: string) => boolean;
  client: ChatClient;
  rewriteModel?: (model: string) => string;
}

export interface RouterOptions {
  routes: Route[];
  fallback?: ChatClient;
}

export function createRoutedChatClient(opts: RouterOptions): ChatClient {
  const { routes, fallback } = opts;
  const noClientError = (model: string) =>
    new Error(`no chat client registered for model "${model}"`);

  return {
    capabilities(model) {
      for (const route of routes) {
        if (route.match(model)) {
          const routedModel = route.rewriteModel
            ? route.rewriteModel(model)
            : model;
          return chatClientCapabilities(route.client, routedModel);
        }
      }
      if (fallback) return chatClientCapabilities(fallback, model);
      throw noClientError(model);
    },

    async chat(request: ChatRequest) {
      for (const route of routes) {
        if (route.match(request.model)) {
          const routedRequest = route.rewriteModel
            ? { ...request, model: route.rewriteModel(request.model) }
            : request;
          return route.client.chat(routedRequest);
        }
      }
      if (fallback) return fallback.chat(request);
      throw noClientError(request.model);
    },
  };
}

/**
 * Convenience: build a `match` predicate that accepts any of the given
 * prefixes (case-insensitive on the prefix portion).
 */
export function matchesPrefix(...prefixes: string[]): (model: string) => boolean {
  const lowered = prefixes.map((p) => p.toLowerCase());
  return (model: string) => {
    const m = model.toLowerCase();
    return lowered.some((p) => m.startsWith(p));
  };
}

export function stripPrefix(...prefixes: string[]): (model: string) => string {
  const lowered = prefixes.map((p) => p.toLowerCase());
  return (model: string) => {
    const m = model.toLowerCase();
    const prefix = lowered.find((p) => m.startsWith(p));
    if (!prefix) return model;
    return model.slice(prefix.length);
  };
}
