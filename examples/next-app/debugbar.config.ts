import { defineNextDebugbarConfig } from "@uplide/debugbar-next";
import { API_BASE_URL } from "./lib/api";

export default defineNextDebugbarConfig({
  enabled: process.env.NEXT_PUBLIC_DEBUGBAR === "true",
  backend: { origins: [API_BASE_URL] },
  eventsEndpoint: "/api/debugbar/events",
});
