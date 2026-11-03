import type { UpspectorDataCall, UpspectorInspectFrame } from "./types.js";

/**
 * Pure half of the element inspector: parsing `data-insp-path` attributes and
 * finding data-fetching calls in a source file.
 */

/** Files the inspector is allowed to read back to the browser. */
const READABLE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs"];

/**
 * `code-inspector-plugin` emits `<file>:<row>:<col>:<tag>`. Parsed from the
 * right, so a path containing a colon cannot shift the numbers.
 */
export function parseInspectPath(value: string): UpspectorInspectFrame | null {
  const parts = value.split(":");
  if (parts.length < 4) return null;

  const tag = parts[parts.length - 1] ?? "";
  const column = Number(parts[parts.length - 2]);
  const line = Number(parts[parts.length - 3]);
  const file = parts.slice(0, -3).join(":");

  if (!file || tag === "") return null;
  if (!Number.isInteger(line) || !Number.isInteger(column)) return null;
  if (line < 1 || column < 1) return null;

  return { file, line, column, tag };
}

/**
 * Guards the source endpoint against path traversal and against handing out
 * arbitrary repository files: relative, inside the tree, source code only.
 */
export function isReadableSourcePath(file: string): boolean {
  if (file === "" || file.startsWith("/") || file.startsWith("\\"))
    return false;
  if (/^[A-Za-z]:/.test(file)) return false;
  if (file.includes("\0")) return false;

  const segments = file.split(/[/\\]/);
  if (segments.some((segment) => segment === "..")) return false;
  // Dependencies are never app source, ignored by git or not.
  if (segments.includes("node_modules")) return false;

  return READABLE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

export interface UpspectorCallPattern {
  kind: UpspectorDataCall["kind"];
  pattern: RegExp;
}

/**
 * Deliberately shallow: common data entry points of a React app. Hosts add
 * their own conventions (service layers, endpoint registries) on top. A miss
 * costs a missing row in the panel, never a wrong source file.
 */
export const DEFAULT_CALL_PATTERNS: readonly UpspectorCallPattern[] = [
  { kind: "http", pattern: /\bfetch\s*\(/ },
  {
    kind: "http",
    pattern: /\b(?:api|axios|client)\.(?:get|post|put|patch|delete)\s*[<(]/,
  },
  {
    kind: "hook",
    pattern: /\buse(?:SWR|SWRMutation|Query|Mutation|InfiniteQuery)\s*\(/,
  },
];

/**
 * Lists the data-fetching expressions in a file. This is a static scan: it
 * reports what the file can fetch, not what produced the clicked node.
 */
export function scanDataCalls(
  source: string,
  patterns: readonly UpspectorCallPattern[] = DEFAULT_CALL_PATTERNS,
): UpspectorDataCall[] {
  const calls: UpspectorDataCall[] = [];
  const lines = source.split("\n");

  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//") || line.startsWith("*")) continue;

    const matched = patterns.find((candidate) =>
      candidate.pattern.test(line),
    );
    if (!matched) continue;

    // First path-looking string literal on the line, e.g. `"/app/web/pages"`.
    const endpoint = /["'`](\/[^"'`\s]*)["'`]/.exec(line)?.[1];

    calls.push({
      kind: matched.kind,
      expression: line.length > 160 ? `${line.slice(0, 157)}...` : line,
      line: index + 1,
      ...(endpoint === undefined ? {} : { endpoint }),
    });
  }

  return calls;
}

/**
 * Module specifier the symbol is imported (or re-exported) from, so a data
 * call can be followed to the file that owns its endpoint.
 */
export function findImportSource(
  source: string,
  symbol: string,
): string | null {
  const statements = source.matchAll(
    /(?:import|export)\s+([^;]*?)\s*from\s*["']([^"']+)["']/g,
  );

  for (const [, clause, specifier] of statements) {
    if (!clause || !specifier) continue;

    const tokens = clause
      .replace(/[{}*]/g, " ")
      .split(/[\s,]+/)
      .filter((token) => token !== "" && token !== "type");
    const locals: string[] = [];

    for (let index = 0; index < tokens.length; index += 1) {
      // `a as b` binds the local name `b`, not `a`.
      if (tokens[index + 1] === "as") {
        const local = tokens[index + 2];

        if (local) locals.push(local);
        index += 2;
        continue;
      }

      const token = tokens[index];
      if (token) locals.push(token);
    }

    if (locals.includes(symbol)) return specifier;
  }

  return null;
}

/**
 * Matches a captured request URL against a `path-to-regexp` template.
 * `:param` stands for exactly one segment; a base path such as `/api/v1` in
 * front of the template is tolerated.
 */
export function matchesEndpoint(url: string, pattern: string): boolean {
  const body = pattern
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(":")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");

  return new RegExp(`/${body}(?:[/?#].*)?$`).test(url);
}
