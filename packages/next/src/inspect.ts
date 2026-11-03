import { relative, sep } from "node:path";
import { json, refuseRequest } from "./guard.js";
import {
  type DebugbarInspectOptions,
  findRepoRoot,
  resolveInspectFrames,
} from "./server-inspect.js";

export {
  MAX_INSPECT_FRAMES,
  readSourceModule,
  SNIPPET_RADIUS,
} from "./server-inspect.js";
export type {
  DebugbarCallResolver,
  DebugbarInspectOptions,
  DebugbarPathAliases,
  DebugbarResolverContext,
} from "./server-inspect.js";

export interface DebugbarInspectHandlerOptions extends DebugbarInspectOptions {
  /**
   * Hostnames besides loopback the dev server may be reached by, e.g. a LAN
   * IP when the app is opened from a phone. Each one widens who can read the
   * repository's source, so keep it empty unless needed.
   */
  allowedHosts?: readonly string[];
}

/**
 * Route handler for the element picker: resolves a `data-insp-path` chain to
 * source, `git blame` authorship and the data calls of each file.
 *
 * Development only, and deliberately so: it reads repository files and shells
 * out to `git`. A production image has neither the source attributes nor,
 * usually, a git checkout. Without `aliases`, `@/` resolves to the app root.
 */
export function createInspectHandler({
  allowedHosts = [],
  ...options
}: DebugbarInspectHandlerOptions = {}) {
  async function POST(request: Request): Promise<Response> {
    if (process.env.NODE_ENV !== "development") {
      return new Response(null, { status: 404 });
    }

    const refused = refuseRequest(request, allowedHosts);
    if (refused) return refused;

    const body = (await request.json().catch(() => ({}))) as {
      paths?: unknown;
    };
    const paths = Array.isArray(body.paths)
      ? body.paths.filter((value): value is string => typeof value === "string")
      : [];

    if (paths.length === 0) return json({ error: "no paths given" }, 400);

    const cwd = process.cwd();
    const repoRoot = await findRepoRoot(cwd);

    if (!repoRoot) return json({ error: `not a git checkout: ${cwd}` }, 409);

    const appDir = relative(repoRoot, cwd).split(sep).join("/");

    return json(
      await resolveInspectFrames(repoRoot, paths, {
        ...options,
        aliases: options.aliases ?? { "@/": appDir },
      }),
    );
  }

  return { POST };
}
