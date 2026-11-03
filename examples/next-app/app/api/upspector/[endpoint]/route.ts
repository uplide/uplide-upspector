import { createUpspectorHandler } from "@uplide/upspector-next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST, GET, DELETE } = createUpspectorHandler();
