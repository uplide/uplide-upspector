import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface FileChange {
  path: string;
  before: string | undefined;
  after: string;
}

/**
 * The project's files as the steps see them: reads fall through to disk, and
 * writes stay in memory until `commit`, so a dry run and a real run take the
 * same path.
 */
export class Workspace {
  readonly #pending = new Map<string, string>();

  constructor(readonly root: string) {}

  read(path: string): string | undefined {
    const pending = this.#pending.get(path);
    if (pending !== undefined) return pending;

    const absolute = join(this.root, path);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  }

  exists(path: string): boolean {
    return this.read(path) !== undefined;
  }

  /** The first of `paths` that exists. */
  find(paths: readonly string[]): string | undefined {
    return paths.find((path) => this.exists(path));
  }

  write(path: string, text: string): void {
    this.#pending.set(path, text);
  }

  changes(): FileChange[] {
    return [...this.#pending].flatMap(([path, after]) => {
      const absolute = join(this.root, path);
      const before = existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
      return before === after ? [] : [{ path, before, after }];
    });
  }

  commit(): FileChange[] {
    const changes = this.changes();
    for (const { path, after } of changes) {
      const absolute = join(this.root, path);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, after);
    }
    this.#pending.clear();
    return changes;
  }
}
