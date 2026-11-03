import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SetupError } from "../src/context.js";
import { init } from "../src/init.js";
import { createProject, LAYOUT, NEXT_CONFIG, PACKAGE_JSON, readProjectFile } from "./helpers.js";

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
      "app/api/upspector/[endpoint]/route.ts",
      "app/layout.tsx",
      "instrumentation-client.ts",
      "instrumentation.ts",
      "next.config.ts",
      "upspector.config.ts",
    ]);
    expect(readProjectFile(root, "next.config.ts")).toContain("withUpspector(nextConfig)");

    const second = await init({ cwd: root, ...quiet });

    expect(second.changes).toEqual([]);
    expect(second.results.every(({ result }) => result.status === "skipped")).toBe(true);
  });

  it("writes nothing on a dry run and prints the diff", async () => {
    const root = createProject({ "next.config.ts": NEXT_CONFIG });
    const lines: string[] = [];

    const { changes } = await init({ cwd: root, ...quiet, dryRun: true, log: (line) => lines.push(line) });

    expect(changes).toHaveLength(6);
    expect(existsSync(join(root, "upspector.config.ts"))).toBe(false);
    expect(lines.join("\n")).toContain("+export default withUpspector(nextConfig);");
    expect(lines.join("\n")).toContain(
      "would run: npm install @uplide/upspector @uplide/upspector-next",
    );
  });

  it("takes the backend URL variable from .env.example", async () => {
    const root = createProject({ ".env.example": "NEXT_PUBLIC_BACKEND_URL=\n" });

    await init({ cwd: root, ...quiet });

    expect(readProjectFile(root, "upspector.config.ts")).toContain(
      "origins: [process.env.NEXT_PUBLIC_BACKEND_URL]",
    );
  });

  it("asks for the variable when it can", async () => {
    const root = createProject();

    await init({ cwd: root, ...quiet, ask: async () => "NEXT_PUBLIC_API" });

    expect(readProjectFile(root, "upspector.config.ts")).toContain("process.env.NEXT_PUBLIC_API]");
  });

  it("refuses a variable name that isn't an identifier", async () => {
    const root = createProject();

    await expect(init({ cwd: root, ...quiet, apiEnv: "API URL" })).rejects.toThrow(SetupError);
    expect(existsSync(join(root, "upspector.config.ts"))).toBe(false);
  });

  it("refuses a project without the App Router", async () => {
    const root = createProject({ "pages/index.tsx": "" });
    let asked = false;
    const ask = async (_question: string, suggested: string) => {
      asked = true;
      return suggested;
    };

    await expect(init({ cwd: root, ...quiet, ask })).rejects.toThrow(SetupError);
    expect(asked).toBe(false);
  });

  it("finds the lockfile of the workspace the app sits in", async () => {
    const root = createProject({
      "pnpm-lock.yaml": "",
      "apps/web/package.json": PACKAGE_JSON,
      "apps/web/app/layout.tsx": LAYOUT,
    });
    const lines: string[] = [];

    await init({ cwd: join(root, "apps/web"), ...quiet, log: (line) => lines.push(line) });

    expect(lines).toContain("\nwould run: pnpm add @uplide/upspector @uplide/upspector-next");
  });

  it("refuses Next.js before 15.3", async () => {
    const root = createProject({
      "package.json": JSON.stringify({ dependencies: { next: "^15.2.0" } }),
    });

    await expect(init({ cwd: root, ...quiet })).rejects.toThrow("15.3 or newer");
  });
});
