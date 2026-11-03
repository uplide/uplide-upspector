import { createDebugbarHandler } from "@uplide/debugbar-next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST, GET, DELETE } = createDebugbarHandler();
