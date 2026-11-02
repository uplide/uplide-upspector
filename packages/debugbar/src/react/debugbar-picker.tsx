"use client";

import { useEffect, useState } from "react";
import { getDebugbarConfig } from "../config.js";
import { useDebugbarStore } from "../store.js";
import type { DebugbarInspectResult } from "../types.js";

/** Matches the server-side `MAX_INSPECT_FRAMES`. */
const MAX_FRAMES = 8;

/**
 * Arms and disarms the picker from anywhere on the page. Chosen because no
 * browser binds it: Ctrl/Cmd+Shift+C and Ctrl+Shift+E are devtools, Alt+Shift
 * belongs to `code-inspector-plugin`'s own overlay.
 */
export const PICKER_SHORTCUT = "Ctrl/Cmd + Shift + X";

function isShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === "x"
  );
}

interface Highlight {
  top: number;
  left: number;
  width: number;
  height: number;
  label: string;
}

/**
 * Walks outwards from the clicked node collecting `data-insp-path`, innermost
 * first. Consecutive duplicates are dropped: one JSX element often produces
 * several DOM nodes carrying the same attribute.
 */
function collectInspectPaths(start: Element): string[] {
  const paths: string[] = [];
  let node: Element | null = start;

  while (node && paths.length < MAX_FRAMES) {
    const value = node.getAttribute("data-insp-path");

    if (value && !paths.includes(value)) paths.push(value);
    node = node.parentElement;
  }

  return paths;
}

/**
 * Element picker, the debugbar's answer to devtools' "inspect element": arm it
 * from the toolbar, hover to highlight, click to resolve the node back to the
 * source file, its authorship and the data it was rendered from.
 *
 * Only useful in a development build — `data-insp-path` is injected by
 * `code-inspector-plugin`, which the Next config only enables in dev.
 */
export function DebugbarPicker() {
  const picking = useDebugbarStore((state) => state.picking);
  const setPicking = useDebugbarStore((state) => state.setPicking);
  const setInspect = useDebugbarStore((state) => state.setInspect);
  const setInspectError = useDebugbarStore((state) => state.setInspectError);
  const setInspectLoading = useDebugbarStore(
    (state) => state.setInspectLoading,
  );
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  // Always bound, not only while armed: the shortcut has to be able to *start*
  // a pick without reaching for the toolbar.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isShortcut(event)) return;

      event.preventDefault();
      setPicking(!useDebugbarStore.getState().picking);
    }

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [setPicking]);

  useEffect(() => {
    if (!picking) return;

    function onMove(event: MouseEvent) {
      const target = event.target as Element | null;
      // The bar itself is not a target: picking it would only ever resolve to
      // this package's own source.
      if (!target || target.closest("[data-debugbar]")) return;

      const rect = target.getBoundingClientRect();
      const path = target
        .closest("[data-insp-path]")
        ?.getAttribute("data-insp-path");

      setHighlight({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        label: path ?? "no source attribute on this node",
      });
    }

    async function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      if (!target || target.closest("[data-debugbar]")) return;

      event.preventDefault();
      event.stopPropagation();
      setPicking(false);
      setHighlight(null);

      const paths = collectInspectPaths(target);

      if (paths.length === 0) {
        setInspectError(
          "No data-insp-path on this node or its ancestors — the element comes from a file the dev compiler did not instrument.",
        );

        return;
      }

      setInspectLoading(true);

      const endpoint = getDebugbarConfig().inspectEndpoint;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths }),
          debugbar: false,
        });

        if (!response.ok) {
          setInspectError(
            `${endpoint} answered ${response.status}; the inspector route only runs in development.`,
          );

          return;
        }

        setInspect((await response.json()) as DebugbarInspectResult);
      } catch (error) {
        setInspectError(String(error));
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      setPicking(false);
    }

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      // Disarming must not leave the last hovered box painted on the page.
      setHighlight(null);
    };
  }, [picking, setPicking, setInspect, setInspectError, setInspectLoading]);

  if (!picking || !highlight) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: highlight.top,
        left: highlight.left,
        width: highlight.width,
        height: highlight.height,
        zIndex: 2147482999,
        pointerEvents: "none",
        background: "color-mix(in srgb,var(--udbg-accent) 18%,transparent)",
        outline: "1px solid var(--udbg-accent)",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: highlight.top < 24 ? "100%" : -20,
          left: 0,
          padding: "1px 5px",
          background: "#2b0f1d",
          color: "#ffd7e8",
          font: '11px/1.5 Menlo,Monaco,Consolas,"Liberation Mono",monospace',
          whiteSpace: "nowrap",
        }}
      >
        {highlight.label}
      </span>
    </div>
  );
}
