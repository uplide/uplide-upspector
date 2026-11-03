import { createMcpHandler } from "@uplide/debugbar-next/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST, GET, DELETE } = createMcpHandler();
