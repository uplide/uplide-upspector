import { posix } from "node:path";
import { applied, skipped, type Step } from "../step.js";

export const routeStep: Step = {
  name: "route",
  run({ files, appDir, ext }) {
    const dir = posix.join(appDir, "api/debugbar");
    const existing = files.find(
      ["[endpoint]", "inspect"].flatMap((name) =>
        ["ts", "js"].map((e) => posix.join(dir, name, `route.${e}`)),
      ),
    );
    if (existing) return skipped(`${existing} already exists`);

    const path = posix.join(dir, "[endpoint]", `route.${ext}`);
    files.write(
      path,
      `import { createDebugbarHandler } from "@uplide/debugbar-next/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { POST, GET, DELETE } = createDebugbarHandler();
`,
    );
    return applied(`created ${path}`);
  },
};
