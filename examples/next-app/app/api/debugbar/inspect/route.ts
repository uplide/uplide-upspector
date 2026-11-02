import { createInspectHandler } from "@uplide/debugbar-next/inspect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST } = createInspectHandler();
