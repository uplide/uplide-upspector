import { relative, sep } from "node:path";
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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export interface DebugbarInspectHandlerOptions extends DebugbarInspectOptions {
  /**
   * Hostnames besides loopback the dev server may be reached by, e.g. a LAN
   * IP when the app is opened from a phone. Each one widens who can read the
   * repository's source, so keep it empty unless needed.
   */
  allowedHosts?: readonly string[];
}

function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/**
 * `next dev` listens on every interface, and the route hands out source code,
 * so the request itself has to prove it comes from the developer's own page:
 * - a loopback `Host` (or an allowed one) shuts out the LAN and DNS rebinding,
 *   where a hostile domain resolves to 127.0.0.1 but keeps its own `Host`;
 * - a same-origin `Origin` / `Sec-Fetch-Site` shuts out other sites' pages;
 * - `application/json` forces a CORS preflight, which this route never
 *   answers, so a cross-site `text/plain` "simple request" cannot get in.
 * A request without `Origin` (curl, scripts) is not a browser CSRF and passes.
 */
function refuseRequest(
  request: Request,
  allowedHosts: readonly string[],
): Response | null {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const hostname = hostnameOf(host);

  if (!hostname || !(isLoopback(hostname) || allowedHosts.includes(hostname))) {
    return json({ error: "host not allowed" }, 403);
  }

  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return json({ error: "cross-site request refused" }, 403);
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // A malformed Origin is refused like a foreign one.
    }

    if (originHost !== host) {
      return json({ error: "cross-origin request refused" }, 403);
    }
  }

  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    return json({ error: "content-type must be application/json" }, 415);
  }

  return null;
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
