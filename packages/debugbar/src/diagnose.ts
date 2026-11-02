import { getDebugbarConfig } from "./config.js";
import { useDebugbarStore } from "./store.js";

/** Same key the overlay reads for its per-browser mute. */
export const MUTE_STORAGE_KEY = "debugbar.enabled";

/** Long enough for a page's first API round trips to land. */
const QUIET_PERIOD_MS = 6000;

let reported = false;

function isMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "false";
  } catch {
    return false;
  }
}

/**
 * Tells the developer *why* the bar is invisible.
 *
 * The overlay renders nothing until a response carries a payload, so a
 * misconfigured backend or a muted browser looks exactly like "the feature is
 * broken". One console line removes that ambiguity.
 */
export function reportDebugbarStatus(): void {
  if (reported || typeof window === "undefined") return;
  reported = true;

  const label = "%c[debugbar]%c";
  const labelStyle = "font-weight:bold";
  const reset = "font-weight:inherit";

  if (isMuted()) {
    console.info(
      `${label} muted in this browser — run localStorage.removeItem("${MUTE_STORAGE_KEY}") and reload to bring the bar back.`,
      labelStyle,
      reset,
    );
    return;
  }

  window.setTimeout(() => {
    if (useDebugbarStore.getState().entries.length > 0) return;

    const key = getDebugbarConfig().responseKey;

    console.info(
      `${label} capturing, but no response carried a \`${key}\` payload yet. Check that the backend's debugbar is enabled, that its response key is "${key}", that the config's \`match\` accepts the backend URL, and (for fetch in the browser) that the backend exposes the x-debugbar header through CORS.`,
      labelStyle,
      reset,
    );
  }, QUIET_PERIOD_MS);
}
