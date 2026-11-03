import { getDebugbarConfig } from "./config.js";
import { redactUrl } from "./redact.js";
import { useDebugbarStore } from "./store.js";
import type { DebugbarEntry, DebugbarRenderPass } from "./types.js";

/** Short enough that an agent asking right after a click sees the click. */
const FLUSH_DELAY_MS = 200;

/** `keepalive` bodies are capped at 64 KiB per page by the fetch spec. */
const KEEPALIVE_LIMIT = 60_000;

const TAB_STORAGE_KEY = "debugbar.tab";

interface ForwardItem {
  pageUrl: string;
  entry?: DebugbarEntry;
  renderPass?: DebugbarRenderPass;
}

function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Stable across reloads of one tab, distinct between tabs. */
function tabId(): string {
  try {
    const held = window.sessionStorage.getItem(TAB_STORAGE_KEY);
    if (held) return held;

    const fresh = randomId();
    window.sessionStorage.setItem(TAB_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

/**
 * Forwards what the overlay store receives to `endpoint`, so a dev-server
 * route can hand it to an agent. Each record is tagged with the page it was
 * seen on: an agent driving the browser asks "what did that page do", not
 * "what was request 41".
 *
 * Returns a function that stops forwarding.
 */
export function forwardDebugbarEntries(endpoint: string): () => void {
  if (typeof window === "undefined") return () => {};

  const tab = tabId();
  const sent = new Set<string>();
  let sentRenderPass: string | null = null;
  let queue: ForwardItem[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pageUrl = () => {
    const config = getDebugbarConfig();
    return redactUrl(window.location.href, {
      keys: config.redactKeys,
      reveal: config.revealKeys,
    });
  };

  const flush = (keepalive = false) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (queue.length === 0) return;

    const body = JSON.stringify({ tabId: tab, items: queue });
    queue = [];

    void fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: keepalive && body.length < KEEPALIVE_LIMIT,
      debugbar: false,
    }).catch(() => {
      // The dev server restarting must not surface as page errors.
    });
  };

  const enqueue = (item: ForwardItem) => {
    queue.push(item);
    timer ??= setTimeout(flush, FLUSH_DELAY_MS);
  };

  const notice = ({
    entries,
    renderPass,
  }: {
    entries: DebugbarEntry[];
    renderPass: DebugbarRenderPass | null;
  }) => {
    const url = pageUrl();

    for (const entry of entries) {
      if (sent.has(entry.id)) continue;
      sent.add(entry.id);
      enqueue({ pageUrl: url, entry });
    }
    // The store is a ring buffer, so ids that left it can be forgotten.
    if (sent.size > entries.length * 2) {
      const live = new Set(entries.map((entry) => entry.id));
      for (const id of sent) if (!live.has(id)) sent.delete(id);
    }

    if (renderPass && renderPass.id !== sentRenderPass) {
      sentRenderPass = renderPass.id;
      enqueue({ pageUrl: url, renderPass });
    }
  };

  notice(useDebugbarStore.getState());
  const unsubscribe = useDebugbarStore.subscribe(notice);
  const onPageHide = () => flush(true);
  window.addEventListener("pagehide", onPageHide);

  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", onPageHide);
    flush();
  };
}
