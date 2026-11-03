import { DEFAULT_RESPONSE_KEY } from "@uplide/upspector-protocol";
import type { UpspectorRedactKey } from "./redact.js";

export interface UpspectorConfig {
  /** Master switch. When false no adapter touches a single request. */
  enabled: boolean;
  /** Decides which absolute request URLs belong to the instrumented backend. */
  match: (url: string) => boolean;
  /** Must equal the backend's `responseKey`. Default `"upspector"`. */
  responseKey?: string;
  /** Extra header names to mask, on top of the built-in credential patterns. */
  redactHeaders?: string[];
  /**
   * Extra names to mask in headers, query parameters and JSON bodies. A string
   * matches a whole name case-insensitively; a RegExp is tested against it.
   * Built in: names with a token/secret/password/cookie/… part always,
   * names with a key/session/auth part when the value looks generated, and
   * values shaped like JWTs or `Bearer` credentials under any name.
   */
  redactKeys?: UpspectorRedactKey[];
  /**
   * Names never masked by the name rules, for fields that only look like
   * credentials in this app (e.g. `"sortKey"`, `/^session(Count|Start)$/`).
   * Values with a credential format (JWT, `Bearer …`) are masked regardless.
   */
  revealKeys?: UpspectorRedactKey[];
  /**
   * Header values an SSR capture keeps, on top of a built-in allowlist of
   * content, caching and correlation headers; every other value is masked.
   * `"all"` turns the allowlist off and leaves only the name patterns.
   */
  ssrHeaders?: string[] | "all";
  /** Captured request/response bodies are cut to this length. Default 24 000. */
  maxBodyChars?: number;
  /** Route the element picker posts to. Default `/api/upspector/inspect`. */
  inspectEndpoint?: string;
  /**
   * Forward every captured entry and render pass to the dev server's
   * `/api/upspector/events` route, for an agent to read over MCP. Default
   * `false`: the entries carry SQL and bodies.
   */
  mcp?: boolean;
}

export type ResolvedUpspectorConfig = Required<UpspectorConfig>;

export const DEFAULT_INSPECT_ENDPOINT = "/api/upspector/inspect";
export const EVENTS_ENDPOINT = "/api/upspector/events";

/**
 * Bodies are kept for every captured request, so one fat list response must
 * not be able to blow up the store or the RSC payload.
 */
const DEFAULT_MAX_BODY_CHARS = 24_000;

/**
 * Pinned on `globalThis` rather than module scope: a host can end up with two
 * copies of this package (two versions, or ESM next to CJS) and both must read
 * the one config the app registered.
 */
const CONFIG = Symbol.for("@uplide/upspector/config");

type ConfigHolder = { [CONFIG]?: ResolvedUpspectorConfig };

export function defineUpspectorConfig(
  config: UpspectorConfig,
): ResolvedUpspectorConfig {
  return {
    enabled: config.enabled,
    match: config.match,
    responseKey: config.responseKey ?? DEFAULT_RESPONSE_KEY,
    redactHeaders: config.redactHeaders ?? [],
    redactKeys: config.redactKeys ?? [],
    revealKeys: config.revealKeys ?? [],
    ssrHeaders: config.ssrHeaders ?? [],
    maxBodyChars: config.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS,
    inspectEndpoint: config.inspectEndpoint ?? DEFAULT_INSPECT_ENDPOINT,
    mcp: config.mcp ?? false,
  };
}

export function setUpspectorConfig(config: UpspectorConfig): ResolvedUpspectorConfig {
  const resolved = defineUpspectorConfig(config);
  (globalThis as ConfigHolder)[CONFIG] = resolved;

  return resolved;
}

/**
 * The registered config, or a disabled default when nothing registered one:
 * the payload carries SQL, logs and request bodies, so capturing must be an
 * explicit `setUpspectorConfig({ enabled: true, ... })`, never a fallback.
 */
export function getUpspectorConfig(): ResolvedUpspectorConfig {
  return (
    (globalThis as ConfigHolder)[CONFIG] ??
    defineUpspectorConfig({ enabled: false, match: () => false })
  );
}
