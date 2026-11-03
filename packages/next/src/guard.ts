export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
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
 * `next dev` listens on every interface, and the Upspector routes hand out
 * source code and captured queries, so the request itself has to prove it
 * comes from the developer's own machine:
 * - a loopback `Host` (or an allowed one) shuts out the LAN and DNS rebinding,
 *   where a hostile domain resolves to 127.0.0.1 but keeps its own `Host`;
 * - a same-origin `Origin` / `Sec-Fetch-Site` shuts out other sites' pages;
 * - `application/json` forces a CORS preflight, which these routes never
 *   answer, so a cross-site `text/plain` "simple request" cannot get in.
 * A request without `Origin` (curl, scripts, an MCP client) is not a browser
 * CSRF and passes.
 */
export function refuseRequest(
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
