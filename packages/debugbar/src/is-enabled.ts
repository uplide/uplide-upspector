/**
 * Single kill switch for the whole debugbar integration.
 *
 * - `"false"` → off everywhere, even in development.
 * - `"true"` → on, also in a production build (staging).
 * - unset → on in development only.
 *
 * Both arguments must be read at *runtime* (e.g. `getEnvConfig("NODE_ENV")`,
 * which indexes `process.env` with a dynamic key). A bundler inlines literal
 * `process.env.NODE_ENV` / `process.env.NEXT_PUBLIC_*` reads at build time, and
 * a deployed image built without those values would then either fold the whole
 * feature away or — worse — treat production as development.
 */
export function resolveDebugbarEnabled(
  flag: string | undefined,
  nodeEnv: string | undefined,
): boolean {
  if (flag === "false") return false;
  if (flag === "true") return true;

  return nodeEnv === "development";
}
