import type { DebugbarTakeResult } from "@uplide/debugbar-protocol";
import type { ResolvedDebugbarConfig } from "./config.js";
import {
  type DebugbarRedactKey,
  type DebugbarRedactRules,
  REDACTED,
  redactJsonText,
  redactUrl,
  redactValue,
} from "./redact.js";
import type {
  DebugbarBody,
  DebugbarEntry,
  DebugbarExchange,
  DebugbarSource,
} from "./types.js";

/**
 * Headers whose values an SSR capture shows. A server-side request carries
 * headers the browser never sent — service tokens, internal keys under any
 * name — and SSR entries are serialized into the page, so everything else is
 * masked rather than trusted to a name pattern.
 */
const SSR_VISIBLE_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "age",
  "cache-control",
  "connection",
  "content-encoding",
  "content-language",
  "content-length",
  "content-type",
  "date",
  "etag",
  "expires",
  "last-modified",
  "pragma",
  "transfer-encoding",
  "user-agent",
  "vary",
  "x-correlation-id",
  "x-debugbar",
  "x-request-id",
];

/** A transport's view of one request/response, before redaction or trimming. */
export interface DebugbarRawExchange {
  method: string;
  /** Absolute when the transport knows the base URL. */
  url: string;
  statusCode?: number;
  requestHeaders: unknown;
  /** Explicit query params (axios `params`); the URL's own search is merged. */
  params?: unknown;
  requestBody: unknown;
  responseHeaders: unknown;
  responseBody: unknown;
}

let sequence = 0;

/** A plain list is the older `redactHeaders`-style "always mask these". */
function toRules(
  rules: DebugbarRedactRules | readonly DebugbarRedactKey[],
): DebugbarRedactRules {
  return Array.isArray(rules) ? { keys: rules } : (rules as DebugbarRedactRules);
}

/**
 * Captured verbatim, never pretty-printed here: the panel offers a raw/JSON
 * switch, and indenting at capture time would both inflate the store and make
 * the raw view impossible to reconstruct. Sensitive JSON fields are masked
 * before truncation, so a cut can never expose half a secret's key.
 */
export function toBody(
  value: unknown,
  maxChars: number,
  rules: DebugbarRedactRules | readonly DebugbarRedactKey[] = {},
): DebugbarBody | null {
  if (value === undefined || value === null || value === "") return null;

  let text: string;

  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      // Circular or non-serializable (FormData, streams): say so instead of
      // throwing inside an interceptor.
      text = `[unserializable ${Object.prototype.toString.call(value)}]`;
    }
  }

  text = redactJsonText(text, toRules(rules));

  return {
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    bytes: text.length,
  };
}

function headerEntries(value: unknown): Iterable<[string, unknown]> {
  if (!value || typeof value !== "object") return [];

  // `Headers` (fetch) iterates its own entries.
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return value.entries();
  }

  // `AxiosHeaders` keeps its entries behind accessors; `toJSON` is its own
  // documented way to get a plain object out of it.
  if ("toJSON" in value && typeof value.toJSON === "function") {
    const plain: unknown = value.toJSON();

    if (plain && typeof plain === "object") return Object.entries(plain);
  }

  if (Array.isArray(value)) return value as [string, unknown][];

  return Object.entries(value);
}

/**
 * Credentials never belong in a panel that can be screenshotted into a ticket.
 * Values are replaced, not dropped, so it stays obvious the header was sent.
 * With `visible`, only those names keep their value (the SSR allowlist).
 */
export function toHeaders(
  value: unknown,
  rules: DebugbarRedactRules | readonly DebugbarRedactKey[] = {},
  visible?: ReadonlySet<string>,
): Record<string, string> {
  const resolved = toRules(rules);
  const headers: Record<string, string> = {};

  for (const [key, raw] of headerEntries(value)) {
    if (raw === undefined || raw === null) continue;

    headers[key] =
      visible && !visible.has(key.toLowerCase())
        ? REDACTED
        : redactValue(key, String(raw), resolved);
  }

  return headers;
}

function toQuery(
  url: string,
  params: unknown,
  rules: DebugbarRedactRules,
): Record<string, string> {
  const query: Record<string, string> = {};

  if (params && typeof params === "object") {
    for (const [key, raw] of Object.entries(params)) {
      if (raw !== undefined && raw !== null) query[key] = String(raw);
    }
  }

  const search = url.split("?")[1]?.split("#")[0] ?? "";

  for (const [key, raw] of new URLSearchParams(search)) query[key] = raw;

  for (const [key, raw] of Object.entries(query)) {
    query[key] = redactValue(key, raw, rules);
  }

  return query;
}

function visibleHeaders(
  source: DebugbarSource,
  config: ResolvedDebugbarConfig,
): ReadonlySet<string> | undefined {
  if (source !== "ssr" || config.ssrHeaders === "all") return undefined;

  return new Set(
    [...SSR_VISIBLE_HEADERS, ...config.ssrHeaders].map((name) =>
      name.toLowerCase(),
    ),
  );
}

function toExchange(
  source: DebugbarSource,
  raw: DebugbarRawExchange,
  config: ResolvedDebugbarConfig,
): DebugbarExchange {
  const rules = configRules(config);
  const headerRules = {
    ...rules,
    keys: [...config.redactHeaders, ...config.redactKeys],
  };
  const visible = visibleHeaders(source, config);

  return {
    requestHeaders: toHeaders(raw.requestHeaders, headerRules, visible),
    query: toQuery(raw.url, raw.params, rules),
    requestBody: toBody(raw.requestBody, config.maxBodyChars, rules),
    responseHeaders: toHeaders(raw.responseHeaders, headerRules, visible),
    // Passed in *after* the payload key was taken off, so what is shown is the
    // envelope the app actually receives.
    responseBody: toBody(raw.responseBody, config.maxBodyChars, rules),
  };
}

function configRules(config: ResolvedDebugbarConfig): DebugbarRedactRules {
  return { keys: config.redactKeys, reveal: config.revealKeys };
}

export function createEntry(
  source: DebugbarSource,
  raw: DebugbarRawExchange,
  taken: DebugbarTakeResult,
  config: ResolvedDebugbarConfig,
): DebugbarEntry {
  sequence += 1;

  const payload = "payload" in taken ? taken.payload : null;
  const requestId = payload?.requestId ?? "error";

  return {
    id: `${source}-${sequence}-${requestId}`,
    source,
    method: raw.method.toUpperCase(),
    url: redactUrl(raw.url, configRules(config)),
    statusCode: raw.statusCode,
    capturedAt: new Date().toISOString(),
    payload,
    ...("error" in taken ? { payloadError: taken.error.error } : {}),
    exchange: toExchange(source, raw, config),
  };
}
