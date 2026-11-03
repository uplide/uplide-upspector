import { defineNextUpspectorConfig } from "@uplide/upspector-next";
import { API_BASE_URL } from "./lib/api";

export default defineNextUpspectorConfig({
  enabled: process.env.NEXT_PUBLIC_UPSPECTOR === "true",
  backend: { origins: [API_BASE_URL] },
  mcp: true,
});
