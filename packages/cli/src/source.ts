import {
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  IndentationText,
  NewLineKind,
  Node,
  Project,
  QuoteKind,
  ScriptKind,
  type SourceFile,
} from "ts-morph";

const INDENTS: Record<string, IndentationText> = {
  "\t": IndentationText.Tab,
  "  ": IndentationText.TwoSpaces,
  "    ": IndentationText.FourSpaces,
};

/** The file's own indentation unit, so inserted code matches it. */
export function indentUnitOf(text: string): string {
  const indents = text
    .split("\n")
    // Not the ` * ` lines of a block comment, which sit one space in.
    .map((line) => /^([ \t]+)(?!\*)\S/.exec(line)?.[1])
    .filter((indent): indent is string => indent !== undefined);
  if (indents.some((indent) => indent.startsWith("\t"))) return "\t";

  const smallest = Math.min(...indents.map((indent) => indent.length));
  return smallest === 4 ? "    " : "  ";
}

function scriptKindOf(path: string): ScriptKind {
  if (path.endsWith(".tsx")) return ScriptKind.TSX;
  if (path.endsWith(".ts") || path.endsWith(".mts")) return ScriptKind.TS;
  return ScriptKind.JSX;
}

/** The file's line ending, so inserted code matches it. */
export function eolOf(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Parses `text` on its own, with ts-morph set to the file's quote style,
 * indentation and line endings.
 */
export function parseSource(path: string, text: string): SourceFile {
  const firstQuote = /\bfrom\s+(['"])/.exec(text)?.[1];
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      quoteKind: firstQuote === "'" ? QuoteKind.Single : QuoteKind.Double,
      indentationText: INDENTS[indentUnitOf(text)] ?? IndentationText.TwoSpaces,
      newLineKind:
        eolOf(text) === "\r\n" ? NewLineKind.CarriageReturnLineFeed : NewLineKind.LineFeed,
    },
  });
  return project.createSourceFile(path, text, {
    overwrite: true,
    scriptKind: scriptKindOf(path),
  });
}

/** Adds `names` to the file's import from `module`, creating it when missing. */
export function ensureNamedImports(
  file: SourceFile,
  module: string,
  names: readonly string[],
): void {
  const existing = file.getImportDeclaration(
    (declaration) =>
      declaration.getModuleSpecifierValue() === module &&
      !declaration.isTypeOnly() &&
      // `import * as React` cannot take named imports next to it.
      !declaration.getNamespaceImport(),
  );
  // Only names bound as themselves: `{ Suspense as S }` leaves `Suspense` unbound.
  const present = new Set(
    existing
      ?.getNamedImports()
      .filter((specifier) => !specifier.getAliasNode() && !specifier.isTypeOnly())
      .map((specifier) => specifier.getName()) ?? [],
  );
  const missing = names.filter((name) => !present.has(name));
  if (missing.length === 0) return;

  if (existing) {
    existing.addNamedImports(missing);
    return;
  }
  file.insertImportDeclaration(file.getImportDeclarations().length, {
    moduleSpecifier: module,
    namedImports: missing,
  });
}

export type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** The function `name` refers to: a declaration, or a variable holding an arrow or function expression. */
export function functionNamed(file: SourceFile, name: string): FunctionLike | undefined {
  const declared = file.getFunction(name);
  if (declared) return declared;
  const initializer = file.getVariableDeclaration(name)?.getInitializer();
  return Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
    ? initializer
    : undefined;
}

/** Adds `import name from "module"` after the file's other imports. */
export function addDefaultImport(file: SourceFile, module: string, name: string): void {
  file.insertImportDeclaration(file.getImportDeclarations().length, {
    moduleSpecifier: module,
    defaultImport: name,
  });
}

/** Single-quotes the string literals in a snippet when the file uses them. */
export function quoted(file: SourceFile, code: string): string {
  const single = file.getProject().manipulationSettings.getQuoteKind() === QuoteKind.Single;
  return single ? code.replace(/"([^"\n]*)"/g, "'$1'") : code;
}
