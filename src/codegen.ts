import { addSegment, GenMapping, setSourceContent, toEncodedMap } from "@jridgewell/gen-mapping";
import type {
  BeastDocument,
  BeastNode,
  ComponentDeclaration,
  EachNode,
  ElementNode,
  FragmentNode,
  IfNode,
  NamedAttr,
  SourcePosition,
  SourceTextFragment,
  StyleNode,
  SwitchNode,
  SetupDeclaration,
  TextSpan,
  TryNode,
} from "./ast.js";
import { BeastCompileError } from "./diagnostics.js";
import type { BeastSourceMap } from "./source-map.js";

export interface GenerateOptions {
  componentName: string;
  propsParam?: string;
}

export interface GenerateResult {
  code: string;
  map: BeastSourceMap;
}

interface GeneratedMapping {
  column: number;
  source: SourcePosition;
}

interface GeneratedLine {
  code: string;
  mappings: GeneratedMapping[];
}

interface GeneratedChunk {
  code: string;
  mappings: GeneratedMapping[];
}

const PRINT_WIDTH = 80;

export function generateTsrx(document: BeastDocument, options: GenerateOptions): string {
  return generateLines(document, options).map((line) => line.code).join("\n") + "\n";
}

export function generateTsrxResult(
  document: BeastDocument,
  source: string,
  options: GenerateOptions,
): GenerateResult {
  const lines = generateLines(document, options);
  const code = `${lines.map((line) => line.code).join("\n")}\n`;
  const generatedFilename = document.filename.endsWith(".btsx")
    ? document.filename.replace(/\.btsx$/u, ".tsrx")
    : `${document.filename}.tsrx`;
  const builder = new GenMapping({ file: generatedFilename });
  setSourceContent(builder, document.filename, source);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined) continue;
    for (const mapping of line.mappings) {
      addSegment(
        builder,
        lineIndex,
        mapping.column,
        document.filename,
        mapping.source.line - 1,
        mapping.source.column - 1,
      );
    }
  }
  const encoded = toEncodedMap(builder);
  return {
    code,
    map: {
      version: 3,
      file: generatedFilename,
      sources: [...encoded.sources],
      sourcesContent: [...(encoded.sourcesContent ?? [])],
      names: [...encoded.names],
      mappings: encoded.mappings,
    },
  };
}

function generateLines(document: BeastDocument, options: GenerateOptions): GeneratedLine[] {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(options.componentName)) {
    throw new BeastCompileError({
      code: "BEAST2001_INVALID_COMPONENT_NAME",
      severity: "error",
      message: `\`${options.componentName}\` is not a valid component identifier.`,
      filename: document.filename,
      span: document.span,
    });
  }

  const sourceProps = document.declarations.find((declaration) => declaration.kind === "props");
  const parameter = (options.propsParam ?? sourceProps?.parameter ?? "").trim();
  const setup = document.declarations.filter((declaration) => declaration.kind === "setup");
  const localComponents = document.declarations.filter(
    (declaration): declaration is ComponentDeclaration => declaration.kind === "component",
  );
  const lines: GeneratedLine[] = [];
  for (const declaration of document.declarations) {
    if (declaration.kind === "import" || declaration.kind === "module") {
      lines.push(
        ...mappedSourceTextLines(
          declaration.code,
          declaration.codeFragments,
          "",
          declaration.kind === "module"
            ? declaration.codeStart
            : declaration.span.start,
        ),
      );
    }
  }
  if (lines.length > 0) lines.push(unmappedLine(""));

  for (const component of localComponents) {
    lines.push(
      ...generateComponent(
        component.name,
        component.props?.parameter ?? "",
        component.setup,
        component.children,
        false,
        document,
        component.span.start,
      ),
    );
    lines.push(unmappedLine(""));
  }

  const rootSource =
    sourceProps?.span.start ?? document.children[0]?.span.start ?? document.span.start;
  lines.push(
    ...generateComponent(
      options.componentName,
      parameter,
      setup,
      document.children,
      true,
      document,
      rootSource,
    ),
  );
  return lines;
}

function generateComponent(
  componentName: string,
  parameter: string,
  setup: readonly SetupDeclaration[],
  children: readonly BeastNode[],
  exportDefault: boolean,
  document: BeastDocument,
  source: SourcePosition,
): GeneratedLine[] {
  const lines = generateComponentOpening(componentName, parameter, exportDefault)
    .map((code) => mappedLine(code, source));
  if (setup.length > 0) {
    for (const declaration of setup) {
      lines.push(
        ...mappedSourceTextLines(
          declaration.code,
          declaration.codeFragments,
          indent(1),
          declaration.codeStart,
        ),
      );
    }
    lines.push(unmappedLine(""));
  }
  const rootNeedsFragment =
    children.length !== 1 ||
    children[0]?.kind === "text" ||
    children[0]?.kind === "style";
  if (rootNeedsFragment) {
    lines.push(mappedLine(`${indent(1)}<>`, source));
    for (const child of children) lines.push(...generateNode(child, 2, document));
    lines.push(mappedLine(`${indent(1)}</>`, source));
  } else {
    const child = children[0];
    if (child !== undefined) lines.push(...generateNode(child, 1, document));
  }
  lines.push(mappedLine("}", source));
  return lines;
}

function generateNode(node: BeastNode, depth: number, document: BeastDocument): GeneratedLine[] {
  switch (node.kind) {
    case "element":
      return generateElement(node, depth, document);
    case "text":
      return [mappedLine(`${indent(depth)}${generateText(node.spans)}`, node.span.start)];
    case "fragment":
      return generateFragment(node, depth, document);
    case "style":
      return generateStyle(node, depth);
    case "if":
      return generateIf(node, depth, document);
    case "each":
      return generateEach(node, depth, document);
    case "switch":
      return generateSwitch(node, depth, document);
    case "try":
      return generateTry(node, depth, document);
  }
}

function generateFragment(
  node: FragmentNode,
  depth: number,
  document: BeastDocument,
): GeneratedLine[] {
  const lines = [mappedLine(`${indent(depth)}<>`, node.span.start)];
  for (const child of node.children) lines.push(...generateNode(child, depth + 1, document));
  lines.push(mappedLine(`${indent(depth)}</>`, node.span.start));
  return lines;
}

function generateStyle(node: StyleNode, depth: number): GeneratedLine[] {
  const lines = [mappedLine(`${indent(depth)}<style>`, node.span.start)];
  lines.push(
    ...mappedSourceTextLines(
      node.css,
      node.cssFragments,
      indent(depth + 1),
      node.codeStart,
    ),
  );
  lines.push(mappedLine(`${indent(depth)}</style>`, node.span.start));
  return lines;
}

function generateElement(
  node: ElementNode,
  depth: number,
  document: BeastDocument,
): GeneratedLine[] {
  const padding = indent(depth);
  const attributes = generateAttributes(node, document);
  const opening = `<${node.tag}${attributes.code.length === 0 ? "" : ` ${attributes.code}`}`;
  const inline = node.inlineSpans === null ? "" : generateText(node.inlineSpans);
  const openingLine = (suffix: string): GeneratedLine => {
    const line = mappedLine(`${padding}${opening}${suffix}`, node.span.start);
    const attributeOffset = padding.length + node.tag.length + 2;
    for (const mapping of attributes.mappings) {
      line.mappings.push({ column: attributeOffset + mapping.column, source: mapping.source });
    }
    return line;
  };

  if (node.children.length === 0 && inline.length === 0) {
    return [openingLine(" />")];
  }
  if (node.children.length === 0) {
    return [openingLine(`>${inline}</${node.tag}>`)];
  }

  const lines = [openingLine(">")];
  if (inline.length > 0) {
    lines.push(mappedLine(`${indent(depth + 1)}${inline}`, node.span.start));
  }
  for (const child of node.children) lines.push(...generateNode(child, depth + 1, document));
  lines.push(mappedLine(`${padding}</${node.tag}>`, node.span.start));
  return lines;
}

function generateIf(node: IfNode, depth: number, document: BeastDocument): GeneratedLine[] {
  const lines: GeneratedLine[] = [];
  for (let index = 0; index < node.branches.length; index += 1) {
    const branch = node.branches[index];
    if (branch === undefined) continue;
    if (index === 0) {
      lines.push(mappedLine(`${indent(depth)}@if (${branch.test}) {`, branch.span.start));
    } else if (branch.test === null) {
      appendMapped(lines.at(-1), " @else {", branch.span.start);
    } else {
      appendMapped(lines.at(-1), ` @else if (${branch.test}) {`, branch.span.start);
    }
    for (const child of branch.children) lines.push(...generateNode(child, depth + 1, document));
    lines.push(mappedLine(`${indent(depth)}}`, branch.span.start));
  }
  return lines;
}

function generateEach(node: EachNode, depth: number, document: BeastDocument): GeneratedLine[] {
  const options = [
    node.indexName === null ? "" : `; index ${node.indexName}`,
    node.key === null ? "" : `; key ${node.key}`,
  ].join("");
  const lines = [
    mappedLine(
      `${indent(depth)}@for (const ${node.itemName} of ${node.iterable}${options}) {`,
      node.span.start,
    ),
  ];
  for (const child of node.children) lines.push(...generateNode(child, depth + 1, document));
  lines.push(mappedLine(`${indent(depth)}}`, node.span.start));
  if (node.emptyChildren !== null) {
    appendMapped(lines.at(-1), " @empty {", node.span.start);
    for (const child of node.emptyChildren) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(mappedLine(`${indent(depth)}}`, node.span.start));
  }
  return lines;
}

function generateSwitch(node: SwitchNode, depth: number, document: BeastDocument): GeneratedLine[] {
  const lines = [mappedLine(`${indent(depth)}@switch (${node.discriminant}) {`, node.span.start)];
  for (const branch of node.branches) {
    lines.push(
      mappedLine(
        branch.test === null
          ? `${indent(depth + 1)}@default: {`
          : `${indent(depth + 1)}@case ${branch.test}: {`,
        branch.span.start,
      ),
    );
    for (const child of branch.children) {
      lines.push(...generateNode(child, depth + 2, document));
    }
    lines.push(mappedLine(`${indent(depth + 1)}}`, branch.span.start));
  }
  lines.push(mappedLine(`${indent(depth)}}`, node.span.start));
  return lines;
}

function generateTry(node: TryNode, depth: number, document: BeastDocument): GeneratedLine[] {
  const lines = [mappedLine(`${indent(depth)}@try {`, node.span.start)];
  for (const child of node.children) {
    lines.push(...generateNode(child, depth + 1, document));
  }
  lines.push(mappedLine(`${indent(depth)}}`, node.span.start));

  if (node.pendingBranch !== null) {
    appendMapped(lines.at(-1), " @pending {", node.pendingBranch.span.start);
    for (const child of node.pendingBranch.children) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(mappedLine(`${indent(depth)}}`, node.pendingBranch.span.start));
  }

  if (node.catchBranch !== null) {
    const bindings =
      node.catchBranch.bindings === null ? "" : ` (${node.catchBranch.bindings})`;
    appendMapped(lines.at(-1), ` @catch${bindings} {`, node.catchBranch.span.start);
    for (const child of node.catchBranch.children) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(mappedLine(`${indent(depth)}}`, node.catchBranch.span.start));
  }

  return lines;
}

function generateAttributes(node: ElementNode, document: BeastDocument): GeneratedChunk {
  const output: Array<{ code: string; source: SourcePosition }> = [];

  const explicitId = node.attrs.findIndex(
    (attr) => attr.kind === "attribute" && attr.name === "id",
  );
  if (node.id !== null && explicitId !== -1) {
    codegenFailure(
      "BEAST2002_DUPLICATE_ID",
      "ID shorthand cannot be combined with an explicit id attribute.",
      node,
      document,
    );
  }
  if (node.id !== null) {
    output.push({ code: `id=${JSON.stringify(node.id)}`, source: node.span.start });
  }

  const classAttrs = node.attrs.filter(
    (attr): attr is NamedAttr =>
      attr.kind === "attribute" && (attr.name === "class" || attr.name === "className"),
  );
  if (classAttrs.length > 1) {
    codegenFailure(
      "BEAST2003_DUPLICATE_CLASS",
      "Use only one explicit class or className attribute.",
      node,
      document,
    );
  }
  const explicitClass = classAttrs[0];
  const shorthand = node.classes.join(" ");
  if (shorthand.length > 0 && explicitClass === undefined) {
    output.push({ code: `className=${JSON.stringify(shorthand)}`, source: node.span.start });
  }

  for (const attr of node.attrs) {
    if (attr.kind === "spread") {
      output.push({ code: `{...${attr.code}}`, source: attr.span.start });
    } else if (attr === explicitClass) {
      output.push({ code: generateClassAttribute(attr, shorthand), source: attr.span.start });
    } else {
      output.push({ code: generateAttribute(attr), source: attr.span.start });
    }
  }

  const mappings: GeneratedMapping[] = [];
  let column = 0;
  for (const part of output) {
    mappings.push({ column, source: part.source });
    column += part.code.length + 1;
  }
  return { code: output.map((part) => part.code).join(" "), mappings };
}

function generateClassAttribute(attr: NamedAttr, shorthand: string): string {
  if (attr.value.type === "string") {
    const combined = [shorthand, attr.value.value].filter(Boolean).join(" ");
    const serialized = JSON.stringify(combined);
    if (combined.includes('"')) return `className={${serialized}}`;
    return `className=${serialized}`;
  }
  if (attr.value.type === "expr") {
    if (shorthand.length === 0) return `className={${attr.value.code}}`;
    return `className={[${attr.value.code}, ${JSON.stringify(shorthand)}].filter(Boolean).join(" ")}`;
  }
  return shorthand.length > 0 ? `className=${JSON.stringify(shorthand)}` : "className";
}

function generateAttribute(attr: NamedAttr): string {
  const name = attr.name === "class" ? "className" : attr.name;
  switch (attr.value.type) {
    case "bool":
      return name;
    case "string": {
      const serialized = JSON.stringify(attr.value.value);
      // JSX string literals in TSRX cannot contain escaped double-quotes (\"), which
      // would be produced by JSON.stringify for values containing ". After entity
      // decoding, &quot; becomes a raw double-quote. Emit as an expression to keep
      // the TSRX valid and let Octane escape it to &quot; on the server.
      if (attr.value.value.includes('"')) return `${name}={${serialized}}`;
      return `${name}=${serialized}`;
    }
    case "expr":
      return `${name}={${attr.value.code}}`;
  }
}

function generateText(spans: TextSpan[]): string {
  return spans
    .map((span) => (span.type === "literal" ? escapeTemplateText(span.text) : `{${span.code}}`))
    .join("");
}

function escapeTemplateText(value: string): string {
  if (value.includes("<") || value.includes(">") || value.includes("{") || value.includes("}")) {
    const escaped = value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n");
    return "{'" + escaped + "'}";
  }
  return value;
}

function indent(depth: number): string {
  return "\t".repeat(depth);
}

function mappedLine(code: string, source: SourcePosition): GeneratedLine {
  const column = code.search(/\S/u);
  return {
    code,
    mappings: column === -1 ? [] : [{ column, source }],
  };
}

function unmappedLine(code: string): GeneratedLine {
  return { code, mappings: [] };
}

function mappedSourceTextLines(
  text: string,
  fragments: readonly SourceTextFragment[],
  prefix: string,
  fallback: SourcePosition,
): GeneratedLine[] {
  const lines: GeneratedLine[] = [];
  let lineStart = 0;
  for (const [lineOffset, codeLine] of text.split("\n").entries()) {
    if (codeLine.length === 0) {
      lines.push(unmappedLine(""));
      lineStart += 1;
      continue;
    }

    const lineEnd = lineStart + codeLine.length;
    const mappings: GeneratedMapping[] = [];
    for (const fragment of fragments) {
      if (fragment.start < lineStart || fragment.start >= lineEnd) continue;
      const fragmentText = text.slice(fragment.start, Math.min(fragment.end, lineEnd));
      const leading = fragmentText.match(/^\s*/u)?.[0].length ?? 0;
      if (leading >= fragmentText.length) continue;
      mappings.push({
        column: prefix.length + fragment.start - lineStart + leading,
        source: {
          offset: fragment.source.start.offset + leading,
          line: fragment.source.start.line,
          column: fragment.source.start.column + leading,
        },
      });
    }
    if (mappings.length === 0) {
      const generated = mappedLine(
        `${prefix}${codeLine}`,
        embeddedPosition(fallback, lineOffset, codeLine),
      );
      lines.push(generated);
    } else {
      mappings.sort((left, right) => left.column - right.column);
      lines.push({ code: `${prefix}${codeLine}`, mappings });
    }
    lineStart = lineEnd + 1;
  }
  return lines;
}

function embeddedPosition(
  start: SourcePosition,
  lineOffset: number,
  codeLine: string,
): SourcePosition {
  const leading = codeLine.match(/^ */u)?.[0].length ?? 0;
  return {
    offset: start.offset,
    line: start.line + lineOffset,
    column: start.column + leading,
  };
}

function appendMapped(
  line: GeneratedLine | undefined,
  suffix: string,
  source: SourcePosition,
): void {
  if (line === undefined) return;
  const column = line.code.length + (suffix.search(/\S/u) === -1 ? 0 : suffix.search(/\S/u));
  line.code += suffix;
  line.mappings.push({ column, source });
}

function generateComponentOpening(
  componentName: string,
  parameter: string,
  exportDefault: boolean,
): string[] {
  const prefix = `${exportDefault ? "export default " : ""}function ${componentName}(`;
  const inline = `${prefix}${parameter}) @{`;
  if (inline.length <= PRINT_WIDTH) return [inline];

  const formatted = formatDestructuredObjectParameter(parameter);
  if (formatted === null) return [inline];

  const lines = [`${prefix}{`];
  for (const binding of formatted.bindings) lines.push(`${indent(1)}${binding},`);
  lines.push("}: {");
  for (const member of formatted.typeMembers) {
    lines.push(...formatTypeMember(member, 1));
  }
  lines.push("}) @{");
  return lines;
}

function formatDestructuredObjectParameter(
  parameter: string,
): { bindings: string[]; typeMembers: string[] } | null {
  const colon = findTopLevelCharacter(parameter, ":");
  if (colon === -1) return null;

  const binding = parameter.slice(0, colon).trim();
  const type = parameter.slice(colon + 1).trim();
  if (!isWholeDelimitedValue(binding, "{", "}") || !isWholeDelimitedValue(type, "{", "}")) {
    return null;
  }

  const bindings = splitTopLevel(binding.slice(1, -1), ",");
  const typeMembers = splitTopLevel(type.slice(1, -1), ";");
  if (bindings.length === 0 || typeMembers.length === 0) return null;
  return { bindings, typeMembers };
}

function formatTypeMember(member: string, depth: number): string[] {
  const padding = indent(depth);
  if (`${padding}${member};`.length <= PRINT_WIDTH) return [`${padding}${member};`];

  const objectStart = findTopLevelCharacter(member, "{");
  if (objectStart === -1) return [`${padding}${member};`];
  const objectEnd = findMatchingDelimiter(member, objectStart);
  if (objectEnd === -1) return [`${padding}${member};`];

  const nestedMembers = splitTopLevel(member.slice(objectStart + 1, objectEnd), ";");
  if (nestedMembers.length === 0) return [`${padding}${member};`];

  const lines = [`${padding}${member.slice(0, objectStart + 1).trimEnd()}`];
  for (const nestedMember of nestedMembers) {
    lines.push(...formatTypeMember(nestedMember, depth + 1));
  }
  lines.push(`${padding}}${member.slice(objectEnd + 1).trim()};`);
  return lines;
}

function isWholeDelimitedValue(value: string, opening: string, closing: string): boolean {
  return (
    value.startsWith(opening) &&
    findMatchingDelimiter(value, 0) === value.length - 1 &&
    value.endsWith(closing)
  );
}

function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  scanDelimited(value, (character, index, depth) => {
    if (character === separator && depth === 0) {
      const part = value.slice(start, index).trim();
      if (part.length > 0) parts.push(part);
      start = index + 1;
    }
  });
  const finalPart = value.slice(start).trim();
  if (finalPart.length > 0) parts.push(finalPart);
  return parts;
}

function findTopLevelCharacter(value: string, target: string): number {
  let result = -1;
  scanDelimited(value, (character, index, depth) => {
    if (result === -1 && character === target && depth === 0) result = index;
  });
  return result;
}

function findMatchingDelimiter(value: string, openingIndex: number): number {
  const opening = value[openingIndex];
  if (opening !== "(" && opening !== "[" && opening !== "{") return -1;
  const expectedClosing = opening === "(" ? ")" : opening === "[" ? "]" : "}";
  let result = -1;
  scanDelimited(value.slice(openingIndex), (character, index, depth) => {
    if (result === -1 && character === expectedClosing && depth === 1) {
      result = openingIndex + index;
    }
  });
  return result;
}

function scanDelimited(
  value: string,
  visit: (character: string, index: number, depth: number) => void,
): void {
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }

    visit(character, index, stack.length);
    if (character === "(" || character === "[" || character === "{") stack.push(character);
    else if (character === ")" || character === "]" || character === "}") stack.pop();
  }
}

function codegenFailure(
  code: string,
  message: string,
  node: BeastNode,
  document: BeastDocument,
): never {
  throw new BeastCompileError({
    code,
    severity: "error",
    message,
    filename: document.filename,
    span: node.span,
  });
}
