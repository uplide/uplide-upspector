#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { SetupError } from "./context.js";
import { init } from "./init.js";

const USAGE = `Usage: upspector init [options]

Sets up @uplide/upspector-next in the Next.js App Router project in the current
directory. Each step is skipped when it is already in place, so running it
again is safe.

Options:
  --dry-run          Print the changes instead of writing them
  --yes, -y          Don't ask; take the suggested answers
  --api-env <name>   Env variable holding the backend's base URL
  --allow-dirty      Run with uncommitted changes in the git working tree
  --cwd <dir>        Project directory (default: current directory)
  --help, -h         Show this help`;

async function ask(question: string, suggested: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} (${suggested}): `);
    return answer.trim() || suggested;
  } finally {
    rl.close();
  }
}

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        "api-env": { type: "string" },
        "allow-dirty": { type: "boolean" },
        cwd: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    // Unknown option, or one missing its value.
    throw new SetupError(`${(error as Error).message}\n\n${USAGE}`);
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parse();

  if (values.help || positionals[0] !== "init") {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const interactive = !values.yes && process.stdin.isTTY === true;
  await init({
    cwd: values.cwd ?? process.cwd(),
    dryRun: values["dry-run"],
    allowDirty: values["allow-dirty"],
    apiEnv: values["api-env"],
    ask: interactive ? ask : undefined,
  });
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (!(error instanceof SetupError)) throw error;
    console.error(`upspector: ${error.message}`);
    process.exitCode = 1;
  },
);
