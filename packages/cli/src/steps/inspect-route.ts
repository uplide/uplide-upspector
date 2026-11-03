import { posix } from "node:path";
import { applied, skipped, type Step } from "../step.js";

export const inspectRouteStep: Step = {
  name: "inspect-route",
  run({ files, appDir, ext }) {
    const dir = posix.join(appDir, "api/debugbar/inspect");
    const existing = files.find(["ts", "js"].map((e) => posix.join(dir, `route.${e}`)));
    if (existing) return skipped(`${existing} already exists`);

    const path = posix.join(dir, `route.${ext}`);
    files.write(
      path,
      `import { createInspectHandler } from "@uplide/debugbar-next/inspect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST } = createInspectHandler();
`,
    );
    return applied(`created ${path}`);
  },
};
