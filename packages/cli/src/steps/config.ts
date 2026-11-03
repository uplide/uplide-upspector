import { applied, skipped, type Step } from "../step.js";

// The files `withDebugbar` looks for, in its order.
const CONFIG_FILES = [
  "debugbar.config.ts",
  "debugbar.config.mts",
  "debugbar.config.js",
  "debugbar.config.mjs",
];

export const configStep: Step = {
  name: "config",
  run({ files, ext, apiEnv }) {
    const existing = files.find(CONFIG_FILES);
    if (existing) return skipped(`${existing} already exists`);

    const path = `debugbar.config.${ext}`;
    files.write(
      path,
      `import { defineNextDebugbarConfig } from "@uplide/debugbar-next";

export default defineNextDebugbarConfig({
  enabled: process.env.NEXT_PUBLIC_DEBUGBAR === "true",
  backend: { origins: [process.env.${apiEnv}] },
});
`,
    );
    return applied(`created ${path}`);
  },
};
