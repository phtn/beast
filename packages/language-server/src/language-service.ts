import { readdir, readFile, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BeastCompileError,
  componentNameFromPath,
  parse,
  type SourceSpan,
} from "beast-tsrx";
import {
  CompletionItemKind,
  DiagnosticSeverity,
  Location,
  MarkupKind,
  Position,
  Range,
  SymbolKind,
  TextEdit,
  type CompletionItem,
  type Diagnostic,
  type DocumentLink,
  type DocumentSymbol,
  type Hover,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".zed",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const IMPORTABLE_EXTENSIONS = new Set([
  ".btsx",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const BEAST_KEYWORDS = [
  "import",
  "module",
  "component",
  "props",
  "setup",
  "if",
  "elseif",
  "else",
  "each",
  "switch",
  "try",
  "fragment",
  "style",
] as const;

const HTML_TAGS = [
  "a",
  "article",
  "aside",
  "button",
  "code",
  "div",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "header",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "ol",
  "option",
  "p",
  "section",
  "select",
  "span",
  "strong",
  "textarea",
  "ul",
] as const;

const HTML_ATTRIBUTES = [
  "aria-label",
  "checked",
  "class",
  "className",
  "data-testid",
  "disabled",
  "href",
  "id",
  "key",
  "name",
  "onChange",
  "onClick",
  "onInput",
  "placeholder",
  "ref",
  "rel",
  "role",
  "target",
  "title",
  "type",
  "value",
] as const;

interface IndexedComponent {
  name: string;
  path: string;
  props: string[];
  uri: string;
}

interface ImportRecord {
  binding?: string;
  range: Range;
  specifier: string;
  statementEndLine: number;
}

interface LogicalDocumentFragment {
  logicalStart: number;
  logicalEnd: number;
  line: number;
  character: number;
}

interface LogicalDocumentLine {
  content: string;
  fragments: LogicalDocumentFragment[];
  indent: number;
}

interface ImportPathContext {
  partial: string;
  range: Range;
}

export class BeastLanguageService {
  private components: IndexedComponent[] = [];
  private indexed = false;
  private roots: string[] = [];

  constructor(rootUris: readonly string[] = []) {
    this.setWorkspaceRoots(rootUris);
  }

  setWorkspaceRoots(rootUris: readonly string[]): void {
    this.roots = rootUris.flatMap((uri) => {
      try {
        return uri.startsWith("file:") ? [fileURLToPath(uri)] : [];
      } catch {
        return [];
      }
    });
    this.indexed = false;
  }

  async refresh(): Promise<void> {
    const paths = (
      await Promise.all(this.roots.map(async (root) => collectBtsxFiles(root)))
    ).flat();
    const components = await Promise.all(
      paths.map(async (path): Promise<IndexedComponent | null> => {
        try {
          const source = await readFile(path, "utf8");
          return {
            name: componentNameFromPath(path),
            path,
            props: extractProps(source, path),
            uri: pathToFileURL(path).href,
          };
        } catch {
          return null;
        }
      }),
    );
    this.components = components
      .filter((component): component is IndexedComponent => component !== null)
      .sort((left, right) => left.path.localeCompare(right.path));
    this.indexed = true;
  }

  async completions(
    document: TextDocument,
    position: Position,
  ): Promise<CompletionItem[]> {
    await this.ensureIndexed(document);
    const pathContext = importPathContext(document, position);
    if (pathContext !== null) {
      return this.importPathCompletions(document, pathContext);
    }

    const linePrefix = document.getText(
      Range.create(Position.create(position.line, 0), position),
    );
    const effectivePrefix = effectiveLinePrefix(document, position);
    const attributeContext = effectivePrefix.match(
      /([A-Za-z_$][A-Za-z0-9_$.:-]*)[^()]*\(([^)]*)$/u,
    );
    if (attributeContext !== null) {
      const tag = attributeContext[1] ?? "";
      return this.attributeCompletions(document, position, tag);
    }

    // Continuation payload is already merged into effectivePrefix; for keyword/tag
    // completion we complete the current payload word, not the whole merged line.
    const trimmed = isContinuationLine(document, position.line)
      ? continuationPayloadPrefix(document, position).trimStart()
      : linePrefix.trimStart();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(trimmed) && trimmed.length !== 0) {
      return [];
    }

    const replacement = currentWordRange(document, position);
    const items: CompletionItem[] = [];
    for (const keyword of BEAST_KEYWORDS) {
      if (matchesPrefix(keyword, trimmed)) {
        items.push({
          label: keyword,
          kind: CompletionItemKind.Keyword,
          sortText: `2-${keyword}`,
          textEdit: TextEdit.replace(replacement, keyword),
        });
      }
    }
    for (const tag of HTML_TAGS) {
      if (matchesPrefix(tag, trimmed)) {
        items.push({
          label: tag,
          kind: CompletionItemKind.Class,
          detail: "HTML element",
          sortText: `3-${tag}`,
          textEdit: TextEdit.replace(replacement, tag),
        });
      }
    }

    const documentPath = filePathForDocument(document);
    const imported = new Set(
      importsForDocument(document)
        .map((record) => record.binding)
        .filter((binding): binding is string => binding !== undefined),
    );
    const local = new Set(localComponentDeclarations(document).map(({ name }) => name));
    for (const component of this.components) {
      if (
        component.path === documentPath ||
        !matchesPrefix(component.name, trimmed)
      ) {
        continue;
      }
      const item: CompletionItem = {
        label: component.name,
        kind: CompletionItemKind.Class,
        detail: relativeDetail(documentPath, component.path),
        sortText: `1-${component.name}`,
        textEdit: TextEdit.replace(replacement, component.name),
      };
      if (!imported.has(component.name) && !local.has(component.name)) {
        const edit = autoImportEdit(document, component.name, component.path);
        if (edit !== null) item.additionalTextEdits = [edit];
      }
      items.push(item);
    }
    return deduplicateCompletions(items);
  }

  diagnostics(document: TextDocument): Diagnostic[] {
    try {
      parse(document.getText(), filePathForDocument(document) ?? document.uri);
      return [];
    } catch (error) {
      if (error instanceof BeastCompileError) {
        const diagnostic = error.diagnostic;
        return [
          {
            range: rangeFromSpan(diagnostic.span),
            severity:
              diagnostic.severity === "warning"
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Error,
            code: diagnostic.code,
            source: "beast",
            message:
              diagnostic.hint === undefined
                ? diagnostic.message
                : `${diagnostic.message}\n${diagnostic.hint}`,
          },
        ];
      }
      return [
        {
          range: Range.create(0, 0, 0, 1),
          severity: DiagnosticSeverity.Error,
          source: "beast",
          message: error instanceof Error ? error.message : "Unable to parse Beast document.",
        },
      ];
    }
  }

  async definitions(
    document: TextDocument,
    position: Position,
  ): Promise<Location[]> {
    await this.ensureIndexed(document);
    const imports = importsForDocument(document);
    const importAtPosition = imports.find((record) =>
      positionIsWithin(position, record.range),
    );
    if (importAtPosition !== undefined) {
      const target = await resolveImport(document, importAtPosition.specifier);
      return target === null ? [] : [Location.create(pathToFileURL(target).href, Range.create(0, 0, 0, 0))];
    }

    const word = wordAtPosition(document, position);
    if (word === null) return [];
    const local = localComponentDeclarations(document).find(
      (declaration) => declaration.name === word.text,
    );
    if (local !== undefined) return [Location.create(document.uri, local.range)];

    const imported = imports.find((record) => record.binding === word.text);
    if (imported !== undefined) {
      const target = await resolveImport(document, imported.specifier);
      return target === null ? [] : [Location.create(pathToFileURL(target).href, Range.create(0, 0, 0, 0))];
    }

    return this.components
      .filter((component) => component.name === word.text)
      .map((component) => Location.create(component.uri, Range.create(0, 0, 0, 0)));
  }

  async documentLinks(document: TextDocument): Promise<DocumentLink[]> {
    const links = await Promise.all(
      importsForDocument(document).map(async (record): Promise<DocumentLink | null> => {
        const target = await resolveImport(document, record.specifier);
        return target === null
          ? null
          : { range: record.range, target: pathToFileURL(target).href };
      }),
    );
    return links.filter((link): link is DocumentLink => link !== null);
  }

  documentSymbols(document: TextDocument): DocumentSymbol[] {
    return localComponentDeclarations(document).map((declaration) => ({
      name: declaration.name,
      kind: SymbolKind.Class,
      range: declaration.range,
      selectionRange: declaration.range,
    }));
  }

  async hover(document: TextDocument, position: Position): Promise<Hover | null> {
    await this.ensureIndexed(document);
    const word = wordAtPosition(document, position);
    if (word === null) return null;
    const component = this.components.find((candidate) => candidate.name === word.text);
    if (component === undefined) return null;
    const props = component.props.length === 0
      ? "No declared props"
      : `Props: ${component.props.join(", ")}`;
    return {
      range: word.range,
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${component.name}**  \n${props}  \n\`${component.path}\``,
      },
    };
  }

  async references(
    document: TextDocument,
    position: Position,
    includeDeclaration: boolean,
  ): Promise<Location[]> {
    await this.ensureIndexed(document);
    const word = wordAtPosition(document, position);
    if (word === null || !/^[A-Z]/u.test(word.text)) return [];
    const locations: Location[] = [];
    for (const component of this.components) {
      let source: string;
      try {
        source = component.uri === document.uri
          ? document.getText()
          : await readFile(component.path, "utf8");
      } catch {
        continue;
      }
      locations.push(...componentReferences(component.uri, source, word.text));
    }
    if (includeDeclaration) {
      for (const component of this.components) {
        if (component.name === word.text) {
          locations.push(Location.create(component.uri, Range.create(0, 0, 0, 0)));
        }
      }
    }
    return deduplicateLocations(locations);
  }

  private async attributeCompletions(
    document: TextDocument,
    position: Position,
    tag: string,
  ): Promise<CompletionItem[]> {
    const replacement = currentAttributeRange(document, position);
    const prefix = document.getText(replacement);
    const names = new Set<string>(HTML_ATTRIBUTES);
    const imported = importsForDocument(document).find((record) => record.binding === tag);
    let component: IndexedComponent | undefined;
    if (imported !== undefined) {
      const target = await resolveImport(document, imported.specifier);
      component = this.components.find((candidate) => candidate.path === target);
    } else {
      component = this.components.find((candidate) => candidate.name === tag);
    }
    for (const prop of component?.props ?? []) names.add(prop);
    return [...names]
      .filter((name) => matchesPrefix(name, prefix))
      .sort()
      .map((name) => ({
        label: name,
        kind: CompletionItemKind.Property,
        detail: component?.props.includes(name) === true ? `${tag} prop` : "HTML attribute",
        textEdit: TextEdit.replace(replacement, name),
      }));
  }

  private async ensureIndexed(document: TextDocument): Promise<void> {
    if (this.roots.length === 0) {
      const path = filePathForDocument(document);
      if (path !== null) this.roots = [dirname(path)];
    }
    if (!this.indexed) await this.refresh();
  }

  private async importPathCompletions(
    document: TextDocument,
    context: ImportPathContext,
  ): Promise<CompletionItem[]> {
    const documentPath = filePathForDocument(document);
    if (documentPath === null || (!context.partial.startsWith(".") && !context.partial.startsWith("/"))) {
      return [];
    }
    const slashIndex = context.partial.lastIndexOf("/");
    const directoryPrefix = slashIndex === -1 ? "" : context.partial.slice(0, slashIndex + 1);
    const namePrefix = slashIndex === -1 ? context.partial : context.partial.slice(slashIndex + 1);
    const directory = resolve(dirname(documentPath), directoryPrefix || ".");
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((entry) =>
        !entry.name.startsWith(".") &&
        matchesPrefix(entry.name, namePrefix) &&
        (entry.isDirectory() || IMPORTABLE_EXTENSIONS.has(extname(entry.name)))
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const specifier = `${directoryPrefix}${entry.name}${entry.isDirectory() ? "/" : ""}`;
        return {
          label: specifier,
          kind: entry.isDirectory() ? CompletionItemKind.Folder : CompletionItemKind.File,
          textEdit: TextEdit.replace(context.range, specifier),
        };
      });
  }
}

async function collectBtsxFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(path);
        } else if (entry.isFile() && extname(entry.name) === ".btsx") {
          files.push(path);
        }
      }),
    );
  }
  await walk(root);
  return files;
}

function extractProps(source: string, filename: string): string[] {
  let parameter: string | undefined;
  try {
    parameter = parse(source, filename).declarations.find(
      (declaration) => declaration.kind === "props",
    )?.parameter;
  } catch {
    parameter = source.match(/^props\s+(.+)$/mu)?.[1];
  }
  const destructuring = parameter?.match(/^\s*\{([^}]*)\}/u)?.[1];
  if (destructuring === undefined) return [];
  return destructuring
    .split(",")
    .map((part) => part.trim().replace(/^\.\.\./u, "").split(/\s*[:=]\s*/u, 1)[0] ?? "")
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name));
}

function importsForDocument(document: TextDocument): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const line of logicalDocumentLines(document.getText())) {
    const from = line.content.match(
      /^\s*import\s+(?:type\s+)?(?:([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,\s*)?)?[^"']*?\bfrom\s*(["'])([^"']+)\2/u,
    );
    const sideEffect = line.content.match(/^\s*import\s*(["'])([^"']+)\1/u);
    const specifier = from?.[3] ?? sideEffect?.[2];
    if (specifier === undefined) continue;
    const column = line.content.indexOf(specifier);
    const record: ImportRecord = {
      range: logicalDocumentRange(line, column, column + specifier.length),
      specifier,
      statementEndLine: Math.max(...line.fragments.map((fragment) => fragment.line)),
    };
    const binding = from?.[1];
    if (binding !== undefined) record.binding = binding;
    records.push(record);
  }
  return records;
}

function localComponentDeclarations(
  document: TextDocument,
): Array<{ name: string; range: Range }> {
  const declarations: Array<{ name: string; range: Range }> = [];
  document.getText().split(/\r?\n/u).forEach((line, lineNumber) => {
    if (isContinuationRawText(line)) return;
    const match = line.match(/^\s*component\s+([A-Z_$][A-Za-z0-9_$]*)\s*$/u);
    const name = match?.[1];
    if (name === undefined) return;
    const column = line.indexOf(name);
    declarations.push({
      name,
      range: Range.create(lineNumber, column, lineNumber, column + name.length),
    });
  });
  return declarations;
}

function importPathContext(
  document: TextDocument,
  position: Position,
): ImportPathContext | null {
  const prefix = document.getText(
    Range.create(Position.create(position.line, 0), position),
  );
  const match = prefix.match(/(?:\bfrom\s+|^\s*import\s+)(["'])([^"']*)$/u);
  const partial = match?.[2];
  if (partial === undefined) return null;
  return {
    partial,
    range: Range.create(
      position.line,
      position.character - partial.length,
      position.line,
      position.character,
    ),
  };
}

function autoImportEdit(
  document: TextDocument,
  componentName: string,
  componentPath: string,
): TextEdit | null {
  const documentPath = filePathForDocument(document);
  if (documentPath === null) return null;
  const imports = importsForDocument(document);
  const insertionLine = imports.length === 0
    ? modulePreludeEndLine(document.getText())
    : imports.reduce(
        (line, record) => Math.max(line, record.statementEndLine + 1),
        0,
      );
  const specifier = moduleSpecifier(documentPath, componentPath);
  return TextEdit.insert(
    Position.create(insertionLine, 0),
    `import ${componentName} from "${specifier}";\n`,
  );
}

function moduleSpecifier(fromPath: string, targetPath: string): string {
  const path = relative(dirname(fromPath), targetPath).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function modulePreludeEndLine(source: string): number {
  const lines = source.split(/\r?\n/u);
  let insertionLine = 0;
  let line = 0;
  while (line < lines.length) {
    const raw = lines[line] ?? "";
    const content = raw.trim();
    if (content.length === 0 || content.startsWith("//")) {
      insertionLine = line + 1;
      line += 1;
      continue;
    }
    if (/^module\s+/u.test(raw)) {
      insertionLine = line + 1;
      line += 1;
      continue;
    }
    if (raw === "module") {
      line += 1;
      while (line < lines.length) {
        const nested = lines[line] ?? "";
        if (nested.trim().length === 0 || /^[ \t]/u.test(nested)) {
          line += 1;
          continue;
        }
        break;
      }
      insertionLine = line;
      continue;
    }
    break;
  }
  return insertionLine;
}

async function resolveImport(
  document: TextDocument,
  specifier: string,
): Promise<string | null> {
  const documentPath = filePathForDocument(document);
  if (documentPath === null || (!specifier.startsWith(".") && !specifier.startsWith("/"))) {
    return null;
  }
  const base = resolve(dirname(documentPath), specifier);
  const candidates = extname(base).length === 0
    ? [base, ...[...IMPORTABLE_EXTENSIONS].map((extension) => `${base}${extension}`)]
    : [base];
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

function currentWordRange(document: TextDocument, position: Position): Range {
  const prefix = document.getText(
    Range.create(Position.create(position.line, 0), position),
  );
  const word = prefix.match(/[A-Za-z_$][A-Za-z0-9_$]*$/u)?.[0] ?? "";
  return Range.create(
    position.line,
    position.character - word.length,
    position.line,
    position.character,
  );
}

function currentAttributeRange(document: TextDocument, position: Position): Range {
  const prefix = document.getText(
    Range.create(Position.create(position.line, 0), position),
  );
  const word = prefix.match(/[A-Za-z0-9_$:-]*$/u)?.[0] ?? "";
  return Range.create(
    position.line,
    position.character - word.length,
    position.line,
    position.character,
  );
}

function wordAtPosition(
  document: TextDocument,
  position: Position,
): { range: Range; text: string } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  let start = offset;
  let end = offset;
  while (start > 0 && /[A-Za-z0-9_$]/u.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && /[A-Za-z0-9_$]/u.test(text[end] ?? "")) end += 1;
  if (start === end) return null;
  return {
    range: Range.create(document.positionAt(start), document.positionAt(end)),
    text: text.slice(start, end),
  };
}

function filePathForDocument(document: TextDocument): string | null {
  try {
    return document.uri.startsWith("file:") ? fileURLToPath(document.uri) : null;
  } catch {
    return null;
  }
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());
}

function positionIsWithin(position: Position, range: Range): boolean {
  return (
    position.line === range.start.line &&
    position.line === range.end.line &&
    position.character >= range.start.character &&
    position.character <= range.end.character
  );
}

function rangeFromSpan(span: SourceSpan): Range {
  return Range.create(
    Math.max(0, span.start.line - 1),
    Math.max(0, span.start.column - 1),
    Math.max(0, span.end.line - 1),
    Math.max(0, span.end.column - 1),
  );
}

function relativeDetail(documentPath: string | null, componentPath: string): string {
  return documentPath === null
    ? componentPath
    : moduleSpecifier(documentPath, componentPath);
}

function deduplicateCompletions(items: CompletionItem[]): CompletionItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.label}:${item.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function componentReferences(uri: string, source: string, name: string): Location[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const selector = new RegExp(`^(\\s*)(${escaped})(?=[.#(\\s]|$)`, "u");
  const imported = new RegExp(`^(\\s*import\\s+)(${escaped})(?=\\s|,)`, "u");
  const locations: Location[] = [];
  source.split(/\r?\n/u).forEach((line, lineNumber) => {
    if (isContinuationRawText(line)) return;
    const match = line.match(selector) ?? line.match(imported);
    if (match === null) return;
    const column = (match[1] ?? "").length;
    locations.push(
      Location.create(uri, Range.create(lineNumber, column, lineNumber, column + name.length)),
    );
  });
  return locations;
}

function logicalDocumentLines(source: string): LogicalDocumentLine[] {
  const result: LogicalDocumentLine[] = [];
  source.split(/\r?\n/u).forEach((raw, lineNumber) => {
    const leading = raw.match(/^[ \t]*/u)?.[0] ?? "";
    const content = raw.slice(leading.length).trimEnd();
    if (content.length === 0 || content.startsWith("//")) return;

    if (content.startsWith("~")) {
      const previous = result.at(-1);
      if (previous === undefined || leading.length <= previous.indent) return;
      let payloadStart = 1;
      while (content[payloadStart] === " " || content[payloadStart] === "\t") {
        payloadStart += 1;
      }
      const payload = content.slice(payloadStart).trimEnd();
      if (payload.length === 0 || payload.startsWith("//")) return;
      const logicalStart = previous.content.length + 1;
      previous.content += ` ${payload}`;
      previous.fragments.push({
        logicalStart,
        logicalEnd: logicalStart + payload.length,
        line: lineNumber,
        character: leading.length + payloadStart,
      });
      return;
    }

    result.push({
      content,
      fragments: [
        {
          logicalStart: 0,
          logicalEnd: content.length,
          line: lineNumber,
          character: leading.length,
        },
      ],
      indent: leading.length,
    });
  });
  return result;
}

function logicalDocumentRange(
  line: LogicalDocumentLine,
  start: number,
  end: number,
): Range {
  return Range.create(
    logicalDocumentPosition(line, start, "start"),
    logicalDocumentPosition(line, end, "end"),
  );
}

function logicalDocumentPosition(
  line: LogicalDocumentLine,
  offset: number,
  bias: "start" | "end",
): Position {
  let previous: LogicalDocumentFragment | undefined;
  for (const fragment of line.fragments) {
    if (offset < fragment.logicalStart) {
      return bias === "start"
        ? Position.create(fragment.line, fragment.character)
        : Position.create(
            previous?.line ?? fragment.line,
            previous === undefined
              ? fragment.character
              : previous.character + previous.logicalEnd - previous.logicalStart,
          );
    }
    if (offset <= fragment.logicalEnd) {
      return Position.create(
        fragment.line,
        fragment.character + Math.min(
          offset - fragment.logicalStart,
          fragment.logicalEnd - fragment.logicalStart,
        ),
      );
    }
    previous = fragment;
  }
  const last = previous ?? line.fragments[0];
  return last === undefined
    ? Position.create(0, 0)
    : Position.create(
        last.line,
        last.character + last.logicalEnd - last.logicalStart,
      );
}

function isContinuationRawText(line: string): boolean {
  return line.trimStart().startsWith("~");
}

function isContinuationLine(document: TextDocument, line: number): boolean {
  const text = document.getText(
    Range.create(Position.create(line, 0), Position.create(line, 1_000_000)),
  );
  return isContinuationRawText(text);
}

function continuationPayloadPrefix(document: TextDocument, position: Position): string {
  const prefix = document.getText(
    Range.create(Position.create(position.line, 0), position),
  );
  const trimmedStart = prefix.trimStart();
  if (!trimmedStart.startsWith("~")) return trimmedStart;
  let payload = trimmedStart.slice(1);
  if (payload.startsWith(" ") || payload.startsWith("\t")) payload = payload.slice(1);
  return payload.trimStart();
}

function effectiveLinePrefix(document: TextDocument, position: Position): string {
  const text = document.getText();
  const lines = text.split(/\r?\n/u);
  const rawLines: Array<{ content: string }> = [];
  for (let index = 0; index <= position.line; index += 1) {
    const raw = index < position.line
      ? (lines[index] ?? "")
      : (lines[index] ?? "").slice(0, position.character);
    const leading = raw.match(/^[ \t]*/u)?.[0] ?? "";
    const content = raw.slice(leading.length).trimEnd();
    if (content.length > 0 && !content.startsWith("//")) {
      rawLines.push({ content });
    }
  }
  const merged: Array<{ content: string }> = [];
  for (const line of rawLines) {
    if (line.content.startsWith("~")) {
      if (merged.length === 0) {
        // Orphan continuation - return its payload directly so completions don't crash.
        // Diagnostics will report BEAST1004 separately via parse().
        let payload = line.content.slice(1);
        if (payload.startsWith(" ") || payload.startsWith("\t")) payload = payload.slice(1);
        const trimmed = payload.trimStart();
        if (trimmed.length === 0 || trimmed.startsWith("//")) continue;
        merged.push({ content: trimmed });
        continue;
      }
      let payload = line.content.slice(1);
      if (payload.startsWith(" ") || payload.startsWith("\t")) payload = payload.slice(1);
      const trimmed = payload.trimStart();
      if (trimmed.length === 0) continue;
      if (trimmed.startsWith("//")) continue;
      const prev = merged[merged.length - 1];
      if (prev !== undefined) prev.content += ` ${trimmed}`;
      continue;
    }
    merged.push(line);
  }
  return merged.at(-1)?.content ?? "";
}

function deduplicateLocations(locations: Location[]): Location[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
