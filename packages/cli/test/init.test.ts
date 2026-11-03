import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SetupError } from "../src/context.js";
import { init } from "../src/init.js";
import { createProject, NEXT_CONFIG, readProjectFile } from "./helpers.js";

const quiet = { install: false, allowDirty: true, log: () => {} };

describe("init", () => {
  it("sets up a create-next-app project, and a second run changes nothing", async () => {
    const root = createProject({ "next.config.ts": NEXT_CONFIG });

    const first = await init({ cwd: root, ...quiet });

    expect(first.results.map(({ result }) => result.status)).toEqual([
      "applied",
      "applied",
      "applied",
      "applied",
      "applied",
      "applied",
      "skipped",
    ]);
    expect(first.changes.map(({ path }) => path).sort()).toEqual([
      "app/api/debugbar/inspect/route.ts",
      "app/layout.tsx",
      "debugbar.config.ts",
      "instrumentation-client.ts",
      "instrumentation.ts",
      "next.config.ts",
    ]);
    expect(readProjectFile(root, "next.config.ts")).toContain("withDebugbar(nextConfig)");

    const second = await init({ cwd: root, ...quiet });

    expect(second.changes).toEqual([]);
    expect(second.results.every(({ result }) => result.status === "skipped")).toBe(true);
  });

  it("writes nothing on a dry run and prints the diff", async () => {
    const root = createProject({ "next.config.ts": NEXT_CONFIG });
    const lines: string[] = [];

    const { changes } = await init({ cwd: root, ...quiet, dryRun: true, log: (line) => lines.push(line) });

    expect(changes).toHaveLength(6);
    expect(existsSync(join(root, "debugbar.config.ts"))).toBe(false);
    expect(lines.join("\n")).toContain("+export default withDebugbar(nextConfig);");
    expect(lines.join("\n")).toContain(
      "would run: npm install @uplide/debugbar @uplide/debugbar-next",
    );
  });

  it("takes the backend URL variable from .env.example", async () => {
    const root = createProject({ ".env.example": "NEXT_PUBLIC_BACKEND_URL=\n" });

    await init({ cwd: root, ...quiet });

    expect(readProjectFile(root, "debugbar.config.ts")).toContain(
      "origins: [process.env.NEXT_PUBLIC_BACKEND_URL]",
    );
  });

  it("asks for the variable when it can", async () => {
    const root = createProject();

    await init({ cwd: root, ...quiet, ask: async () => "NEXT_PUBLIC_API" });

    expect(readProjectFile(root, "debugbar.config.ts")).toContain("process.env.NEXT_PUBLIC_API]");
  });

  it("refuses a project without the App Router", async () => {
    const root = createProject({ "pages/index.tsx": "" });

    await expect(init({ cwd: root, ...quiet })).rejects.toThrow(SetupError);
  });

  it("refuses Next.js before 15.3", async () => {
    const root = createProject({
      "package.json": JSON.stringify({ dependencies: { next: "^15.2.0" } }),
    });

    await expect(init({ cwd: root, ...quiet })).rejects.toThrow("15.3 or newer");
  });
});
