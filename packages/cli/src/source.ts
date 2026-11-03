import {
  IndentationText,
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
    .map((line) => /^([ \t]+)\S/.exec(line)?.[1])
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

/**
 * Parses `text` on its own, with ts-morph set to the file's quote style and
 * indentation.
 */
export function parseSource(path: string, text: string): SourceFile {
  const firstQuote = /\bfrom\s+(['"])/.exec(text)?.[1];
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: {
      quoteKind: firstQuote === "'" ? QuoteKind.Single : QuoteKind.Double,
      indentationText: INDENTS[indentUnitOf(text)] ?? IndentationText.TwoSpaces,
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
      declaration.getModuleSpecifierValue() === module && !declaration.isTypeOnly(),
  );
  const present = new Set(
    existing?.getNamedImports().map((specifier) => specifier.getName()) ?? [],
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
