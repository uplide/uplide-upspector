import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

interface NextConfigLike {
  experimental?: object;
}

export interface WithDebugbarOptions {
  /**
   * Path to the debugbar config, relative to the project root. By default the
   * first `debugbar.config.{ts,mts,js,mjs}` found there is used.
   */
  configFile?: string;
}

const CONFIG_FILES = [
  "debugbar.config.ts",
  "debugbar.config.mts",
  "debugbar.config.js",
  "debugbar.config.mjs",
];

function findConfigFile(root: string, configFile: string | undefined): string {
  const candidates = configFile ? [configFile] : CONFIG_FILES;
  const found = candidates
    .map((name) => resolve(root, name))
    .find((path) => existsSync(path));

  if (!found) {
    throw new Error(
      `[debugbar] No config file found in ${root} (looked for ${candidates.join(", ")}).`,
    );
  }
  return found;
}

/**
 * Next caches Server Component `fetch` responses across HMR in development,
 * including `no-store` ones, so after an edit the backend is never called and
 * the bar comes back empty. Turning that cache off while the debugbar is on
 * keeps every refresh a real round trip; with the debugbar off the config is
 * returned untouched.
 *
 * The debugbar config is read from the project root, the same file
 * `instrumentation.ts` and `instrumentation-client.ts` import. Loading a
 * TypeScript file is async, so this returns Next's function form of the
 * config.
 */
export function withDebugbar<T extends NextConfigLike>(
  nextConfig: T,
  { configFile }: WithDebugbarOptions = {},
): () => Promise<T> {
  return async () => {
    const path = findConfigFile(process.cwd(), configFile);
    const jiti = createJiti(import.meta.url, { moduleCache: false });
    const { enabled } = await jiti.import<{ enabled: boolean }>(path, {
      default: true,
    });

    if (!enabled) return nextConfig;

    return {
      ...nextConfig,
      experimental: {
        ...nextConfig.experimental,
        serverComponentsHmrCache: false,
      },
    };
  };
}
