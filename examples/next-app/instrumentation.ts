export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerDebugbar } = await import("@uplide/debugbar-next/server");
  const { default: debugbar } = await import("./debugbar.config");

  registerDebugbar(debugbar);
}
