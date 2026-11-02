import {
  DEBUGBAR_HEADER,
  takeDebugbarPayload,
} from "@uplide/debugbar-protocol";
import { beginCapture } from "./capture.js";
import { getDebugbarConfig } from "./config.js";
import { createEntry } from "./entry.js";
import { pushDebugbarEntry } from "./store.js";
import type { DebugbarEntry, DebugbarSource } from "./types.js";

export interface WrapFetchOptions {
  source?: DebugbarSource;
  /** Where entries go. Default: the browser overlay store. */
  onEntry?: (entry: DebugbarEntry) => void;
  /** Return false to leave a request untouched (e.g. outside a render). */
  inScope?: () => boolean;
}

type Fetch = typeof fetch;

function resolveUrl(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const base = (globalThis as { location?: { href?: string } }).location?.href;

  try {
    return new URL(raw, base).href;
  } catch {
    return raw;
  }
}

function isJson(response: Response): boolean {
  return /\bjson\b/i.test(response.headers.get("content-type") ?? "");
}

/**
 * Rebuilds the response around the stripped body. `url` and `redirected`
 * cannot be passed to the constructor, so they are copied over by hand to keep
 * the object indistinguishable from the original for the caller.
 *
 * The flag header goes too: the payload is consumed, and a second wrapper
 * further out in the chain then passes the response through unread.
 */
function rebuild(original: Response, body: string): Response {
  const headers = new Headers(original.headers);
  // The body changed length and is no longer encoded.
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete(DEBUGBAR_HEADER);

  const response = new Response(body, {
    status: original.status,
    statusText: original.statusText,
    headers,
  });

  Object.defineProperty(response, "url", { value: original.url });
  Object.defineProperty(response, "redirected", { value: original.redirected });

  return response;
}

/** Bounded memory of captured backend request ids. */
const SEEN_LIMIT = 500;
const SEEN = Symbol.for("@uplide/debugbar/seen-request-ids");

type SeenHolder = { [SEEN]?: Set<string> };

/**
 * A response replayed from a framework cache (Next's Data Cache, its per-render
 * dedup) carries the payload of the request that filled it. The backend's
 * request id makes that visible: an id seen before is not a new request.
 */
function isReplay(requestId: string | undefined): boolean {
  if (!requestId) return false;

  const seen = ((globalThis as SeenHolder)[SEEN] ??= new Set());
  if (seen.has(requestId)) return true;

  seen.add(requestId);
  if (seen.size > SEEN_LIMIT) {
    seen.delete(seen.values().next().value as string);
  }

  return false;
}

/**
 * Wraps a `fetch` so responses from the configured backend are captured.
 *
 * Only a response that is in scope, matched, not opted out, flagged with the
 * `x-debugbar` header and JSON is ever read; every other response is returned
 * as the same object with its stream untouched. The caller's `init` is passed
 * through unchanged — adding e.g. a `signal` would opt it out of Next's dedup.
 */
export function wrapFetch(fetchImpl: Fetch, options: WrapFetchOptions = {}): Fetch {
  const source = options.source ?? "csr";
  const onEntry = options.onEntry ?? pushDebugbarEntry;

  const debugbarFetch: Fetch = async function debugbarFetch(input, init) {
    const config = getDebugbarConfig();
    const url = resolveUrl(input);

    if (
      !config.enabled ||
      init?.debugbar === false ||
      !config.match(url) ||
      !(options.inScope?.() ?? true)
    ) {
      return fetchImpl(input, init);
    }

    const finish = beginCapture();

    try {
      const response = await fetchImpl(input, init);
      if (!response.headers.has(DEBUGBAR_HEADER) || !isJson(response)) {
        return response;
      }

      const text = await response.text();
      let body: unknown;

      try {
        body = JSON.parse(text);
      } catch {
        return rebuild(response, text);
      }

      const taken = takeDebugbarPayload(body, config.responseKey);
      if (!taken) return rebuild(response, text);

      const stripped = JSON.stringify(body);
      if ("payload" in taken && isReplay(taken.payload.requestId)) {
        return rebuild(response, stripped);
      }
      const request = input instanceof Request ? input : null;

      onEntry(
        createEntry(
          source,
          {
            method: init?.method ?? request?.method ?? "GET",
            url,
            statusCode: response.status,
            requestHeaders: new Headers(init?.headers ?? request?.headers),
            requestBody: init?.body,
            responseHeaders: response.headers,
            responseBody: stripped,
          },
          taken,
          config,
        ),
      );

      return rebuild(response, stripped);
    } finally {
      finish();
    }
  };

  return Object.assign(debugbarFetch, { [WRAPPED]: true });
}

/** Marks a `fetch` produced by `wrapFetch`. */
const WRAPPED = Symbol.for("@uplide/debugbar/fetch-wrapped");

type MaybeWrapped = Fetch & { [WRAPPED]?: true };

/**
 * Replaces `target.fetch` with a wrapped one unless the current `fetch`
 * already is one. Wraps whatever `fetch` is current, so another library's
 * earlier patch stays in the chain.
 *
 * Safe to call again whenever the host may have swapped `fetch` out (Next's dev
 * server restores its original after every recompile): it re-wraps only then.
 * Returns an uninstall function that restores the previous `fetch`.
 */
export function installFetchCapture(
  options: WrapFetchOptions = {},
  target: { fetch: Fetch } = globalThis,
): () => void {
  if ((target.fetch as MaybeWrapped)[WRAPPED]) return () => {};

  const previous = target.fetch;
  const wrapped = wrapFetch(previous.bind(target), options);
  target.fetch = wrapped;

  return () => {
    if (target.fetch === wrapped) target.fetch = previous;
  };
}
