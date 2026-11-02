import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  type DebugbarCallPattern,
  type DebugbarCommitInfo,
  type DebugbarDataCall,
  type DebugbarInspectResult,
  type DebugbarInspectSource,
  isReadableSourcePath,
  parseInspectPath,
  scanDataCalls,
} from "@uplide/debugbar";

/**
 * Server half of the element inspector: turns `data-insp-path` attributes into
 * source snippets, `git blame` authorship and the data calls of each file.
 *
 * Development-only by contract — the route handler that calls this refuses to
 * answer outside development. Nothing here is reachable from a client bundle.
 */

const run = promisify(execFile);

/** Lines of context shown around the element's own line. */
export const SNIPPET_RADIUS = 6;

/** Ancestors walked outwards from the clicked node. */
export const MAX_INSPECT_FRAMES = 8;

/** A hung `git` must not hold a dev request open. */
const GIT_TIMEOUT_MS = 5_000;

async function git(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run("git", args, {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });

    return stdout;
  } catch {
    return null;
  }
}

/**
 * Whether git sees `file` as part of the working tree: tracked, or new and not
 * ignored. Everything `.gitignore` covers — `node_modules`, build output,
 * local secret files — stays unreadable even with a source extension.
 * `--literal-pathspecs` keeps a `:(glob)…` value from widening the match, and
 * the exact comparison keeps a directory named like a file from passing.
 */
async function isGitVisible(repoRoot: string, file: string): Promise<boolean> {
  const normalized = file.replace(/\\/g, "/");
  const stdout = await git(repoRoot, [
    "--literal-pathspecs",
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    normalized,
  ]);

  return stdout?.split("\n").includes(normalized) ?? false;
}

/** Repository-relative, a source file, and neither ignored nor outside git. */
async function isServableSource(
  repoRoot: string,
  file: string,
): Promise<boolean> {
  return isReadableSourcePath(file) && (await isGitVisible(repoRoot, file));
}

/** Repository root, so repo-relative `data-insp-path` values resolve. */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  const stdout = await git(cwd, ["rev-parse", "--show-toplevel"]);

  return stdout?.trim() || null;
}

const PORCELAIN_FIELDS: Record<string, keyof DebugbarCommitInfo> = {
  author: "author",
  "author-mail": "email",
  summary: "summary",
};

/**
 * Blame of a single line. `--line-porcelain` is the only blame format that
 * reports author, mail, time and subject in one call.
 */
async function blameLine(
  repoRoot: string,
  file: string,
  line: number,
): Promise<DebugbarCommitInfo | null> {
  const stdout = await git(repoRoot, [
    "blame",
    "-L",
    `${line},${line}`,
    "--line-porcelain",
    "--",
    file,
  ]);
  if (!stdout) return null;

  const lines = stdout.split("\n");
  const commit = lines[0]?.split(" ")[0];
  if (!commit) return null;

  const info: DebugbarCommitInfo = {
    commit: commit.slice(0, 9),
    author: "",
    email: "",
    at: "",
    summary: "",
  };

  for (const entry of lines.slice(1)) {
    const separator = entry.indexOf(" ");
    if (separator < 0) continue;

    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);

    if (key === "author-time") {
      info.at = new Date(Number(value) * 1000).toISOString();
      continue;
    }

    const field = PORCELAIN_FIELDS[key];
    if (field) info[field] = value.replace(/^<|>$/g, "");
  }

  return info.author === "" ? null : info;
}

const LOG_FORMAT = "%H%x00%an%x00%ae%x00%aI%x00%s";

/** Last commit that touched the whole file. */
async function lastFileCommit(
  repoRoot: string,
  file: string,
): Promise<DebugbarCommitInfo | null> {
  const stdout = await git(repoRoot, [
    "log",
    "-1",
    `--format=${LOG_FORMAT}`,
    "--",
    file,
  ]);
  if (!stdout) return null;

  const [commit, author, email, at, summary] = stdout.trim().split("\0");
  if (!commit || !author) return null;

  return {
    commit: commit.slice(0, 9),
    author,
    email: email ?? "",
    at: at ?? "",
    summary: summary ?? "",
  };
}

const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Path aliases as the host's tsconfig declares them: specifier prefix (e.g.
 * `"@/"`) → repository-relative directory (e.g. `"apps/web"`).
 */
export type DebugbarPathAliases = Record<string, string>;

export interface DebugbarInspectOptions {
  /** Data-call patterns scanned in each file; defaults to the generic set. */
  patterns?: readonly DebugbarCallPattern[];
  /** Used to follow imports when a resolver reads another module. */
  aliases?: DebugbarPathAliases;
  /**
   * Gives a data call the backend route it hits when the call itself carries
   * no path literal (a service layer, an endpoint registry). First defined
   * answer wins.
   */
  resolvers?: readonly DebugbarCallResolver[];
}

export interface DebugbarResolverContext {
  repoRoot: string;
  /** Repository-relative file the call was found in. */
  file: string;
  source: string;
  call: DebugbarDataCall;
  /** Reads a module imported from `fromFile`, honouring the aliases. */
  readModule: (
    fromFile: string,
    specifier: string,
  ) => Promise<{ file: string; source: string } | null>;
}

export type DebugbarCallResolver = (
  context: DebugbarResolverContext,
) => Promise<string | undefined> | string | undefined;

function joinSegments(parts: string[]): string {
  return parts
    .reduce<string[]>((stack, part) => {
      if (part === "." || part === "") return stack;
      if (part === "..") return stack.slice(0, -1);

      return [...stack, part];
    }, [])
    .join("/");
}

/**
 * Resolves a module specifier the way a tsconfig would: relative paths
 * against the importing file, aliased ones against their directory. Bare
 * package specifiers are out of scope — endpoints live in the app.
 */
export async function readSourceModule(
  repoRoot: string,
  fromFile: string,
  specifier: string,
  aliases: DebugbarPathAliases = {},
): Promise<{ file: string; source: string } | null> {
  let base: string | null = null;

  if (specifier.startsWith(".")) {
    base = joinSegments([
      ...fromFile.split("/").slice(0, -1),
      ...specifier.split("/"),
    ]);
  } else {
    const prefix = Object.keys(aliases).find((key) => specifier.startsWith(key));
    const target = prefix === undefined ? undefined : aliases[prefix];

    if (prefix !== undefined && target !== undefined) {
      base = joinSegments([
        ...target.split("/"),
        ...specifier.slice(prefix.length).split("/"),
      ]);
    }
  }

  if (base === null) return null;

  for (const extension of SOURCE_EXTENSIONS) {
    const file = `${base}${extension}`;
    if (!(await isServableSource(repoRoot, file))) continue;

    try {
      return { file, source: await readFile(`${repoRoot}/${file}`, "utf8") };
    } catch {
      // Next candidate extension.
    }
  }

  return null;
}

async function resolveCallEndpoint(
  context: DebugbarResolverContext,
  resolvers: readonly DebugbarCallResolver[],
): Promise<string | undefined> {
  if (context.call.endpoint) return context.call.endpoint;

  for (const resolver of resolvers) {
    const endpoint = await resolver(context);
    if (endpoint !== undefined) return endpoint;
  }

  return undefined;
}

async function resolveFrame(
  repoRoot: string,
  value: string,
  options: DebugbarInspectOptions,
): Promise<DebugbarInspectSource | null> {
  const frame = parseInspectPath(value);
  if (!frame) return null;
  if (!(await isServableSource(repoRoot, frame.file))) {
    return {
      ...frame,
      snippetStartLine: frame.line,
      snippet: [],
      lineCommit: null,
      fileCommit: null,
      dataCalls: [],
      error:
        "path refused: outside the repository, ignored by git or not a source file",
    };
  }

  let source: string;
  try {
    source = await readFile(`${repoRoot}/${frame.file}`, "utf8");
  } catch (error) {
    return {
      ...frame,
      snippetStartLine: frame.line,
      snippet: [],
      lineCommit: null,
      fileCommit: null,
      dataCalls: [],
      error: String(error),
    };
  }

  const lines = source.split("\n");
  const start = Math.max(1, frame.line - SNIPPET_RADIUS);
  const end = Math.min(lines.length, frame.line + SNIPPET_RADIUS);
  const [lineCommit, fileCommit] = await Promise.all([
    blameLine(repoRoot, frame.file, Math.min(frame.line, lines.length)),
    lastFileCommit(repoRoot, frame.file),
  ]);
  const dataCalls = await Promise.all(
    scanDataCalls(source, options.patterns).map(async (call) => {
      const endpoint = await resolveCallEndpoint(
        {
          repoRoot,
          file: frame.file,
          source,
          call,
          readModule: (fromFile, specifier) =>
            readSourceModule(repoRoot, fromFile, specifier, options.aliases),
        },
        options.resolvers ?? [],
      );

      return endpoint === undefined ? call : { ...call, endpoint };
    }),
  );

  return {
    ...frame,
    snippetStartLine: start,
    snippet: lines.slice(start - 1, end),
    lineCommit,
    fileCommit,
    dataCalls,
  };
}

/**
 * Resolves the clicked node's `data-insp-path` chain, innermost first.
 * Unparseable entries are dropped; unreadable ones come back with `error` so
 * the panel can say why instead of silently shrinking.
 */
export async function resolveInspectFrames(
  repoRoot: string,
  paths: string[],
  options: DebugbarInspectOptions = {},
): Promise<DebugbarInspectResult> {
  const resolved = await Promise.all(
    paths
      .slice(0, MAX_INSPECT_FRAMES)
      .map((value) => resolveFrame(repoRoot, value, options)),
  );

  return {
    repoRoot,
    frames: resolved.filter((frame): frame is DebugbarInspectSource => !!frame),
  };
}
