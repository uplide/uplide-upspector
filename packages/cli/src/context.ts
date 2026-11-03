import { existsSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { Workspace } from "./workspace.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface Project {
  files: Workspace;
  /** `"src"` when the app lives in `src/app`, otherwise `""`. */
  srcDir: string;
  /** `app` or `src/app`. */
  appDir: string;
  /** Extension for the files this tool creates. */
  ext: "ts" | "js";
  packageManager: PackageManager;
}

export interface Context extends Project {
  /** Env variable holding the backend's base URL. */
  apiEnv: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function readPackageJson(files: Workspace): PackageJson {
  const text = files.read("package.json");
  if (text === undefined) throw new SetupError("No package.json in this directory.");
  try {
    return JSON.parse(text) as PackageJson;
  } catch (error) {
    throw new SetupError(`package.json is not valid JSON: ${(error as Error).message}`);
  }
}

export function dependencyVersion(pkg: PackageJson, name: string): string | undefined {
  return pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
}

/** Thrown when the project is not one this tool can set up. */
export class SetupError extends Error {}

const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** Lowest `major.minor` named in a version range like `^15.3.0` or `16.4.2`. */
function minorOf(range: string): [number, number] | undefined {
  const match = /(\d+)\.(\d+)/.exec(range) ?? /(\d+)/.exec(range);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0)];
}

/**
 * The package manager whose lockfile is nearest, looking up from `root` so an
 * app inside a workspace finds the lockfile at the workspace root.
 */
function detectPackageManager(root: string): PackageManager {
  for (let dir = root; ; dir = dirname(dir)) {
    const found = LOCKFILES.find(([lockfile]) => existsSync(join(dir, lockfile)));
    if (found) return found[1];
    if (dirname(dir) === dir) return "npm";
  }
}

export function detectProject(files: Workspace): Project {
  const pkg = readPackageJson(files);
  const next = dependencyVersion(pkg, "next");
  if (!next) throw new SetupError("`next` is not a dependency of this project.");

  const version = minorOf(next);
  if (version && (version[0] < 15 || (version[0] === 15 && version[1] < 3))) {
    throw new SetupError(`The debugbar needs Next.js 15.3 or newer (found ${next}).`);
  }

  const srcDir = files.find(["app/layout.tsx", "app/layout.jsx", "app/layout.js"])
    ? ""
    : files.find(["src/app/layout.tsx", "src/app/layout.jsx", "src/app/layout.js"])
      ? "src"
      : undefined;
  if (srcDir === undefined) {
    throw new SetupError("No App Router root layout (app/layout or src/app/layout) found.");
  }

  return {
    files,
    srcDir,
    appDir: posix.join(srcDir, "app"),
    ext: files.exists("tsconfig.json") ? "ts" : "js",
    packageManager: detectPackageManager(files.root),
  };
}

/** The import specifier for `debugbar.config` as seen from `fromFile`. */
export function configImportFrom(fromFile: string): string {
  const relative = posix.relative(posix.dirname(fromFile), "debugbar.config");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
