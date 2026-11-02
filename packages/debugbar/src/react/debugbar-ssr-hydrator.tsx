"use client";

import { useEffect } from "react";
import { useDebugbarStore } from "../store.js";
import type { DebugbarEntry, DebugbarRenderPass } from "../types.js";

/**
 * Moves the SSR-captured entries and the server render measurement (both
 * collected in the RSC render pass) into the client store. Rendered by the
 * app's server component after `children`, so it sees every request the page's
 * server components issued.
 */
export function DebugbarSsrHydrator({
  entries,
  renderPass,
}: {
  entries: DebugbarEntry[];
  renderPass: DebugbarRenderPass | null;
}) {
  const setSsrEntries = useDebugbarStore((state) => state.setSsrEntries);
  const setRenderPass = useDebugbarStore((state) => state.setRenderPass);

  useEffect(() => {
    setSsrEntries(entries);
    // The server has no route: it renders a segment tree, not a URL. The
    // browser does, so the pass is labelled here.
    setRenderPass(
      renderPass ? { ...renderPass, route: window.location.pathname } : null,
    );
  }, [entries, renderPass, setSsrEntries, setRenderPass]);

  return null;
}
