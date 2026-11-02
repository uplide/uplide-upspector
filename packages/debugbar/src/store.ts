import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  DebugbarEntry,
  DebugbarInspectResult,
  DebugbarRenderPass,
} from "./types.js";

/** Ring buffer size. A long session must not grow the store unbounded. */
const MAX_ENTRIES = 50;

export interface DebugbarStore {
  entries: DebugbarEntry[];
  open: boolean;
  activeEntryId: string | null;
  /** Server render measurement of the page currently on screen. */
  renderPass: DebugbarRenderPass | null;
  /** True while the element picker is armed and swallowing page clicks. */
  picking: boolean;
  inspect: DebugbarInspectResult | null;
  inspectError: string | null;
  inspectLoading: boolean;
  pushEntry: (entry: DebugbarEntry) => void;
  /** Replaces the SSR slice on navigation; client entries are kept. */
  setSsrEntries: (entries: DebugbarEntry[]) => void;
  setOpen: (open: boolean) => void;
  setActiveEntry: (id: string | null) => void;
  setRenderPass: (pass: DebugbarRenderPass | null) => void;
  setPicking: (picking: boolean) => void;
  setInspectLoading: (loading: boolean) => void;
  setInspect: (result: DebugbarInspectResult | null) => void;
  setInspectError: (message: string | null) => void;
  clear: () => void;
}

/**
 * Opening the bar should land on the request worth looking at, so the default
 * selection is the one with the most queries (ties go to the earliest).
 */
function pickDefaultEntry(entries: DebugbarEntry[]): DebugbarEntry | undefined {
  const queries = (entry: DebugbarEntry) => entry.payload?.database.count ?? -1;

  return entries.reduce<DebugbarEntry | undefined>(
    (best, entry) => (!best || queries(entry) > queries(best) ? entry : best),
    undefined,
  );
}

function createDebugbarStore() {
  return createStore<DebugbarStore>((set) => ({
    entries: [],
    open: false,
    activeEntryId: null,
    renderPass: null,
    picking: false,
    inspect: null,
    inspectError: null,
    inspectLoading: false,
    pushEntry: (entry) =>
      set((state) => ({
        entries: [...state.entries, entry].slice(-MAX_ENTRIES),
        activeEntryId: state.activeEntryId ?? entry.id,
      })),
    setSsrEntries: (ssrEntries) =>
      set((state) => {
        const entries = [
          ...ssrEntries,
          ...state.entries.filter((entry) => entry.source === "csr"),
        ].slice(-MAX_ENTRIES);
        const activeStillThere = entries.some(
          (entry) => entry.id === state.activeEntryId,
        );

        return {
          entries,
          activeEntryId: activeStillThere
            ? state.activeEntryId
            : (pickDefaultEntry(entries)?.id ?? null),
        };
      }),
    setOpen: (open) => set({ open }),
    setActiveEntry: (activeEntryId) => set({ activeEntryId }),
    setRenderPass: (renderPass) => set({ renderPass }),
    setPicking: (picking) => set({ picking }),
    setInspectLoading: (inspectLoading) => set({ inspectLoading }),
    setInspect: (inspect) =>
      set({ inspect, inspectError: null, inspectLoading: false }),
    setInspectError: (inspectError) =>
      set({ inspectError, inspectLoading: false }),
    clear: () =>
      set({
        entries: [],
        activeEntryId: null,
        renderPass: null,
        inspect: null,
        inspectError: null,
      }),
  }));
}

/**
 * The React-free store is pinned on `globalThis` so two package copies feed the
 * same overlay. The hook is not: it binds to whichever `react` this copy was
 * bundled with, and a server can hold several (Next's instrumentation bundle
 * next to its SSR bundle), each needing its own.
 */
const STORE = Symbol.for("@uplide/debugbar/store");

type StoreHolder = { [STORE]?: StoreApi<DebugbarStore> };

const debugbarStore = ((globalThis as StoreHolder)[STORE] ??=
  createDebugbarStore());

function useDebugbarStoreHook<T>(selector: (state: DebugbarStore) => T): T {
  return useStore(debugbarStore, selector);
}

export const useDebugbarStore = Object.assign(useDebugbarStoreHook, debugbarStore);

/** Default sink for browser-side captures. */
export function pushDebugbarEntry(entry: DebugbarEntry): void {
  useDebugbarStore.getState().pushEntry(entry);
}
