import { posix } from "node:path";
import { Node } from "ts-morph";
import { configImportFrom } from "../context.js";
import { functionNamed, parseSource, quoted } from "../source.js";
import { applied, manual, skipped, type Step } from "../step.js";

function registerBlock(configImport: string): string {
  return `if (process.env.NEXT_RUNTIME === "nodejs") {
  const { registerUpspector } = await import("@uplide/upspector-next/server");
  const { default: upspector } = await import("${configImport}");

  registerUpspector(upspector);
}`;
}

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
    if (text.includes("registerUpspector")) return skipped(`${path} already registers Upspector`);

    const file = parseSource(path, text);

    const register = functionNamed(file, "register");
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
    return applied(`registered the Upspector in ${path}`);
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
        `import { installUpspectorClient } from "@uplide/upspector-next/client";
import upspector from "${configImport}";

installUpspectorClient(upspector);
`,
      );
      return applied(`created ${path}`);
    }
    if (text.includes("installUpspectorClient")) {
      return skipped(`${path} already installs the Upspector client`);
    }

    const file = parseSource(path, text);
    const name = /\bupspector\b/.test(text) ? "upspectorConfig" : "upspector";
    const imports = file.getImportDeclarations().length;
    file.insertImportDeclarations(imports, [
      { moduleSpecifier: "@uplide/upspector-next/client", namedImports: ["installUpspectorClient"] },
      { moduleSpecifier: configImport, defaultImport: name },
    ]);
    // Right after the imports: the file runs before hydration, and the client
    // has to be in place before anything below it fetches.
    const firstStatement = file.getImportDeclarations().length;
    file.insertStatements(firstStatement, `\ninstallUpspectorClient(${name});`);
    files.write(path, file.getFullText());
    return applied(`installed the Upspector client in ${path}`);
  },
};
