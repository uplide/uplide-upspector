import { resolveDebugbarOptions } from "@uplide/debugbar-nest";

/** One options object for the module, the middleware and the Prisma adapter. */
export const debugbarOptions = resolveDebugbarOptions({
  enabled: process.env.APP_DEBUG === "true",
  skip: (req) => (req.originalUrl ?? req.url ?? "").startsWith("/api/health"),
});
