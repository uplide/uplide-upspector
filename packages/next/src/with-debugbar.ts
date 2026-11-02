interface NextConfigLike {
  experimental?: object;
}

/**
 * Next caches Server Component `fetch` responses across HMR in development,
 * including `no-store` ones, so after an edit the backend is never called and
 * the bar comes back empty. Turning that cache off while the debugbar is on
 * keeps every refresh a real round trip; with the debugbar off the config is
 * returned untouched.
 */
export function withDebugbar<T extends NextConfigLike>(
  nextConfig: T,
  { enabled }: { enabled: boolean },
): T {
  if (!enabled) return nextConfig;

  return {
    ...nextConfig,
    experimental: {
      ...nextConfig.experimental,
      serverComponentsHmrCache: false,
    },
  };
}
