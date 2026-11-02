import { withDebugbar } from "@uplide/debugbar-next/config";
import type { NextConfig } from "next";
import debugbar from "./debugbar.config";

const isDev = process.env.NODE_ENV !== "production";

/** Adds the `data-insp-path` attributes the element picker reads. */
function inspectorRules(): NonNullable<NextConfig["turbopack"]>["rules"] {
  if (!isDev) return undefined;

  const { codeInspectorPlugin } = require("code-inspector-plugin");
  // Only the app's own files: the linked workspace packages are built output.
  // Turbopack needs serializable options, so a path fragment, not a RegExp.
  return codeInspectorPlugin({ bundler: "turbopack", exclude: ["packages"] });
}

const nextConfig: NextConfig = {
  turbopack: { rules: inspectorRules() },
};

export default withDebugbar(nextConfig, { enabled: debugbar.enabled });
