import { applied, skipped, type Step } from "../step.js";

// The files `withUpspector` looks for, in its order.
const CONFIG_FILES = [
  "upspector.config.ts",
  "upspector.config.mts",
  "upspector.config.js",
  "upspector.config.mjs",
];

export const configStep: Step = {
  name: "config",
  run({ files, ext, apiEnv }) {
    const existing = files.find(CONFIG_FILES);
    if (existing) return skipped(`${existing} already exists`);

    const path = `upspector.config.${ext}`;
    files.write(
      path,
      `import { defineNextUpspectorConfig } from "@uplide/upspector-next";

export default defineNextUpspectorConfig({
  enabled: process.env.NEXT_PUBLIC_UPSPECTOR === "true",
  backend: { origins: [process.env.${apiEnv}] },
});
`,
    );
    return applied(`created ${path}`);
  },
};
