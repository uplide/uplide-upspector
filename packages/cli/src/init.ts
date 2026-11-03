import { spawnSync } from "node:child_process";
import { createTwoFilesPatch } from "diff";
import {
  type Context,
  dependencyVersion,
  detectProject,
  type PackageManager,
  readPackageJson,
  SetupError,
} from "./context.js";
import type { Step, StepResult } from "./step.js";
import { configStep } from "./steps/config.js";
import { envStep } from "./steps/env.js";
import { routeStep } from "./steps/route.js";
import { instrumentationClientStep, instrumentationStep } from "./steps/instrumentation.js";
import { layoutStep } from "./steps/layout.js";
import { nextConfigStep } from "./steps/next-config.js";
import { type FileChange, Workspace } from "./workspace.js";

export const STEPS: readonly Step[] = [
  configStep,
  nextConfigStep,
  instrumentationStep,
  instrumentationClientStep,
  layoutStep,
  routeStep,
  envStep,
];

const PACKAGES = ["@uplide/debugbar", "@uplide/debugbar-next"];
const DEFAULT_API_ENV = "NEXT_PUBLIC_API_BASE_URL";

export interface InitOptions {
  cwd: string;
  /** Print the changes instead of writing them. */
  dryRun?: boolean;
  /** Run even when the git working tree has uncommitted changes. */
  allowDirty?: boolean;
  /** Install the packages; off in tests. */
  install?: boolean;
  /** Env variable holding the backend URL; asked for when absent and `ask` is given. */
  apiEnv?: string;
  ask?: (question: string, suggested: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface InitResult {
  results: { step: string; result: StepResult }[];
  changes: FileChange[];
}

function isDirty(cwd: string): boolean {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
  // Not a git repository, or no git: nothing to protect against.
  return status.status === 0 && status.stdout.trim() !== "";
}

/** A backend URL variable the project's env template already names. */
function suggestApiEnv(files: Workspace): string {
  const example = files.read(".env.example") ?? "";
  return (
    /^\s*(NEXT_PUBLIC_\w*(?:API|BACKEND)\w*URL)\s*=/im.exec(example)?.[1] ?? DEFAULT_API_ENV
  );
}

function installCommand(packageManager: PackageManager, packages: string[]): string[] {
  const verb = packageManager === "npm" ? "install" : "add";
  return [packageManager, verb, ...packages];
}

const MARKS: Record<StepResult["status"], string> = {
  applied: "+",
  skipped: "=",
  manual: "!",
};

export async function init(options: InitOptions): Promise<InitResult> {
  const { cwd, dryRun = false, install = true, log = console.log } = options;

  if (!dryRun && !options.allowDirty && isDirty(cwd)) {
    throw new SetupError(
      "The git working tree has uncommitted changes. Commit or stash them, or pass --allow-dirty.",
    );
  }

  const files = new Workspace(cwd);
  // Before asking anything, so an unsupported project fails straight away.
  const project = detectProject(files);
  let apiEnv = options.apiEnv;
  if (!apiEnv) {
    const suggested = suggestApiEnv(files);
    apiEnv = options.ask
      ? await options.ask("Env variable with the backend's base URL", suggested)
      : suggested;
  }
  // It is spliced into `process.env.<name>` in the generated config.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiEnv)) {
    throw new SetupError(`\`${apiEnv}\` is not a valid env variable name.`);
  }
  if (!apiEnv.startsWith("NEXT_PUBLIC_")) {
    log(`! ${apiEnv} has no NEXT_PUBLIC_ prefix, so the browser half of the debugbar won't see it.`);
  }
  const context: Context = { ...project, apiEnv };

  const results = STEPS.map((step) => ({ step: step.name, result: step.run(context) }));
  for (const { step, result } of results) {
    log(`${MARKS[result.status]} ${step}: ${result.detail}`);
  }

  const changes = dryRun ? files.changes() : files.commit();
  if (dryRun) {
    for (const { path, before, after } of changes) {
      log("");
      log(createTwoFilesPatch(path, path, before ?? "", after, undefined, undefined, { context: 3 }).trimEnd());
    }
  }

  const pkg = readPackageJson(files);
  const missing = PACKAGES.filter((name) => !dependencyVersion(pkg, name));
  if (missing.length > 0) {
    const command = installCommand(context.packageManager, missing);
    if (dryRun || !install) {
      log(`\nwould run: ${command.join(" ")}`);
    } else {
      log(`\n${command.join(" ")}`);
      const [bin, ...args] = command;
      const run = spawnSync(bin!, args, {
        cwd,
        stdio: "inherit",
        shell: process.platform === "win32",
      });
      if (run.status !== 0) log(`! install failed; run it yourself: ${command.join(" ")}`);
    }
  }

  const manual = results.filter(({ result }) => result.status === "manual");
  for (const { step, result } of manual) {
    if (result.status !== "manual") continue;
    log(`\n! ${step} needs a manual edit: ${result.detail}\n\n${result.snippet}`);
  }

  log(`
Turn it on in .env.local:
  NEXT_PUBLIC_DEBUGBAR=true
  ${apiEnv}=<backend URL>

A browser calling the backend cross-origin only sees the payload when its CORS
config has exposedHeaders: ["x-debugbar"].`);

  return { results, changes };
}
