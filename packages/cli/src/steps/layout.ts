import { posix } from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  ensureNamedImports,
  eolOf,
  functionNamed,
  indentUnitOf,
  parseSource,
  quoted,
} from "../source.js";
import { applied, manual, skipped, type Step } from "../step.js";

const SERVER = "@uplide/upspector-next/server";

const SCOPE = `// Before anything is awaited, so the page's own requests are inside the scope.
openUpspectorScope({ profile: process.env.UPSPECTOR_RENDER_PROFILE === "true" });`;

const SNIPPET = `import { UpspectorRoot, openUpspectorScope } from "${SERVER}";
import { Suspense } from "react";

export default function RootLayout({ children }) {
  ${SCOPE.replace("\n", "\n  ")}

  return (
    <html>
      <body>
        {children}
        <Suspense>
          <UpspectorRoot />
        </Suspense>
      </body>
    </html>
  );
}`;

/** The component the layout default-exports, when it is declared in this file. */
function defaultExportedFunction(file: SourceFile) {
  const declared = file.getFunctions().find((fn) => fn.isDefaultExport());
  if (declared) return declared;

  const expression = file
    .getExportAssignment((assignment) => !assignment.isExportEquals())
    ?.getExpression();
  if (Node.isArrowFunction(expression) || Node.isFunctionExpression(expression)) {
    return expression;
  }
  return Node.isIdentifier(expression) ? functionNamed(file, expression.getText()) : undefined;
}

function isClientComponent(file: SourceFile): boolean {
  const first = file.getStatements()[0];
  return (
    Node.isExpressionStatement(first) &&
    /^["']use client["']$/.test(first.getExpression().getText())
  );
}

export const layoutStep: Step = {
  name: "layout",
  run({ files, appDir }) {
    const candidates = ["tsx", "jsx", "js"].map((e) => posix.join(appDir, `layout.${e}`));
    const path = files.find(candidates);
    if (!path) return manual(`no root layout in ${appDir}`, SNIPPET);

    const text = files.read(path) ?? "";
    if (text.includes("UpspectorRoot")) return skipped(`${path} already renders UpspectorRoot`);

    const file = parseSource(path, text);
    if (isClientComponent(file)) {
      return manual(`${path} is a client component; UpspectorRoot needs a server layout`, SNIPPET);
    }

    const layout = defaultExportedFunction(file);
    const body = layout?.getBody();
    if (!layout || !Node.isBlock(body)) {
      return manual(`could not find the body of the layout component in ${path}`, SNIPPET);
    }

    const bodyElements = layout
      .getDescendantsOfKind(SyntaxKind.JsxElement)
      .filter((element) => element.getOpeningElement().getTagNameNode().getText() === "body");
    if (bodyElements.length !== 1) {
      return manual(`expected one <body> in the layout component in ${path}`, SNIPPET);
    }

    const closingStart = bodyElements[0]!.getClosingElement().getStart();
    const lineIndent = text.slice(text.lastIndexOf("\n", closingStart - 1) + 1, closingStart);
    const unit = indentUnitOf(text);
    const eol = eolOf(text);
    const insertion = /^[ \t]*$/.test(lineIndent)
      ? `${unit}<Suspense>${eol}${lineIndent}${unit}${unit}<UpspectorRoot />${eol}${lineIndent}${unit}</Suspense>${eol}${lineIndent}`
      : "<Suspense><UpspectorRoot /></Suspense>";

    // The edits below all land before `</body>`, so its offset from the end of
    // the file holds; the JSX is spliced in as text once they are done.
    const fromEnd = text.length - closingStart;
    body.insertStatements(0, `${quoted(file, SCOPE)}\n`);
    ensureNamedImports(file, SERVER, ["UpspectorRoot", "openUpspectorScope"]);
    ensureNamedImports(file, "react", ["Suspense"]);

    const updated = file.getFullText();
    const at = updated.length - fromEnd;
    files.write(path, updated.slice(0, at) + insertion + updated.slice(at));
    return applied(`rendered UpspectorRoot in ${path}`);
  },
};
