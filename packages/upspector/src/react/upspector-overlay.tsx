"use client";

import { UPSPECTOR_PAYLOAD_VERSION } from "@uplide/upspector-protocol";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { MUTE_STORAGE_KEY, reportUpspectorStatus } from "../diagnose.js";
import { matchesEndpoint } from "../inspect-path.js";
import { useUpspectorStore } from "../store.js";
import type {
  UpspectorBody,
  UpspectorCommitInfo,
  UpspectorEntry,
  UpspectorExchange,
  UpspectorInspectSource,
  UpspectorPayload,
  UpspectorRenderPass,
} from "../types.js";
import { UpspectorPicker, PICKER_SHORTCUT } from "./upspector-picker.js";

/**
 * Local, per-browser kill switch. The host's flag decides whether the overlay
 * is mounted at all; this one lets a developer silence it for a session
 * without restarting anything.
 */
const STORAGE_KEY = MUTE_STORAGE_KEY;

type EntryWithPayload = UpspectorEntry & { payload: UpspectorPayload };

function hasPayload(entry: UpspectorEntry): entry is EntryWithPayload {
  return entry.payload !== null;
}

const TABS = [
  "inspect",
  "render",
  "request",
  "database",
  "timers",
  "cache",
  "http",
  "logs",
] as const;
type Tab = (typeof TABS)[number];

/**
 * Real stylesheet instead of inline styles: the bar needs hover states, sticky
 * table headers and a grid layout, none of which inline styles express. Class
 * names are prefixed so nothing can collide with app CSS.
 *
 * Dark devtools surface so the bar never reads as part of the page, with one
 * accent colour. `:where(:root)` has zero specificity, so a host overrides
 * `--udbg-accent` with any plain `:root` rule.
 */
const CSS = `
:where(:root){--udbg-accent:#e84393}
.udbg-mark{display:block;width:20px;height:20px;border-radius:5px}
.udbg-brand .udbg-mark{width:15px;height:15px;border-radius:4px}
.udbg-dock{position:fixed;z-index:2147483000;display:flex;align-items:center;gap:2px;height:38px;padding:0 4px;border:1px solid #2b303b;border-radius:12px;background:#15181f;color:#c7cedb;font:12px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:grab;user-select:none;touch-action:none}
.udbg-dock[data-dragging="true"]{cursor:grabbing;border-color:var(--udbg-accent);box-shadow:0 10px 30px color-mix(in srgb,var(--udbg-accent) 30%,transparent)}
.udbg-dock *{box-sizing:border-box}
.udbg-dock-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;min-width:30px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.udbg-dock-btn:hover{background:#1d222c;color:#fff}
.udbg-dock-btn[data-tone="accent"]{background:var(--udbg-accent);color:#fff}
.udbg-dock-stat{color:#8b93a3;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;white-space:nowrap}
.udbg-dock-stat b{color:#f2f4f8;font-weight:600}
.udbg-dock-sep{width:1px;height:18px;margin:0 2px;background:#2b303b}
.udbg-tuck{position:fixed;z-index:2147483000;display:flex;align-items:center;justify-content:center;width:26px;height:42px;padding:0;border:1px solid #2b303b;background:#15181f;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.45)}
.udbg-tuck[data-side="right"]{right:0;border-right:0;border-radius:10px 0 0 10px}
.udbg-tuck[data-side="left"]{left:0;border-left:0;border-radius:0 10px 10px 0}
.udbg-tuck:hover{border-color:var(--udbg-accent)}
.udbg-tuck .udbg-mark{width:16px;height:16px;border-radius:4px}
.udbg{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-direction:column;background:#0f1216;color:#d7dbe3;font:12px/1.55 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;border-top:1px solid #2b303b;box-shadow:0 -10px 30px rgba(0,0,0,.45)}
.udbg *{box-sizing:border-box}
.udbg-grip{height:6px;flex:none;cursor:ns-resize;background:transparent}
.udbg-grip:hover,.udbg-grip[data-dragging="true"]{background:var(--udbg-accent)}
.udbg-head{display:flex;align-items:center;gap:10px;flex:none;padding:0 10px;height:40px;border-bottom:1px solid #1d222b;background:#131720}
.udbg-brand{display:flex;align-items:center;gap:7px;font-weight:600;letter-spacing:.01em;color:#f2f4f8}
.udbg-route{color:#8b93a3;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}
.udbg-stats{display:flex;align-items:center;gap:6px;margin-left:auto}
.udbg-stat{display:inline-flex;align-items:baseline;gap:4px;padding:2px 8px;border:1px solid #242a35;border-radius:999px;background:#171b24;color:#aeb6c4;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;white-space:nowrap}
.udbg-stat b{color:#f2f4f8;font-weight:600}
.udbg-actions{display:flex;align-items:center;gap:6px}
.udbg-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border:1px solid #2b303b;border-radius:7px;background:#171b24;color:#c7cedb;font:12px/1 inherit;cursor:pointer}
.udbg-btn:hover{border-color:#3c4350;background:#1d222c;color:#fff}
.udbg-btn[data-tone="accent"]{border-color:var(--udbg-accent);background:var(--udbg-accent);color:#fff}
.udbg-btn[data-tone="accent"]:hover{background:color-mix(in srgb,var(--udbg-accent) 85%,#fff);border-color:color-mix(in srgb,var(--udbg-accent) 85%,#fff)}
.udbg-icon-btn{width:26px;padding:0;justify-content:center}
.udbg-subbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #1d222b;background:#131720}
.udbg-seg{display:inline-flex;padding:2px;border:1px solid #2b303b;border-radius:8px;background:#0f1216}
.udbg-seg-btn{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#99a1b1;font:11.5px/1 inherit;cursor:pointer;text-transform:lowercase}
.udbg-seg-note{color:#6f788a;font-size:10.5px}
.udbg-seg-btn[data-active="true"] .udbg-seg-note{color:rgba(255,255,255,.75)}
.udbg-seg-btn:hover{color:#e7eaf0}
.udbg-seg-btn[data-active="true"]{background:var(--udbg-accent);color:#fff}
.udbg-json{max-height:46vh;padding:10px;overflow:auto;background:#0c0f13;font:11.5px/1.7 ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
.udbg-json-row{display:flex;align-items:flex-start;gap:5px;word-break:break-word}
.udbg-json-row:hover{background:#141a23}
.udbg-json-toggle{width:12px;flex:none;padding:0;border:0;background:transparent;color:#6f788a;font:inherit;line-height:inherit;text-align:left;cursor:pointer}
button.udbg-json-toggle:hover{color:var(--udbg-accent)}
.udbg-json-key{color:#79c0ff}
.udbg-json-str{color:#7ee2a8;white-space:pre-wrap}
.udbg-json-num{color:#f0a5c8}
.udbg-json-bool{color:#c4b5fd}
.udbg-json-null{color:#6f788a}
.udbg-json-meta{color:#6f788a}
.udbg-tabs{display:flex;align-items:center;gap:2px;flex:none;padding:6px 10px;border-bottom:1px solid #1d222b;overflow-x:auto}
.udbg-tab{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border:0;border-radius:7px;background:transparent;color:#99a1b1;font:12px/1 inherit;cursor:pointer;white-space:nowrap}
.udbg-tab:hover{background:#1a1f28;color:#e7eaf0}
.udbg-tab[data-active="true"]{background:var(--udbg-accent);color:#fff}
.udbg-tab-count{padding:0 5px;border-radius:999px;background:rgba(255,255,255,.14);color:inherit;font-size:10.5px;font-variant-numeric:tabular-nums}
.udbg-tab[data-active="false"] .udbg-tab-count{background:#232936;color:#8b93a3}
.udbg-body{display:flex;min-height:0;flex:1}
.udbg-side{width:270px;flex:none;display:flex;flex-direction:column;border-right:1px solid #1d222b;background:#111419}
.udbg-side-head{display:flex;flex-direction:column;gap:6px;flex:none;padding:7px 10px;background:#111419;border-bottom:1px solid #1d222b;color:#6f788a;font-size:10px;letter-spacing:.06em;text-transform:uppercase}
.udbg-side-scroll{flex:1;overflow:auto}
.udbg-input{width:100%;height:26px;padding:0 8px;border:1px solid #2b303b;border-radius:7px;background:#0f1216;color:#d7dbe3;font:11.5px ui-monospace,Menlo,Monaco,Consolas,monospace;text-transform:none;letter-spacing:0}
.udbg-input:focus{outline:none;border-color:var(--udbg-accent)}
.udbg-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;padding:8px 10px;border-top:1px solid #1d222b;color:#8b93a3;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px}
.udbg-pager .udbg-btn{height:24px;padding:0 9px}
.udbg-pager .udbg-btn:disabled{opacity:.35;cursor:not-allowed}
.udbg-req{display:block;width:100%;padding:7px 10px;border:0;border-bottom:1px solid #171b22;border-left:2px solid transparent;background:transparent;color:#c7cedb;font:inherit;text-align:left;cursor:pointer}
.udbg-req:hover{background:#171c24}
.udbg-req[data-active="true"]{background:#1a2029;border-left-color:var(--udbg-accent)}
.udbg-req-top{display:flex;align-items:center;gap:6px}
.udbg-req-url{display:block;margin-top:3px;color:#9aa3b2;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:11px;word-break:break-all}
.udbg-req-foot{display:flex;gap:10px;margin-top:3px;color:#6f788a;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:10.5px}
.udbg-main{flex:1;min-width:0;overflow:auto;background:#0f1216}
.udbg-table{width:100%;border-collapse:collapse;font:11.5px/1.6 ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono",monospace}
.udbg-table th{position:sticky;top:0;z-index:1;padding:6px 10px;background:#161b23;border-bottom:1px solid #242a35;color:#8b93a3;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:10px}
.udbg-table td{padding:6px 10px;border-bottom:1px solid #191d25;vertical-align:top;color:#c7cedb}
.udbg-table tbody tr:hover{background:#151a22}
.udbg-num{width:1%;color:#8b93a3;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.udbg-key{width:1%;color:#7d8697;white-space:nowrap}
.udbg-sql{margin:0;white-space:pre-wrap;word-break:break-word;color:#d7dbe3}
.udbg-sub{color:#6f788a}
.udbg-callsite{color:var(--udbg-accent)}
.udbg-err{color:#f85149}
.udbg-notice{padding:8px 10px;border-bottom:1px solid #242a35;background:#161b23;color:#aeb6c4;font-size:11.5px}
.udbg-empty{padding:18px 12px;color:#8b93a3;font-size:12px;max-width:72ch}
.udbg-empty strong{color:var(--udbg-accent)}
.udbg-track{position:relative;height:9px;min-width:120px;border-radius:999px;background:#1c222c}
.udbg-track>span{position:absolute;top:0;height:9px;border-radius:999px;background:linear-gradient(90deg,var(--udbg-accent),#8b5cf6)}
.udbg-badge{display:inline-block;padding:1px 6px;border-radius:5px;background:#232936;color:#aeb6c4;font-size:10.5px}
.udbg-badge[data-tone="tx"]{background:#2a2340;color:#c4b5fd}
.udbg-badge[data-tone="bad"]{background:#3a1f22;color:#ff8a80}
.udbg-badge[data-tone="ok"]{background:#16301f;color:#7ee2a8}
.udbg-table th.udbg-th-sort{padding:0}
.udbg-sort{display:flex;align-items:center;gap:5px;width:100%;padding:6px 10px;border:0;background:transparent;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer}
.udbg-sort:hover{background:#1d222c;color:#fff}
.udbg-sort[data-num="true"]{justify-content:flex-end}
.udbg-sort[data-active="true"]{color:var(--udbg-accent)}
.udbg-arrow{font-size:9px;opacity:.35}
.udbg-sort[data-active="true"] .udbg-arrow{opacity:1;color:var(--udbg-accent)}
.udbg-chain{display:flex;flex-wrap:wrap;gap:5px;padding:8px 10px;border-bottom:1px solid #1d222b}
.udbg-frame{padding:3px 9px;border:1px solid #2b303b;border-radius:7px;background:#171b24;color:#aeb6c4;font:11px ui-monospace,Menlo,Monaco,Consolas,monospace;cursor:pointer}
.udbg-frame:hover{border-color:#3c4350;color:#fff}
.udbg-frame[data-active="true"]{background:var(--udbg-accent);border-color:var(--udbg-accent);color:#fff}
.udbg-code{margin:0;padding:10px;overflow:auto;background:#0c0f13;font:11.5px/1.7 ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono",monospace;color:#c7cedb}
.udbg-code div{white-space:pre}
.udbg-code .udbg-ln{display:inline-block;width:44px;color:#4f5768;text-align:right;padding-right:12px;user-select:none}
.udbg-code div[data-hit="true"]{background:color-mix(in srgb,var(--udbg-accent) 14%,transparent);box-shadow:inset 2px 0 0 var(--udbg-accent)}
.udbg-section{padding:7px 10px;border-top:1px solid #1d222b;border-bottom:1px solid #1d222b;background:#131720;color:#6f788a;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:10px}
.udbg-bodytext{max-height:40vh;white-space:pre-wrap;word-break:break-word}
.udbg-settings{position:relative}
.udbg-settings>.udbg-btn[aria-expanded="true"]{border-color:var(--udbg-accent);color:#fff}
.udbg-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:3;display:flex;flex-direction:column;gap:10px;width:244px;padding:10px;border:1px solid #2b303b;border-radius:10px;background:#15181f;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.udbg-menu-label{color:#6f788a;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.udbg-menu-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.udbg-swatch{width:22px;height:22px;padding:0;border:2px solid transparent;border-radius:6px;cursor:pointer}
.udbg-swatch[data-active="true"]{border-color:#fff}
.udbg-color{width:30px;height:22px;padding:0;border:1px solid #2b303b;border-radius:6px;background:transparent;cursor:pointer}
.udbg-color-value{color:#8b93a3;font:11px ui-monospace,Menlo,Monaco,Consolas,monospace}
.udbg-menu-row .udbg-btn{height:22px;margin-left:auto;padding:0 8px;font-size:11px}
.udbg-menu-row .udbg-btn:disabled{opacity:.35;cursor:not-allowed}
.udbg-copyright{padding-top:8px;border-top:1px solid #1d222b;color:#6f788a;font-size:10.5px;line-height:1.4}
`;

function ms(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)}ms`;
}

function mb(value: number): string {
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

/** Signed byte formatting; heap deltas are routinely negative. */
function bytes(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs < 1024) return `${sign}${abs} B`;
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;

  return `${sign}${(abs / 1048576).toFixed(2)} MB`;
}

/**
 * One row of the request rail. Replaces the old `<select>`: a captured request
 * is chosen by its method, path, status and cost, all of which have to be
 * readable at a glance.
 */
function RequestRow({
  active,
  entry,
  onSelect,
  ordinal,
}: {
  active: boolean;
  entry: UpspectorEntry;
  onSelect: () => void;
  /** Position in the capture order, so a row stays identifiable across pages. */
  ordinal: number;
}) {
  const { payload } = entry;
  const url = payload?.request.url ?? entry.url;
  const status = payload?.request.statusCode ?? entry.statusCode;

  return (
    <button
      className="udbg-req"
      data-active={active}
      onClick={onSelect}
      title={url}
      type="button"
    >
      <span className="udbg-req-top">
        <span className="udbg-badge">{entry.source.toUpperCase()}</span>
        <span className="udbg-badge">
          {payload?.request.method ?? entry.method}
        </span>
        <span
          className="udbg-badge"
          data-tone={status && status >= 400 ? "bad" : "ok"}
        >
          {status ?? "?"}
        </span>
      </span>
      <span className="udbg-req-url">{url}</span>
      <span className="udbg-req-foot">
        <span>#{ordinal}</span>
        {payload ? (
          <>
            <span>{ms(payload.durationMs)}</span>
            <span>{payload.database.count} sql</span>
            <span>{ms(payload.database.totalMs)}</span>
          </>
        ) : (
          <span className="udbg-err">snapshot failed</span>
        )}
      </span>
    </button>
  );
}

/** Rows per page of the request rail. */
const RAIL_PAGE_SIZE = 20;

/**
 * Captured requests, newest first, with a URL filter and paging. A busy page
 * captures hundreds of requests; an unbounded scroll makes it impossible to
 * tell where a row was.
 */
function RequestRail({
  activeId,
  entries,
  onSelect,
}: {
  activeId: string;
  entries: UpspectorEntry[];
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const needle = query.trim().toLowerCase();
  const ordered = entries
    .map((entry, index) => ({ entry, ordinal: index + 1 }))
    .reverse()
    .filter(
      ({ entry }) =>
        needle === "" ||
        entry.payload?.request.url.toLowerCase().includes(needle) ||
        entry.url.toLowerCase().includes(needle),
    );
  const pageCount = Math.max(1, Math.ceil(ordered.length / RAIL_PAGE_SIZE));
  // Filtering can shrink the list under the current page; clamp instead of
  // showing an empty rail.
  const current = Math.min(page, pageCount - 1);
  const visible = ordered.slice(
    current * RAIL_PAGE_SIZE,
    current * RAIL_PAGE_SIZE + RAIL_PAGE_SIZE,
  );

  return (
    <div className="udbg-side">
      <div className="udbg-side-head">
        <span>
          requests · {ordered.length}
          {needle === "" ? "" : ` / ${entries.length}`}
        </span>
        <input
          className="udbg-input"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
          placeholder="filter by url"
          type="search"
          value={query}
        />
      </div>

      {/* Own scroll container: the rail is a flex column, so rows left in it
          directly are clipped at the panel edge with no way to reach them. */}
      <div className="udbg-side-scroll">
        {visible.length === 0 ? (
          <div className="udbg-empty">No request matches “{query}”.</div>
        ) : (
          visible.map(({ entry, ordinal }) => (
            <RequestRow
              active={entry.id === activeId}
              entry={entry}
              key={entry.id}
              onSelect={() => onSelect(entry.id)}
              ordinal={ordinal}
            />
          ))
        )}
      </div>

      {pageCount > 1 ? (
        <div className="udbg-pager">
          <button
            className="udbg-btn"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            type="button"
          >
            ‹
          </button>
          <span>
            page {current + 1} / {pageCount}
          </span>
          <button
            className="udbg-btn"
            disabled={current >= pageCount - 1}
            onClick={() => setPage(current + 1)}
            type="button"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Mark() {
  return (
    <svg aria-hidden="true" className="udbg-mark" viewBox="0 0 20 20">
      <rect fill="var(--udbg-accent)" height="20" rx="5" width="20" />
      <g
        fill="none"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d="M4 7.5V5a1 1 0 0 1 1-1h2.5M12.5 4H15a1 1 0 0 1 1 1v2.5M4 12.5V15a1 1 0 0 0 1 1h2.5"
          strokeWidth="1.6"
        />
        <circle cx="11" cy="11" r="2.9" strokeWidth="1.8" />
        <path d="M13.2 13.2l2.6 2.6" strokeWidth="2" />
      </g>
    </svg>
  );
}

/**
 * Devtools "inspect element": a pointer picking out of a dashed frame. The
 * dashes read as "select a region" at 15px, which a crosshair does not.
 */
function PickIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="15"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width="15"
    >
      <path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1M9 21h2M14 3h1M3 9v1M21 9v2M3 14v1" />
      <path d="M12.5 12.5 21 15.6l-3.6 1.1-1.1 3.6z" fill="currentColor" />
    </svg>
  );
}

type SortDir = "asc" | "desc";
interface SortState {
  key: string;
  dir: SortDir;
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;

  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Column sorting for one table.
 *
 * A click cycles ascending → descending → unsorted: the recorded order is
 * chronological, which is information in itself, so it has to stay reachable.
 */
function useSortedRows<T>(
  rows: T[],
  accessors: Record<string, (row: T) => string | number>,
) {
  const [sort, setSort] = useState<SortState | null>(null);

  const accessor = sort ? accessors[sort.key] : undefined;
  const direction = sort?.dir === "desc" ? -1 : 1;
  const sorted = accessor
    ? [...rows].sort(
        (a, b) => compareValues(accessor(a), accessor(b)) * direction,
      )
    : rows;

  function toggle(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: "asc" };

      return current.dir === "asc" ? { key, dir: "desc" } : null;
    });
  }

  return { rows: sorted, sort, toggle };
}

function Th({
  label,
  numeric,
  onSort,
  sort,
  sortKey,
}: {
  label: string;
  numeric?: boolean;
  onSort?: (key: string) => void;
  sort?: SortState | null;
  sortKey?: string;
}) {
  if (!sortKey || !onSort) {
    return <th>{label}</th>;
  }

  const dir = sort?.key === sortKey ? sort.dir : null;

  return (
    <th
      aria-sort={
        dir === null ? "none" : dir === "asc" ? "ascending" : "descending"
      }
      className="udbg-th-sort"
    >
      <button
        className="udbg-sort"
        data-active={dir !== null}
        data-num={numeric ? "true" : undefined}
        onClick={() => onSort(sortKey)}
        title={`Sort by ${label}`}
        type="button"
      >
        <span>{label}</span>
        <span className="udbg-arrow">
          {dir === null ? "↕" : dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function KeyValueTable({ rows }: { rows: Record<string, string> }) {
  const keys = Object.keys(rows).sort();

  if (keys.length === 0) return <div className="udbg-empty">none</div>;

  return (
    <table className="udbg-table">
      <tbody>
        {keys.map((key) => (
          <tr key={key}>
            <td className="udbg-key">{key}</td>
            <td style={{ wordBreak: "break-all" }}>{rows[key]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Levels expanded on first render; deeper nodes start collapsed. */
const JSON_OPEN_DEPTH = 2;

function JsonLeaf({ value }: { value: unknown }) {
  if (typeof value === "string") {
    return <span className="udbg-json-str">&quot;{value}&quot;</span>;
  }
  if (typeof value === "number") {
    return <span className="udbg-json-num">{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span className="udbg-json-bool">{String(value)}</span>;
  }

  return <span className="udbg-json-null">null</span>;
}

/**
 * One collapsible node of the body viewer. Objects and arrays keep their own
 * open state, so a 500-key response can be folded down to the branch you are
 * actually reading.
 */
function JsonNode({
  depth,
  name,
  value,
}: {
  depth: number;
  name?: string;
  value: unknown;
}) {
  const [open, setOpen] = useState(depth < JSON_OPEN_DEPTH);
  const label =
    name === undefined ? null : <span className="udbg-json-key">{name}</span>;

  if (value === null || typeof value !== "object") {
    return (
      <div className="udbg-json-row" style={{ paddingLeft: depth * 14 }}>
        <span className="udbg-json-toggle" />
        {label}
        {label ? <span className="udbg-json-meta">:</span> : null}
        <JsonLeaf value={value} />
      </div>
    );
  }

  const array = Array.isArray(value);
  const entries: Array<[string, unknown]> = array
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  const [openBrace, closeBrace] = array ? ["[", "]"] : ["{", "}"];

  return (
    <>
      <div className="udbg-json-row" style={{ paddingLeft: depth * 14 }}>
        <button
          aria-expanded={open}
          className="udbg-json-toggle"
          onClick={() => setOpen(!open)}
          type="button"
        >
          {open ? "▾" : "▸"}
        </button>
        {label}
        {label ? <span className="udbg-json-meta">:</span> : null}
        <span className="udbg-json-meta">
          {open
            ? openBrace
            : `${openBrace}…${closeBrace} ${entries.length} ${
                array ? "items" : "keys"
              }`}
        </span>
      </div>
      {open ? (
        <>
          {entries.map(([key, child]) => (
            <JsonNode depth={depth + 1} key={key} name={key} value={child} />
          ))}
          <div className="udbg-json-row" style={{ paddingLeft: depth * 14 }}>
            <span className="udbg-json-toggle" />
            <span className="udbg-json-meta">{closeBrace}</span>
          </div>
        </>
      ) : null}
    </>
  );
}

function BodyBlock({
  body,
  format,
}: {
  body: UpspectorBody | null;
  format: "json" | "raw";
}) {
  if (!body) return <div className="udbg-empty">no body</div>;

  // Bodies are captured verbatim; `json` parses here. Anything that is not
  // JSON (HTML error page, form encoding, a truncated capture) falls back to
  // the raw text instead of erroring.
  let parsed: unknown;
  let parseable = false;

  if (format === "json") {
    try {
      parsed = JSON.parse(body.text);
      parseable = true;
    } catch {
      parseable = false;
    }
  }

  return (
    <>
      {parseable ? (
        <div className="udbg-json">
          <JsonNode depth={0} value={parsed} />
        </div>
      ) : (
        <pre className="udbg-code udbg-bodytext">{body.text}</pre>
      )}
      {format === "json" && !parseable ? (
        <div className="udbg-empty">Not JSON — showing the captured text.</div>
      ) : null}
      {body.truncated ? (
        <div className="udbg-empty">
          Truncated: {bytes(body.bytes)} captured, {bytes(body.text.length)}{" "}
          shown.
        </div>
      ) : null}
    </>
  );
}

const EXCHANGE_VIEWS = ["overview", "request", "response"] as const;
type ExchangeView = (typeof EXCHANGE_VIEWS)[number];

/**
 * The selected entry, split so the thing you usually came for — a body — is
 * the first row of its view instead of sitting under two header tables.
 * `overview` carries everything that is not a body.
 */
function ExchangePanel({
  exchange,
  overview,
}: {
  exchange: UpspectorExchange;
  overview: Array<[string, string]>;
}) {
  const [view, setView] = useState<ExchangeView>("overview");
  const [format, setFormat] = useState<"json" | "raw">("json");
  const body =
    view === "request" ? exchange.requestBody : exchange.responseBody;

  return (
    <>
      <div className="udbg-subbar">
        <span className="udbg-seg">
          {EXCHANGE_VIEWS.map((name) => (
            <button
              className="udbg-seg-btn"
              data-active={view === name}
              key={name}
              onClick={() => setView(name)}
              type="button"
            >
              {name}
              {name === "overview" ? null : (
                <span className="udbg-seg-note">
                  {name === "request"
                    ? exchange.requestBody
                      ? bytes(exchange.requestBody.bytes)
                      : "—"
                    : exchange.responseBody
                      ? bytes(exchange.responseBody.bytes)
                      : "—"}
                </span>
              )}
            </button>
          ))}
        </span>

        {view === "overview" ? null : (
          <span className="udbg-seg" style={{ marginLeft: "auto" }}>
            {(["json", "raw"] as const).map((name) => (
              <button
                className="udbg-seg-btn"
                data-active={format === name}
                key={name}
                onClick={() => setFormat(name)}
                title={
                  name === "json"
                    ? "Collapsible tree when the body parses as JSON"
                    : "Exactly what went over the wire"
                }
                type="button"
              >
                {name}
              </button>
            ))}
          </span>
        )}
      </div>

      {view === "overview" ? (
        <>
          <table className="udbg-table">
            <tbody>
              {overview.map(([label, value]) => (
                <tr key={label}>
                  <td className="udbg-key">{label}</td>
                  <td style={{ wordBreak: "break-all" }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {Object.keys(exchange.query).length > 0 ? (
            <>
              <div className="udbg-section">
                query · {Object.keys(exchange.query).length}
              </div>
              <KeyValueTable rows={exchange.query} />
            </>
          ) : null}

          <div className="udbg-section">
            request headers · {Object.keys(exchange.requestHeaders).length}
          </div>
          <KeyValueTable rows={exchange.requestHeaders} />

          <div className="udbg-section">
            response headers · {Object.keys(exchange.responseHeaders).length}
          </div>
          <KeyValueTable rows={exchange.responseHeaders} />
        </>
      ) : (
        <BodyBlock body={body} format={format} />
      )}
    </>
  );
}

function RequestTab({
  entry,
  payload,
}: {
  entry: UpspectorEntry;
  payload: UpspectorPayload;
}) {
  const rows: Array<[string, string]> = [
    ["Source", entry.source === "ssr" ? "server component" : "browser"],
    ["Method", payload.request.method],
    ["URL", payload.request.url],
    ["Route", payload.request.route ?? "—"],
    [
      "Handler",
      payload.request.controller
        ? `${payload.request.controller}.${payload.request.handler ?? "?"}`
        : "—",
    ],
    [
      "Status",
      String(payload.request.statusCode ?? entry.statusCode ?? "unknown"),
    ],
    ["Request ID", payload.requestId],
    ["Started at", payload.startedAt],
    ["Duration", ms(payload.durationMs)],
    [
      "Memory",
      `rss ${mb(payload.memory.rssBytes)} · heap ${mb(
        payload.memory.heapUsedBytes,
      )} · Δ${(payload.memory.heapUsedDeltaBytes / 1024).toFixed(0)}KB`,
    ],
    [
      "Totals",
      `${payload.database.count} sql (${ms(payload.database.totalMs)}) · ${
        payload.cache.count
      } cache (${ms(payload.cache.totalMs)}) · ${payload.http.count} http (${ms(
        payload.http.totalMs,
      )}) · ${payload.logs.count} logs`,
    ],
  ];

  return <ExchangePanel exchange={entry.exchange} overview={rows} />;
}

function TimersTab({ payload }: { payload: UpspectorPayload }) {
  const total = Math.max(payload.durationMs, 0.01);
  const { rows, sort, toggle } = useSortedRows(payload.timers, {
    name: (span) => span.name,
    start: (span) => span.startMs,
    duration: (span) => span.durationMs,
  });

  if (payload.timers.length === 0) {
    return <div className="udbg-empty">No timers recorded.</div>;
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th label="Name" onSort={toggle} sort={sort} sortKey="name" />
          <Th
            label="Start"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="start"
          />
          <Th
            label="Duration"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="duration"
          />
          <Th label="Timeline" />
        </tr>
      </thead>
      <tbody>
        {rows.map((span) => (
          <tr key={`${span.name}-${span.startMs}`}>
            <td>{span.name}</td>
            <td className="udbg-num">+{ms(span.startMs)}</td>
            <td className="udbg-num">{ms(span.durationMs)}</td>
            <td>
              <div className="udbg-track">
                <span
                  style={{
                    left: `${Math.min((span.startMs / total) * 100, 100)}%`,
                    width: `${Math.max(
                      Math.min((span.durationMs / total) * 100, 100),
                      0.8,
                    )}%`,
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DatabaseTab({ payload }: { payload: UpspectorPayload }) {
  const { database } = payload;
  const { rows, sort, toggle } = useSortedRows(database.queries, {
    time: (query) => query.durationMs,
    started: (query) => query.startMs,
    type: (query) => query.kind,
    query: (query) => query.sql,
  });

  if (database.count === 0) {
    return <div className="udbg-empty">No queries on this request.</div>;
  }

  return (
    <>
      {database.duplicates.length > 0 ? (
        <div className="udbg-notice">
          {database.duplicates.length} duplicated statement
          {database.duplicates.length > 1 ? "s" : ""} — possible N+1:
          {database.duplicates.map((duplicate) => (
            <div key={duplicate.sql}>
              ×{duplicate.count} {duplicate.sql.slice(0, 160)}
            </div>
          ))}
        </div>
      ) : null}
      <table className="udbg-table">
        <thead>
          <tr>
            <Th
              label="Time"
              numeric
              onSort={toggle}
              sort={sort}
              sortKey="time"
            />
            <Th
              label="Start"
              numeric
              onSort={toggle}
              sort={sort}
              sortKey="started"
            />
            <Th label="Type" onSort={toggle} sort={sort} sortKey="type" />
            <Th label="Query" onSort={toggle} sort={sort} sortKey="query" />
          </tr>
        </thead>
        <tbody>
          {rows.map((query) => (
            <tr key={`${query.index}-${query.startMs}`}>
              <td className="udbg-num">{ms(query.durationMs)}</td>
              <td className="udbg-num">+{ms(query.startMs)}</td>
              <td className="udbg-num">
                <span
                  className="udbg-badge"
                  data-tone={
                    query.error ? "bad" : query.inTransaction ? "tx" : undefined
                  }
                >
                  {query.kind}
                  {query.inTransaction ? " · tx" : ""}
                </span>
              </td>
              <td>
                <pre className="udbg-sql">{query.sql}</pre>
                {query.params && query.params.length > 0 ? (
                  <div className="udbg-sub">
                    params {JSON.stringify(query.params)}
                  </div>
                ) : null}
                {query.callSite ? (
                  <div className="udbg-callsite">{query.callSite}</div>
                ) : null}
                {query.error ? (
                  <div className="udbg-err">{query.error}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CacheTab({ payload }: { payload: UpspectorPayload }) {
  const { cache } = payload;
  const { rows, sort, toggle } = useSortedRows(cache.operations, {
    time: (operation) => operation.durationMs,
    command: (operation) => operation.command,
    key: (operation) => operation.key ?? "",
    args: (operation) => operation.argCount,
  });

  if (cache.count === 0) {
    return (
      <div className="udbg-empty">No cache commands on this request.</div>
    );
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th label="Time" numeric onSort={toggle} sort={sort} sortKey="time" />
          <Th label="Command" onSort={toggle} sort={sort} sortKey="command" />
          <Th label="Key" onSort={toggle} sort={sort} sortKey="key" />
          <Th label="Args" numeric onSort={toggle} sort={sort} sortKey="args" />
        </tr>
      </thead>
      <tbody>
        {rows.map((operation, index) => (
          <tr key={`${operation.command}-${operation.startMs}-${index}`}>
            <td className="udbg-num">{ms(operation.durationMs)}</td>
            <td>{operation.command}</td>
            <td>
              {operation.key ?? "—"}
              {operation.error ? (
                <div className="udbg-err">{operation.error}</div>
              ) : null}
            </td>
            <td className="udbg-num">{operation.argCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HttpTab({ payload }: { payload: UpspectorPayload }) {
  const { http } = payload;
  const { rows, sort, toggle } = useSortedRows(http.calls, {
    time: (call) => call.durationMs,
    method: (call) => call.method,
    url: (call) => call.url,
    status: (call) => call.statusCode ?? 0,
  });

  if (http.count === 0) {
    return (
      <div className="udbg-empty">No outbound calls on this request.</div>
    );
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th label="Time" numeric onSort={toggle} sort={sort} sortKey="time" />
          <Th label="Method" onSort={toggle} sort={sort} sortKey="method" />
          <Th label="URL" onSort={toggle} sort={sort} sortKey="url" />
          <Th
            label="Status"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="status"
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((call, index) => (
          <tr key={`${call.url}-${call.startMs}-${index}`}>
            <td className="udbg-num">{ms(call.durationMs)}</td>
            <td>{call.method}</td>
            <td style={{ wordBreak: "break-all" }}>{call.url}</td>
            <td className="udbg-num">
              {call.statusCode ? (
                <span
                  className="udbg-badge"
                  data-tone={call.statusCode >= 400 ? "bad" : undefined}
                >
                  {call.statusCode}
                </span>
              ) : (
                <span className="udbg-err">{call.error ?? "failed"}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogsTab({ payload }: { payload: UpspectorPayload }) {
  const { logs } = payload;
  const { rows, sort, toggle } = useSortedRows(logs.entries, {
    at: (log) => log.atMs,
    level: (log) => log.level,
    context: (log) => log.context ?? "",
    message: (log) => log.message,
  });

  if (logs.count === 0) {
    return <div className="udbg-empty">No backend logs on this request.</div>;
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th label="At" numeric onSort={toggle} sort={sort} sortKey="at" />
          <Th label="Level" onSort={toggle} sort={sort} sortKey="level" />
          <Th label="Context" onSort={toggle} sort={sort} sortKey="context" />
          <Th label="Message" onSort={toggle} sort={sort} sortKey="message" />
        </tr>
      </thead>
      <tbody>
        {rows.map((log, index) => (
          <tr key={`${log.atMs}-${index}`}>
            <td className="udbg-num">{ms(log.atMs)}</td>
            <td>
              <span
                className="udbg-badge"
                data-tone={
                  log.level === "error" || log.level === "fatal"
                    ? "bad"
                    : undefined
                }
              >
                {log.level}
              </span>
            </td>
            <td>{log.context ?? "—"}</td>
            <td style={{ wordBreak: "break-word" }}>{log.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenderComponentsTable({ pass }: { pass: UpspectorRenderPass }) {
  const { rows, sort, toggle } = useSortedRows(pass.components, {
    name: (component) => component.name,
    start: (component) => component.startMs,
    duration: (component) => component.durationMs,
    heap: (component) => component.heapDeltaBytes,
  });

  if (pass.components.length === 0) {
    return (
      <div className="udbg-empty">
        No component was wrapped with measureServerComponent() in this render.
      </div>
    );
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th label="Name" onSort={toggle} sort={sort} sortKey="name" />
          <Th
            label="Start"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="start"
          />
          <Th
            label="Duration"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="duration"
          />
          <Th
            label="Heap Δ"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="heap"
          />
        </tr>
      </thead>
      <tbody>
        {rows.map((component, index) => (
          <tr key={`${component.name}-${component.startMs}-${index}`}>
            <td>
              {component.name}
              {component.error ? (
                <div className="udbg-err">{component.error}</div>
              ) : null}
            </td>
            <td className="udbg-num">{ms(component.startMs)}</td>
            <td className="udbg-num">{ms(component.durationMs)}</td>
            <td className="udbg-num">{bytes(component.heapDeltaBytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenderAllocationsTable({ pass }: { pass: UpspectorRenderPass }) {
  const sites = pass.allocations?.sites ?? [];
  const { rows, sort, toggle } = useSortedRows(sites, {
    bytes: (site) => site.bytes,
    function: (site) => site.functionName,
    file: (site) => site.url,
    source: (site) => site.source,
  });

  if (sites.length === 0) {
    return (
      <div className="udbg-empty">
        No allocation samples — set UPSPECTOR_RENDER_PROFILE=true on the server.
      </div>
    );
  }

  return (
    <table className="udbg-table">
      <thead>
        <tr>
          <Th
            label="Bytes"
            numeric
            onSort={toggle}
            sort={sort}
            sortKey="bytes"
          />
          <Th label="Function" onSort={toggle} sort={sort} sortKey="function" />
          <Th label="File" onSort={toggle} sort={sort} sortKey="file" />
          <Th label="Source" onSort={toggle} sort={sort} sortKey="source" />
        </tr>
      </thead>
      <tbody>
        {rows.map((site, index) => (
          <tr key={`${site.functionName}-${site.url}-${site.line}-${index}`}>
            <td className="udbg-num">{bytes(site.bytes)}</td>
            <td>{site.functionName}</td>
            <td style={{ wordBreak: "break-all" }}>
              {site.url === "" ? "—" : `${site.url}:${site.line}`}
            </td>
            <td>
              <span className="udbg-badge">{site.source}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenderTab({ pass }: { pass: UpspectorRenderPass }) {
  const { memory, gc, allocations } = pass;
  const rows: Array<[string, string]> = [
    ["Route", pass.route === "" ? "—" : pass.route],
    ["Started at", pass.startedAt],
    ["Duration", ms(pass.durationMs)],
    ["Heap Δ", bytes(memory.heapUsedDeltaBytes)],
    ["Heap peak", bytes(memory.heapPeakBytes)],
    [
      "RSS start→end",
      `${bytes(memory.rssStartBytes)} → ${bytes(memory.rssEndBytes)}`,
    ],
    ["External Δ", bytes(memory.externalDeltaBytes)],
    [
      "GC",
      gc
        ? `${gc.count} × ${ms(gc.totalPauseMs)}, reclaimed ${bytes(
            gc.reclaimedBytes,
          )}`
        : "—",
    ],
    [
      "Sampled allocations",
      allocations
        ? `${bytes(allocations.sampledBytes)} across ${
            allocations.sites.length
          } site(s)${allocations.truncated ? ", largest only" : ""}`
        : "—",
    ],
    ...(pass.skipped
      ? ([["Skipped", pass.skipped]] as Array<[string, string]>)
      : []),
  ];

  return (
    <>
      <div className="udbg-notice">
        Heap deltas are measured over each component's render window, so
        concurrent renders inflate them. Sampled allocations are attributed by
        stack and are the reliable per-file number.
      </div>
      <table className="udbg-table">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="udbg-key">{label}</td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <RenderComponentsTable pass={pass} />
      <RenderAllocationsTable pass={pass} />
    </>
  );
}

function commitLabel(commit: UpspectorCommitInfo | null): string {
  if (!commit) return "—";

  const when = commit.at === "" ? "" : ` · ${commit.at.slice(0, 10)}`;

  return `${commit.author}${when} · ${commit.commit} ${commit.summary}`;
}

function InspectSnippet({ frame }: { frame: UpspectorInspectSource }) {
  if (frame.snippet.length === 0) {
    return (
      <div className="udbg-empty">{frame.error ?? "Source unavailable."}</div>
    );
  }

  return (
    <pre className="udbg-code">
      {frame.snippet.map((text, index) => {
        const number = frame.snippetStartLine + index;

        return (
          <div data-hit={number === frame.line} key={number}>
            <span className="udbg-ln">{number}</span>
            <span>{text}</span>
          </div>
        );
      })}
    </pre>
  );
}

/**
 * Captured requests whose URL matches one of the route templates resolved from
 * this file's data calls.
 */
function matchEntries(
  entries: UpspectorEntry[],
  frame: UpspectorInspectSource,
): EntryWithPayload[] {
  const endpoints = frame.dataCalls
    .map((call) => call.endpoint)
    .filter(
      (endpoint): endpoint is string => !!endpoint && endpoint.length > 4,
    );

  return entries.filter(hasPayload).filter((entry) =>
    endpoints.some(
      (endpoint) =>
        matchesEndpoint(entry.payload.request.url, endpoint) ||
        matchesEndpoint(entry.url, endpoint),
    ),
  );
}

/** Frame list of the picked node, innermost first. */
function InspectFrameDetail({
  entries,
  frame,
}: {
  entries: UpspectorEntry[];
  frame: UpspectorInspectSource;
}) {
  const matched = matchEntries(entries, frame);

  return (
    <>
      <table className="udbg-table">
        <tbody>
          <tr>
            <td className="udbg-key">File</td>
            <td>
              {frame.file}:{frame.line}:{frame.column} &lt;{frame.tag}&gt;
            </td>
          </tr>
          <tr>
            <td className="udbg-key">Line author</td>
            <td>{commitLabel(frame.lineCommit)}</td>
          </tr>
          <tr>
            <td className="udbg-key">File last change</td>
            <td>{commitLabel(frame.fileCommit)}</td>
          </tr>
        </tbody>
      </table>

      <div className="udbg-section">source</div>
      <InspectSnippet frame={frame} />

      <div className="udbg-section">data calls in this file</div>
      {frame.dataCalls.length === 0 ? (
        <div className="udbg-empty">
          No service, server-api, axios or data-hook call in this file — the
          data is handed down as props from an outer frame.
        </div>
      ) : (
        <table className="udbg-table">
          <thead>
            <tr>
              <th>Line</th>
              <th>Kind</th>
              <th>Expression</th>
              <th>Endpoint</th>
            </tr>
          </thead>
          <tbody>
            {frame.dataCalls.map((call) => (
              <tr key={`${call.line}-${call.expression}`}>
                <td className="udbg-num">{call.line}</td>
                <td>
                  <span className="udbg-badge">{call.kind}</span>
                </td>
                <td style={{ wordBreak: "break-word" }}>{call.expression}</td>
                <td className="udbg-callsite">{call.endpoint ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="udbg-section">backend requests behind this file</div>
      {matched.length === 0 ? (
        <div className="udbg-empty">
          No captured request matches a route template from this file.
        </div>
      ) : (
        <table className="udbg-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Handler</th>
              <th>SQL</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {matched.map((entry) => (
              <tr key={entry.id}>
                <td style={{ wordBreak: "break-all" }}>
                  {entry.source.toUpperCase()} {entry.payload.request.method}{" "}
                  {entry.payload.request.url}
                </td>
                <td>
                  {entry.payload.request.controller
                    ? `${entry.payload.request.controller}.${
                        entry.payload.request.handler ?? "?"
                      }`
                    : "—"}
                </td>
                <td className="udbg-num">
                  {entry.payload.database.count} (
                  {ms(entry.payload.database.totalMs)})
                </td>
                <td className="udbg-num">{ms(entry.payload.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function InspectTab({ entries }: { entries: UpspectorEntry[] }) {
  const picking = useUpspectorStore((state) => state.picking);
  const inspect = useUpspectorStore((state) => state.inspect);
  const inspectError = useUpspectorStore((state) => state.inspectError);
  const inspectLoading = useUpspectorStore((state) => state.inspectLoading);
  const [selected, setSelected] = useState(0);

  if (picking) {
    return (
      <div className="udbg-empty">
        Hover a node, click to resolve it. Esc cancels.
      </div>
    );
  }

  if (inspectLoading) {
    return <div className="udbg-empty">Resolving source and blame…</div>;
  }

  if (inspectError) {
    return <div className="udbg-empty udbg-err">{inspectError}</div>;
  }

  if (!inspect || inspect.frames.length === 0) {
    return (
      <div className="udbg-empty">
        Press <strong>pick element</strong> ({PICKER_SHORTCUT}), then click
        anything on the page: you get the file and line that rendered it, who
        last changed that line, the data calls of that file and the backend
        request behind them. Development builds only — the source attributes
        come from code-inspector-plugin.
      </div>
    );
  }

  const frame = inspect.frames[Math.min(selected, inspect.frames.length - 1)];
  if (!frame) return null;

  return (
    <>
      <div className="udbg-chain">
        {inspect.frames.map((candidate, index) => (
          <button
            className="udbg-frame"
            data-active={candidate === frame}
            key={`${candidate.file}:${candidate.line}:${candidate.column}`}
            onClick={() => setSelected(index)}
            title={`${candidate.file}:${candidate.line}`}
            type="button"
          >
            {candidate.file.split("/").pop()}:{candidate.line}
          </button>
        ))}
      </div>
      <InspectFrameDetail entries={entries} frame={frame} />
    </>
  );
}

function tabCount(tab: Tab, payload: UpspectorPayload): number | null {
  switch (tab) {
    case "database":
      return payload.database.count;
    case "cache":
      return payload.cache.count;
    case "http":
      return payload.http.count;
    case "logs":
      return payload.logs.count;
    default:
      return null;
  }
}

/** Tab labels and glyphs, so the strip reads like the rest of the UI. */
/** Panel height, remembered per browser so the bar reopens where it was. */
const HEIGHT_KEY = "upspector.height";
const MIN_HEIGHT = 200;
const DEFAULT_HEIGHT = 360;

/** Entry-scoped tabs need a captured request; these two do not. */
const GLOBAL_TABS: Tab[] = ["inspect", "render"];

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: Corner[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const CORNER_KEY = "upspector.corner";
const TUCKED_KEY = "upspector.tucked";
const DOCK_GAP = 14;
/** Pointer travel below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

function readCorner(): Corner {
  if (typeof window === "undefined") return "bottom-right";

  const stored = window.localStorage.getItem(CORNER_KEY) as Corner | null;

  return stored && CORNERS.includes(stored) ? stored : "bottom-right";
}

function cornerStyle(corner: Corner): CSSProperties {
  const [vertical, horizontal] = corner.split("-") as [
    "top" | "bottom",
    "left" | "right",
  ];

  return { [vertical]: DOCK_GAP, [horizontal]: DOCK_GAP };
}

/** Chevron pointing at the screen edge the dock tucks into. */
function Chevron({ side }: { side: "left" | "right" }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d={side === "right" ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
    </svg>
  );
}

interface FloatingDockProps {
  requestCount: number;
  sqlCount: number;
  picking: boolean;
  onOpen: () => void;
  onPick: () => void;
}

/**
 * Collapsed state, after react-scan's toolbar: a pill that is dragged anywhere
 * and snaps to the nearest corner on release, or tucks into the side edge as a
 * thin tab so it never sits on top of the page being debugged. Corner and
 * tucked state persist per browser.
 */
function FloatingDock({
  requestCount,
  sqlCount,
  picking,
  onOpen,
  onPick,
}: FloatingDockProps) {
  const [corner, setCorner] = useState<Corner>(readCorner);
  const [tucked, setTucked] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(TUCKED_KEY) === "true",
  );
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(
    null,
  );
  const dockRef = useRef<HTMLDivElement>(null);
  // Set when a drag ends so the click that follows the pointerup is swallowed
  // instead of opening the panel.
  const draggedRef = useRef(false);

  const side = corner.endsWith("left") ? "left" : "right";
  const summary = `Upspector — ${requestCount} request(s), ${sqlCount} queries`;

  function tuck(next: boolean) {
    setTucked(next);
    window.localStorage.setItem(TUCKED_KEY, String(next));
  }

  // No pointer capture: it would retarget the click to the dock and the
  // buttons inside would never see it.
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !dockRef.current) return;

    const rect = dockRef.current.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    draggedRef.current = false;

    function onMove(move: PointerEvent) {
      const dx = move.clientX - startX;
      const dy = move.clientY - startY;

      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      moved = true;
      setDrag({
        left: Math.min(
          Math.max(rect.left + dx, 0),
          window.innerWidth - rect.width,
        ),
        top: Math.min(
          Math.max(rect.top + dy, 0),
          window.innerHeight - rect.height,
        ),
      });
    }

    function onUp(up: PointerEvent) {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);

      if (!moved) return;

      const centerX = rect.left + rect.width / 2 + (up.clientX - startX);
      const centerY = rect.top + rect.height / 2 + (up.clientY - startY);
      const vertical = centerY < window.innerHeight / 2 ? "top" : "bottom";
      const horizontal = centerX < window.innerWidth / 2 ? "left" : "right";
      const next: Corner = `${vertical}-${horizontal}`;

      draggedRef.current = true;
      setDrag(null);
      setCorner(next);
      window.localStorage.setItem(CORNER_KEY, next);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  if (tucked) {
    return (
      <button
        aria-label={`${summary} — show the toolbar`}
        className="udbg-tuck"
        data-upspector=""
        data-side={side}
        onClick={() => tuck(false)}
        style={{ [corner.startsWith("top") ? "top" : "bottom"]: DOCK_GAP }}
        title={summary}
        type="button"
      >
        <Mark />
      </button>
    );
  }

  return (
    <div
      aria-label="Upspector"
      className="udbg-dock"
      data-upspector=""
      data-dragging={drag !== null}
      onClickCapture={(event) => {
        if (!draggedRef.current) return;

        draggedRef.current = false;
        event.stopPropagation();
      }}
      onPointerDown={onPointerDown}
      ref={dockRef}
      role="toolbar"
      style={drag ?? cornerStyle(corner)}
    >
      <button
        className="udbg-dock-btn"
        onClick={onOpen}
        title={`${summary} — open the panel`}
        type="button"
      >
        <Mark />
        <span className="udbg-dock-stat">
          <b>{requestCount}</b> req
        </span>
        <span className="udbg-dock-stat">
          <b>{sqlCount}</b> sql
        </span>
      </button>
      <span className="udbg-dock-sep" />
      <button
        aria-label="Pick an element"
        aria-pressed={picking}
        className="udbg-dock-btn"
        data-tone={picking ? "accent" : undefined}
        onClick={onPick}
        title={
          picking
            ? `Picking — click an element, Esc cancels (${PICKER_SHORTCUT})`
            : `Pick an element (${PICKER_SHORTCUT})`
        }
        type="button"
      >
        <PickIcon />
      </button>
      <button
        aria-label="Tuck into the screen edge"
        className="udbg-dock-btn"
        onClick={() => tuck(true)}
        title="Tuck into the screen edge"
        type="button"
      >
        <Chevron side={side} />
      </button>
    </div>
  );
}

/**
 * Accent colour picked in the settings menu, remembered per browser. Set on
 * `<html>` so the element picker's highlight follows it too, and it beats a
 * host's `:root` override only while a developer has actually picked one.
 */
const ACCENT_KEY = "upspector.accent";
const DEFAULT_ACCENT = "#e84393";
const ACCENT_PRESETS = [
  DEFAULT_ACCENT,
  "#7c3aed",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const COPYRIGHT = `© ${new Date().getFullYear()} Uplide. All rights reserved.`;

function readAccent(): string | null {
  if (typeof window === "undefined") return null;

  const stored = window.localStorage.getItem(ACCENT_KEY);

  return stored && HEX_COLOR.test(stored) ? stored : null;
}

function GearIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Per-browser preferences, opened from the gear in the panel header. Closes
 * on Escape or a click anywhere outside it.
 */
function SettingsMenu({
  accent,
  onAccent,
}: {
  accent: string | null;
  onAccent: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const current = accent ?? DEFAULT_ACCENT;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className="udbg-settings" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Settings"
        className="udbg-btn udbg-icon-btn"
        onClick={() => setOpen(!open)}
        title="Settings"
        type="button"
      >
        <GearIcon />
      </button>

      {open ? (
        <div aria-label="Upspector settings" className="udbg-menu" role="dialog">
          <span className="udbg-menu-label">accent color</span>
          <div className="udbg-menu-row">
            {ACCENT_PRESETS.map((color) => (
              <button
                aria-label={`Use ${color}`}
                className="udbg-swatch"
                data-active={current.toLowerCase() === color}
                key={color}
                onClick={() => onAccent(color === DEFAULT_ACCENT ? null : color)}
                style={{ background: color }}
                title={color}
                type="button"
              />
            ))}
          </div>
          <div className="udbg-menu-row">
            <input
              aria-label="Custom accent color"
              className="udbg-color"
              onChange={(event) => onAccent(event.target.value)}
              type="color"
              value={current}
            />
            <span className="udbg-color-value">{current}</span>
            <button
              className="udbg-btn"
              disabled={accent === null}
              onClick={() => onAccent(null)}
              title="Back to the default (or the host's --udbg-accent)"
              type="button"
            >
              reset
            </button>
          </div>

          <div className="udbg-copyright">{COPYRIGHT}</div>
        </div>
      ) : null}
    </span>
  );
}

export interface UpspectorOverlayProps {
  /** CSP nonce for the overlay's own `<style>` tag. */
  nonce?: string;
}

/**
 * Overlay for the payload the backend appends to every JSON envelope while
 * its upspector is enabled, plus the server render pass and the element
 * inspector: a small draggable dock that snaps to the nearest corner (or tucks
 * into the screen edge) and opens a resizable panel docked to the bottom of
 * the viewport.
 *
 * Ships its own stylesheet, so it needs no Tailwind/theme wiring.
 */
export function UpspectorOverlay({ nonce }: UpspectorOverlayProps = {}) {
  const entries = useUpspectorStore((state) => state.entries);
  const open = useUpspectorStore((state) => state.open);
  const activeEntryId = useUpspectorStore((state) => state.activeEntryId);
  const setOpen = useUpspectorStore((state) => state.setOpen);
  const setActiveEntry = useUpspectorStore((state) => state.setActiveEntry);
  const renderPass = useUpspectorStore((state) => state.renderPass);
  const picking = useUpspectorStore((state) => state.picking);
  const setPicking = useUpspectorStore((state) => state.setPicking);
  const inspectLoading = useUpspectorStore((state) => state.inspectLoading);
  const inspectError = useUpspectorStore((state) => state.inspectError);
  const clear = useUpspectorStore((state) => state.clear);
  const [tab, setTab] = useState<Tab>("inspect");
  const [dragging, setDragging] = useState(false);
  // Lazy init instead of an effect: on the server (and before hydration) the
  // store is empty, so both branches render null and hydration stays clean.
  const [silenced, setSilenced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(STORAGE_KEY) === "false",
  );
  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_HEIGHT;

    return Number(window.localStorage.getItem(HEIGHT_KEY)) || DEFAULT_HEIGHT;
  });
  const [accent, setAccent] = useState(readAccent);

  // The overlay is mounted on every page but renders nothing until a payload
  // arrives, so a misconfigured backend looks like a broken feature. This
  // prints one console line explaining which side is quiet.
  useEffect(reportUpspectorStatus, []);

  // A pick armed from the dock (or the shortcut) while the panel is closed
  // would otherwise land its result out of sight.
  useEffect(() => {
    if (!inspectLoading && !inspectError) return;

    setTab("inspect");
    setOpen(true);
  }, [inspectLoading, inspectError, setOpen]);

  useEffect(() => {
    if (!dragging) return;

    function onMove(event: MouseEvent) {
      const next = Math.min(
        Math.max(window.innerHeight - event.clientY, MIN_HEIGHT),
        window.innerHeight - 60,
      );

      setHeight(next);
      window.localStorage.setItem(HEIGHT_KEY, String(next));
    }

    function onUp() {
      setDragging(false);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    const root = document.documentElement.style;

    if (accent) root.setProperty("--udbg-accent", accent);
    else root.removeProperty("--udbg-accent");

    return () => {
      root.removeProperty("--udbg-accent");
    };
  }, [accent]);

  function changeAccent(next: string | null) {
    setAccent(next);

    if (next) window.localStorage.setItem(ACCENT_KEY, next);
    else window.localStorage.removeItem(ACCENT_KEY);
  }

  // A page can have a server render pass and no captured API request at all —
  // that is still worth showing.
  if (silenced || (entries.length === 0 && !renderPass)) return null;

  const active =
    entries.find((entry) => entry.id === activeEntryId) ??
    entries[entries.length - 1];
  const payload = active?.payload;
  // `inspect` always works, `render` needs a pass, the rest need an entry.
  const visible = (name: Tab) => {
    if (name === "inspect") return true;
    if (name === "render") return renderPass !== null;

    return active !== undefined;
  };
  const activeTab: Tab = visible(tab) ? tab : "inspect";
  const requestCount = entries.length;
  const sqlCount = entries.reduce(
    (total, entry) => total + (entry.payload?.database.count ?? 0),
    0,
  );

  if (!open) {
    return (
      <>
        <style nonce={nonce}>{CSS}</style>
        <FloatingDock
          onOpen={() => setOpen(true)}
          onPick={() => {
            setTab("inspect");
            setPicking(!picking);
          }}
          picking={picking}
          requestCount={requestCount}
          sqlCount={sqlCount}
        />
        <UpspectorPicker />
      </>
    );
  }

  return (
    <>
      <style nonce={nonce}>{CSS}</style>
      <UpspectorPicker />
      <div className="udbg" data-upspector="" style={{ height }}>
        <div
          className="udbg-grip"
          data-dragging={dragging}
          onMouseDown={() => setDragging(true)}
          title="Drag to resize"
        />

        <div className="udbg-head">
          <span className="udbg-brand">
            <Mark />
            upspector
          </span>

          <button
            aria-label="Pick an element"
            aria-pressed={picking}
            className="udbg-btn udbg-icon-btn"
            data-tone={picking ? "accent" : undefined}
            onClick={() => {
              setTab("inspect");
              setPicking(!picking);
            }}
            title={
              picking
                ? `Picking — click an element, Esc cancels (${PICKER_SHORTCUT})`
                : `Pick an element: source, authorship and the data behind it (${PICKER_SHORTCUT})`
            }
            type="button"
          >
            <PickIcon />
          </button>

          <span className="udbg-route">
            {renderPass?.route || "no server render pass"}
          </span>

          <span className="udbg-stats">
            <span className="udbg-stat">
              <b>{requestCount}</b> req
            </span>
            <span className="udbg-stat">
              <b>{sqlCount}</b> sql
            </span>
            {renderPass ? (
              <span className="udbg-stat">
                render <b>{ms(renderPass.durationMs)}</b>
              </span>
            ) : null}
            {payload ? (
              <span className="udbg-stat">
                rss <b>{mb(payload.memory.rssBytes)}</b>
              </span>
            ) : null}
          </span>

          <span className="udbg-actions">
            <button className="udbg-btn" onClick={clear} type="button">
              clear
            </button>
            <SettingsMenu accent={accent} onAccent={changeAccent} />
            <button
              className="udbg-btn"
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, "false");
                setSilenced(true);
              }}
              title="Hide in this browser until localStorage.removeItem('upspector.enabled')"
              type="button"
            >
              off
            </button>
            <button
              className="udbg-btn"
              onClick={() => setOpen(false)}
              title="Collapse"
              type="button"
            >
              ✕
            </button>
          </span>
        </div>

        <div className="udbg-tabs">
          {TABS.filter(visible).map((name) => {
            const count = payload ? tabCount(name, payload) : null;

            return (
              <button
                className="udbg-tab"
                data-active={activeTab === name}
                key={name}
                onClick={() => setTab(name)}
                type="button"
              >
                {name}
                {count === null ? null : (
                  <span className="udbg-tab-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="udbg-body">
          {GLOBAL_TABS.includes(activeTab) || !active ? null : (
            <RequestRail
              activeId={active.id}
              entries={entries}
              onSelect={setActiveEntry}
            />
          )}

          <div className="udbg-main">
            {payload &&
            payload.version !== UPSPECTOR_PAYLOAD_VERSION ? (
              <div className="udbg-notice">
                Payload version {payload.version}; this overlay understands{" "}
                {UPSPECTOR_PAYLOAD_VERSION} — some fields may be
                missing.
              </div>
            ) : null}
            {active?.payloadError && !GLOBAL_TABS.includes(activeTab) ? (
              <div className="udbg-empty udbg-err">
                The backend could not build its snapshot for this request:{" "}
                {active.payloadError}
              </div>
            ) : null}
            {activeTab === "inspect" ? <InspectTab entries={entries} /> : null}
            {activeTab === "render" && renderPass ? (
              <RenderTab pass={renderPass} />
            ) : null}
            {active && payload ? (
              <>
                {activeTab === "request" ? (
                  <RequestTab entry={active} payload={payload} />
                ) : null}
                {activeTab === "timers" ? (
                  <TimersTab payload={payload} />
                ) : null}
                {activeTab === "database" ? (
                  <DatabaseTab payload={payload} />
                ) : null}
                {activeTab === "cache" ? <CacheTab payload={payload} /> : null}
                {activeTab === "http" ? <HttpTab payload={payload} /> : null}
                {activeTab === "logs" ? <LogsTab payload={payload} /> : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
