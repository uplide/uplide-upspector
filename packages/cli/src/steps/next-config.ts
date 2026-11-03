import { Node, type Expression, type SourceFile } from "ts-morph";
import { ensureNamedImports, functionNamed, parseSource } from "../source.js";
import { applied, manual, skipped, type Step } from "../step.js";

const NEXT_CONFIGS = ["next.config.ts", "next.config.mts", "next.config.mjs", "next.config.js"];
const MODULE = "@uplide/debugbar-next/config";

const SNIPPET = `import { withDebugbar } from "${MODULE}";

export default withDebugbar(nextConfig);`;

/** Whether the exported config is Next's function form, which `withDebugbar` cannot wrap. */
function isFunctionConfig(file: SourceFile, expression: Expression): boolean {
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) return true;
  return Node.isIdentifier(expression) && functionNamed(file, expression.getText()) !== undefined;
}

export const nextConfigStep: Step = {
  name: "next-config",
  run({ files, ext }) {
    const path = files.find(NEXT_CONFIGS);
    if (!path) {
      const created = ext === "ts" ? "next.config.ts" : "next.config.mjs";
      files.write(
        created,
        ext === "ts"
          ? `import { withDebugbar } from "${MODULE}";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default withDebugbar(nextConfig);
`
          : `import { withDebugbar } from "${MODULE}";

export default withDebugbar({});
`,
      );
      return applied(`created ${created}`);
    }

    const text = files.read(path) ?? "";
    if (text.includes("withDebugbar")) return skipped(`${path} already uses withDebugbar`);

    const file = parseSource(path, text);
    const expression = file
      .getExportAssignment((assignment) => !assignment.isExportEquals())
      ?.getExpression();
    if (!expression) {
      return manual(`${path} has no \`export default <config>\` to wrap`, SNIPPET);
    }
    if (isFunctionConfig(file, expression)) {
      return manual(
        `${path} exports a config function; wrap the object it returns`,
        SNIPPET,
      );
    }

    // Outermost: other plugins expect an object, and withDebugbar returns
    // Next's function form.
    expression.replaceWithText(`withDebugbar(${expression.getText()})`);
    ensureNamedImports(file, MODULE, ["withDebugbar"]);
    files.write(path, file.getFullText());
    return applied(`wrapped the default export of ${path} with withDebugbar`);
  },
};
