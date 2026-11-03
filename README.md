# Upspector

A per-request debug overlay for a NestJS backend and a React / Next.js frontend. The
backend measures every request (SQL, outbound HTTP, cache, logs, timers) and
appends the result to the JSON response; the frontend lifts it off again —
from axios or `fetch`, in the browser or during SSR — and shows it in an
overlay.

| Package | What it is |
| --- | --- |
| `@uplide/upspector-protocol` | The wire contract: payload types, `UPSPECTOR_PAYLOAD_VERSION`, the `x-upspector` header, guards. |
| `@uplide/upspector-nest` | NestJS collector and integrations (Prisma driver adapter, Drizzle, ioredis, axios, fetch, logger). |
| `@uplide/upspector` | Framework-agnostic capture (`/axios`, `/fetch`) and the React overlay (`/react`). |
| `@uplide/upspector-next` | Next.js App Router glue: SSR capture, render profiling, inspector route. |
| `@uplide/upspector-cli` | `upspector init`: sets up `@uplide/upspector-next` in a Next.js project. |

## Wire contract

- The payload rides under a top-level key of every plain-object JSON response
  (default `upspector`, configurable on both sides — keep them equal).
- Every response that carries it also has `x-upspector: <version>`. The `fetch`
  adapter reads a body only when that header is present, so any other response
  — streams, files, an API proxy passing bytes through — is never buffered.
- When the backend's snapshot itself fails, the key holds
  `{ version, error }`; the overlay shows that error instead of nothing.

## Backend (NestJS)

```ts
// main.module.ts
NestUpspectorModule.forRoot({
  enabled: process.env.APP_DEBUG === "true",
  skip: (req) => (req.originalUrl ?? "").startsWith("/metrics"),
});

// main.ts — before guards and pipes, so guard queries are captured too
const options = app.get<ResolvedUpspectorOptions>(UPSPECTOR_OPTIONS);
if (options.enabled) {
  app.use(createUpspectorMiddleware(options));
  app.useLogger(new UpspectorConsoleLogger());
  installAxiosInstrumentation(axios);
  installFetchInstrumentation();
}

// Prisma 7: wrap the driver adapter, not the client
new PrismaClient({
  adapter: instrumentPrismaDriverAdapter(new PrismaPg(pool), options),
});

// Drizzle: wrap the database, any driver
const db = instrumentDrizzleDatabase(drizzle(pool), options);

// ioredis
instrumentRedisClient(redis);
```

Browsers only see `x-upspector` cross-origin when CORS exposes it:
`exposedHeaders: ["x-upspector"]`. The payload contains SQL text and bound
parameters — never enable it on a production deployment that real users hit.

## Frontend (Next.js App Router)

`pnpm dlx @uplide/upspector-cli init` makes the changes below (`--dry-run` to
preview them). By hand:

One config, shared by server and browser:

```ts
// upspector.config.ts
import { defineNextUpspectorConfig } from "@uplide/upspector-next";

export default defineNextUpspectorConfig({
  enabled: process.env.NEXT_PUBLIC_UPSPECTOR === "true",
  backend: {
    origins: [process.env.NEXT_PUBLIC_API_BASE_URL],
    proxyPath: "/api/proxy", // optional same-origin proxy the browser uses
  },
});
```

```ts
// next.config.ts — dev HMR otherwise serves fetches from cache and the bar stays empty.
// Reads upspector.config.{ts,mts,js,mjs} from the project root.
// { configFile: "path/to/file.ts" } to use another path.
import { withUpspector } from "@uplide/upspector-next/config";

export default withUpspector(nextConfig);
```

```ts
// instrumentation.ts — wraps fetch before Next patches it
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerUpspector } = await import("@uplide/upspector-next/server");
    registerUpspector((await import("./upspector.config")).default);
  }
}
```

```ts
// instrumentation-client.ts — synchronous, runs before hydration
import { installUpspectorClient } from "@uplide/upspector-next/client";
import upspector from "./upspector.config";

installUpspectorClient(upspector);
```

```tsx
// app/layout.tsx
import { UpspectorRoot, openUpspectorScope } from "@uplide/upspector-next/server";

export default async function RootLayout({ children }) {
  openUpspectorScope({ profile: process.env.UPSPECTOR_RENDER_PROFILE === "true" }); // before the first await
  return (
    <html>
      <body>
        {children}
        <Suspense>
          <UpspectorRoot />
        </Suspense>
      </body>
    </html>
  );
}
```

```ts
// app/api/upspector/[endpoint]/route.ts
import { createUpspectorHandler } from "@uplide/upspector-next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST, GET, DELETE } = createUpspectorHandler();
```

Nothing else changes in the app: every server and browser `fetch` to the
backend is captured. Requests outside a render (route handlers, middleware)
are left alone, and `fetch(url, { upspector: false })` opts a single call out.

### axios instances

```ts
attachUpspectorServerAxios(serverApi);   // SSR, from @uplide/upspector-next/server
attachUpspector(browserApi);             // browser, from @uplide/upspector/axios
```

Attach before any interceptor that snapshots response bodies.

### Redaction

Captured exchanges are masked before they reach the overlay store or the
page's RSC payload:

- header names, query parameters and JSON body fields are matched by name
  *part*, in any spelling (`X-Api-Token`, `apiKey`, `refresh_token`):
  - `token`, `secret`, `password`, `cookie`, `credential`, `signature`,
    `jwt`, `otp`, `sessionId`, `<api|access|secret|private|…> key` — always
    masked;
  - `key`, `session`, `auth` alone — masked only when the value looks
    generated (long, unbroken, letters mixed with digits), so `cacheKey:
    "products:page:12"` or `authProvider: "google"` stay visible;
  - a trailing metadata part describes a secret instead of holding it and is
    shown: `tokenType`, `tokenExpiresAt`, `passwordUpdatedAt`,
    `signatureVersion`, `sessionCount`;
  - booleans and nulls are never masked (`hasPassword: true`);
  - a container under an always-masked name is masked whole
    (`credentials: {…}`); under `session`/`auth` its generated-looking
    values are;
- URL userinfo, and values shaped like credentials under any name:
  `Bearer`/`Basic` headers, JWTs, `sk_live_…`, GitHub and Slack tokens, AWS
  access key ids;
- in **SSR** captures, every header value outside a small allowlist (content,
  caching and correlation headers). Server-side requests carry headers the
  browser never sent, so they are not trusted to a name pattern.

```ts
defineNextUpspectorConfig({
  // …
  redactKeys: ["x-tenant", /ssn$/i],   // always mask: headers, query, bodies
  revealKeys: ["sortKey"],             // never mask by name (credential-shaped values still are)
  ssrHeaders: ["x-backend-node"],      // extra SSR header values to show; "all" disables the allowlist
});
```

Non-JSON bodies and secrets inside URL paths (`/reset/<token>`) are not
masked unless their value has a credential format. A short hand-picked
secret under an ambiguous name (`x-internal-auth: letmein`) does not look
generated and is shown in CSR captures; list such names in `redactKeys`.

### Element inspector

The picker reads `data-insp-path` attributes from
[`code-inspector-plugin`](https://github.com/zh-lx/code-inspector) in development builds.
`createUpspectorHandler` (and `createInspectHandler`) accepts:

- `patterns` — extra data-call patterns (defaults: `fetch`, axios-style clients, SWR/React Query hooks);
- `aliases` — import aliases (default `{ "@/": <app dir> }`);
- `resolvers` — functions that map a call with no path literal (a service layer, an endpoint registry) to its backend route; `readModule` in the context follows imports.
- `allowedHosts` — hostnames besides loopback the dev server may be reached by (e.g. a LAN IP); default none.

The route answers only in development, only to a same-origin
`application/json` POST on a loopback host, and only with files git does not
ignore — `next dev` listens on every interface, so the LAN and other sites'
pages are refused.

## Other React apps

```ts
setUpspectorConfig({ enabled: true, match: (url) => url.startsWith(API) });
installFetchCapture();          // or attachUpspector(axiosInstance)
```

and render `<UpspectorOverlay />` from `@uplide/upspector/react` once.

The overlay styles itself; override the accent with `:root { --udbg-accent: … }`
and pass `nonce` under a strict CSP.

## Development

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

## Example

`examples/nest-api` (NestJS + Prisma on SQLite, port 4100) and
`examples/next-app` (Next.js 16, port 4200) are wired exactly as above.

```bash
pnpm install && pnpm build
pnpm --filter example-nest-api db:push
APP_DEBUG=true pnpm example:api              # terminal 1
NEXT_PUBLIC_UPSPECTOR=true pnpm example:web   # terminal 2
```

Both flags default to off: without them the apps run but no payload is
attached or captured.

Open http://localhost:4200: the product list is an SSR request with a
deliberate N+1; the buttons issue browser requests through `fetch` and axios,
a 400 error envelope, and an `upspector: false` opt-out.

## License

[Apache License 2.0](LICENSE)
