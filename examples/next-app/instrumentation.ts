export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerUpspector } = await import("@uplide/upspector-next/server");
  const { default: upspector } = await import("./upspector.config");

  registerUpspector(upspector);
}
