import { posix } from "node:path";
import { Node, type ArrowFunction, type FunctionDeclaration, type FunctionExpression } from "ts-morph";
import { configImportFrom } from "../context.js";
import { parseSource, quoted } from "../source.js";
import { applied, manual, skipped, type Step } from "../step.js";

function registerBlock(configImport: string): string {
  return `if (process.env.NEXT_RUNTIME === "nodejs") {
  const { registerDebugbar } = await import("@uplide/debugbar-next/server");
  const { default: debugbar } = await import("${configImport}");

  registerDebugbar(debugbar);
}`;
}

type RegisterFunction = FunctionDeclaration | ArrowFunction | FunctionExpression;

export const instrumentationStep: Step = {
  name: "instrumentation",
  run({ files, srcDir, ext }) {
    const candidates = ["ts", "js"].map((e) => posix.join(srcDir, `instrumentation.${e}`));
    const path = files.find(candidates) ?? posix.join(srcDir, `instrumentation.${ext}`);
    const block = registerBlock(configImportFrom(path));
    const text = files.read(path);

    const snippet = `export async function register() {\n${block.replace(/^(?=.)/gm, "  ")}\n}`;

    if (text === undefined) {
      files.write(path, `${snippet}\n`);
      return applied(`created ${path}`);
    }
    if (text.includes("registerDebugbar")) return skipped(`${path} already registers the debugbar`);

    const file = parseSource(path, text);

    let register: RegisterFunction | undefined = file.getFunction("register");
    if (!register) {
      const initializer = file.getVariableDeclaration("register")?.getInitializer();
      if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
        register = initializer;
      }
    }

    if (!register) {
      file.addStatements(`\n${quoted(file, snippet)}`);
      files.write(path, file.getFullText());
      return applied(`added register() to ${path}`);
    }

    const body = register.getBody();
    if (!Node.isBlock(body)) {
      return manual(`register() in ${path} has no block body`, snippet);
    }

    // First, so fetch is wrapped before anything else the hook sets up.
    body.insertStatements(0, `${quoted(file, block)}\n`);
    if (!register.isAsync()) register.setIsAsync(true);
    files.write(path, file.getFullText());
    return applied(`registered the debugbar in ${path}`);
  },
};

export const instrumentationClientStep: Step = {
  name: "instrumentation-client",
  run({ files, srcDir, ext }) {
    const candidates = ["ts", "js"].map((e) =>
      posix.join(srcDir, `instrumentation-client.${e}`),
    );
    const path = files.find(candidates) ?? posix.join(srcDir, `instrumentation-client.${ext}`);
    const configImport = configImportFrom(path);
    const text = files.read(path);

    if (text === undefined) {
      files.write(
        path,
        `import { installDebugbarClient } from "@uplide/debugbar-next/client";
import debugbar from "${configImport}";

installDebugbarClient(debugbar);
`,
      );
      return applied(`created ${path}`);
    }
    if (text.includes("installDebugbarClient")) {
      return skipped(`${path} already installs the debugbar client`);
    }

    const file = parseSource(path, text);
    const name = /\bdebugbar\b/.test(text) ? "debugbarConfig" : "debugbar";
    const imports = file.getImportDeclarations().length;
    file.insertImportDeclarations(imports, [
      { moduleSpecifier: "@uplide/debugbar-next/client", namedImports: ["installDebugbarClient"] },
      { moduleSpecifier: configImport, defaultImport: name },
    ]);
    // Right after the imports: the file runs before hydration, and the client
    // has to be in place before anything below it fetches.
    const firstStatement = file.getImportDeclarations().length;
    file.insertStatements(firstStatement, `\ninstallDebugbarClient(${name});`);
    files.write(path, file.getFullText());
    return applied(`installed the debugbar client in ${path}`);
  },
};
