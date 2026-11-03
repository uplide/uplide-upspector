import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import type {
  UpspectorEntry,
  UpspectorInspectResult,
  UpspectorRenderPass,
} from "./types.js";

/** Ring buffer size. A long session must not grow the store unbounded. */
const MAX_ENTRIES = 50;

export interface UpspectorStore {
  entries: UpspectorEntry[];
  open: boolean;
  activeEntryId: string | null;
  /** Server render measurement of the page currently on screen. */
  renderPass: UpspectorRenderPass | null;
  /** True while the element picker is armed and swallowing page clicks. */
  picking: boolean;
  inspect: UpspectorInspectResult | null;
  inspectError: string | null;
  inspectLoading: boolean;
  pushEntry: (entry: UpspectorEntry) => void;
  /** Replaces the SSR slice on navigation; client entries are kept. */
  setSsrEntries: (entries: UpspectorEntry[]) => void;
  setOpen: (open: boolean) => void;
  setActiveEntry: (id: string | null) => void;
  setRenderPass: (pass: UpspectorRenderPass | null) => void;
  setPicking: (picking: boolean) => void;
  setInspectLoading: (loading: boolean) => void;
  setInspect: (result: UpspectorInspectResult | null) => void;
  setInspectError: (message: string | null) => void;
  clear: () => void;
}

/**
 * Opening the bar should land on the request worth looking at, so the default
 * selection is the one with the most queries (ties go to the earliest).
 */
function pickDefaultEntry(entries: UpspectorEntry[]): UpspectorEntry | undefined {
  const queries = (entry: UpspectorEntry) => entry.payload?.database.count ?? -1;

  return entries.reduce<UpspectorEntry | undefined>(
    (best, entry) => (!best || queries(entry) > queries(best) ? entry : best),
    undefined,
  );
}

function createUpspectorStore() {
  return createStore<UpspectorStore>((set) => ({
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
const STORE = Symbol.for("@uplide/upspector/store");

type StoreHolder = { [STORE]?: StoreApi<UpspectorStore> };

const upspectorStore = ((globalThis as StoreHolder)[STORE] ??=
  createUpspectorStore());

function useUpspectorStoreHook<T>(selector: (state: UpspectorStore) => T): T {
  return useStore(upspectorStore, selector);
}

export const useUpspectorStore = Object.assign(useUpspectorStoreHook, upspectorStore);

/** Default sink for browser-side captures. */
export function pushUpspectorEntry(entry: UpspectorEntry): void {
  useUpspectorStore.getState().pushEntry(entry);
}
