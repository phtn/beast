import type {
  Attr,
  BeastDocument,
  BeastNode,
  ComponentDeclaration,
  EachNode,
  ElementNode,
  IfNode,
  SwitchNode,
  SetupDeclaration,
  TextSpan,
  TryNode,
} from "./ast.js";
import { BeastCompileError } from "./diagnostics.js";

export interface GenerateOptions {
  componentName: string;
  propsParam?: string;
}

const PRINT_WIDTH = 80;

export function generateTsrx(document: BeastDocument, options: GenerateOptions): string {
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
  const lines: string[] = [];
  for (const declaration of document.declarations) {
    if (declaration.kind === "import" || declaration.kind === "module") {
      lines.push(...declaration.code.split("\n"));
    }
  }
  if (lines.length > 0) lines.push("");

  for (const component of localComponents) {
    lines.push(
      ...generateComponent(
        component.name,
        component.props?.parameter ?? "",
        component.setup,
        component.children,
        false,
        document,
      ),
    );
    lines.push("");
  }

  lines.push(
    ...generateComponent(
      options.componentName,
      parameter,
      setup,
      document.children,
      true,
      document,
    ),
  );
  return `${lines.join("\n")}\n`;
}

function generateComponent(
  componentName: string,
  parameter: string,
  setup: readonly SetupDeclaration[],
  children: readonly BeastNode[],
  exportDefault: boolean,
  document: BeastDocument,
): string[] {
  const lines = generateComponentOpening(componentName, parameter, exportDefault);
  if (setup.length > 0) {
    for (const declaration of setup) {
      for (const codeLine of declaration.code.split("\n")) {
        lines.push(codeLine.length === 0 ? "" : `${indent(1)}${codeLine}`);
      }
    }
    lines.push("");
  }
  const rootNeedsFragment =
    children.length !== 1 || children[0]?.kind === "text";
  if (rootNeedsFragment) {
    lines.push(`${indent(1)}<>`);
    for (const child of children) lines.push(...generateNode(child, 2, document));
    lines.push(`${indent(1)}</>`);
  } else {
    const child = children[0];
    if (child !== undefined) lines.push(...generateNode(child, 1, document));
  }
  lines.push("}");
  return lines;
}

function generateNode(node: BeastNode, depth: number, document: BeastDocument): string[] {
  switch (node.kind) {
    case "element":
      return generateElement(node, depth, document);
    case "text":
      return [`${indent(depth)}${generateText(node.spans)}`];
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

function generateElement(
  node: ElementNode,
  depth: number,
  document: BeastDocument,
): string[] {
  const padding = indent(depth);
  const attributes = generateAttributes(node, document);
  const opening = `<${node.tag}${attributes.length === 0 ? "" : ` ${attributes}`}`;
  const inline = node.inlineSpans === null ? "" : generateText(node.inlineSpans);

  if (node.children.length === 0 && inline.length === 0) {
    return [`${padding}${opening} />`];
  }
  if (node.children.length === 0) {
    return [`${padding}${opening}>${inline}</${node.tag}>`];
  }

  const lines = [`${padding}${opening}>`];
  if (inline.length > 0) lines.push(`${indent(depth + 1)}${inline}`);
  for (const child of node.children) lines.push(...generateNode(child, depth + 1, document));
  lines.push(`${padding}</${node.tag}>`);
  return lines;
}

function generateIf(node: IfNode, depth: number, document: BeastDocument): string[] {
  const lines: string[] = [];
  for (let index = 0; index < node.branches.length; index += 1) {
    const branch = node.branches[index];
    if (branch === undefined) continue;
    if (index === 0) {
      lines.push(`${indent(depth)}@if (${branch.test}) {`);
    } else if (branch.test === null) {
      lines[lines.length - 1] = `${lines.at(-1)} @else {`;
    } else {
      lines[lines.length - 1] = `${lines.at(-1)} @else if (${branch.test}) {`;
    }
    for (const child of branch.children) lines.push(...generateNode(child, depth + 1, document));
    lines.push(`${indent(depth)}}`);
  }
  return lines;
}

function generateEach(node: EachNode, depth: number, document: BeastDocument): string[] {
  const options = [
    node.indexName === null ? "" : `; index ${node.indexName}`,
    node.key === null ? "" : `; key ${node.key}`,
  ].join("");
  const lines = [
    `${indent(depth)}@for (const ${node.itemName} of ${node.iterable}${options}) {`,
  ];
  for (const child of node.children) lines.push(...generateNode(child, depth + 1, document));
  lines.push(`${indent(depth)}}`);
  if (node.emptyChildren !== null) {
    lines[lines.length - 1] = `${lines.at(-1)} @empty {`;
    for (const child of node.emptyChildren) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(`${indent(depth)}}`);
  }
  return lines;
}

function generateSwitch(node: SwitchNode, depth: number, document: BeastDocument): string[] {
  const lines = [`${indent(depth)}@switch (${node.discriminant}) {`];
  for (const branch of node.branches) {
    lines.push(
      branch.test === null
        ? `${indent(depth + 1)}@default: {`
        : `${indent(depth + 1)}@case ${branch.test}: {`,
    );
    for (const child of branch.children) {
      lines.push(...generateNode(child, depth + 2, document));
    }
    lines.push(`${indent(depth + 1)}}`);
  }
  lines.push(`${indent(depth)}}`);
  return lines;
}

function generateTry(node: TryNode, depth: number, document: BeastDocument): string[] {
  const lines = [`${indent(depth)}@try {`];
  for (const child of node.children) {
    lines.push(...generateNode(child, depth + 1, document));
  }
  lines.push(`${indent(depth)}}`);

  if (node.pendingBranch !== null) {
    lines[lines.length - 1] = `${lines.at(-1)} @pending {`;
    for (const child of node.pendingBranch.children) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(`${indent(depth)}}`);
  }

  if (node.catchBranch !== null) {
    const bindings =
      node.catchBranch.bindings === null ? "" : ` (${node.catchBranch.bindings})`;
    lines[lines.length - 1] = `${lines.at(-1)} @catch${bindings} {`;
    for (const child of node.catchBranch.children) {
      lines.push(...generateNode(child, depth + 1, document));
    }
    lines.push(`${indent(depth)}}`);
  }

  return lines;
}

function generateAttributes(node: ElementNode, document: BeastDocument): string {
  const attrs = [...node.attrs];
  const output: string[] = [];

  const explicitId = attrs.findIndex((attr) => attr.name === "id");
  if (node.id !== null && explicitId !== -1) {
    codegenFailure(
      "BEAST2002_DUPLICATE_ID",
      "ID shorthand cannot be combined with an explicit id attribute.",
      node,
      document,
    );
  }
  if (node.id !== null) output.push(`id=${JSON.stringify(node.id)}`);

  const classIndexes = attrs
    .map((attr, index) => ({ attr, index }))
    .filter(({ attr }) => attr.name === "class" || attr.name === "className");
  if (classIndexes.length > 1) {
    codegenFailure(
      "BEAST2003_DUPLICATE_CLASS",
      "Use only one explicit class or className attribute.",
      node,
      document,
    );
  }
  const explicitClass = classIndexes[0];
  if (explicitClass !== undefined) attrs.splice(explicitClass.index, 1);
  if (node.classes.length > 0 || explicitClass !== undefined) {
    const shorthand = node.classes.join(" ");
    if (explicitClass === undefined) {
      output.push(`className=${JSON.stringify(shorthand)}`);
    } else if (explicitClass.attr.value.type === "string") {
      const combined = [shorthand, explicitClass.attr.value.value].filter(Boolean).join(" ");
      output.push(`className=${JSON.stringify(combined)}`);
    } else if (explicitClass.attr.value.type === "expr") {
      if (shorthand.length === 0) {
        output.push(`className={${explicitClass.attr.value.code}}`);
      } else {
        output.push(
          `className={[${explicitClass.attr.value.code}, ${JSON.stringify(shorthand)}].filter(Boolean).join(" ")}`,
        );
      }
    } else if (shorthand.length > 0) {
      output.push(`className=${JSON.stringify(shorthand)}`);
    } else {
      output.push("className");
    }
  }

  for (const attr of attrs) output.push(generateAttribute(attr));
  return output.join(" ");
}

function generateAttribute(attr: Attr): string {
  const name = attr.name === "class" ? "className" : attr.name;
  switch (attr.value.type) {
    case "bool":
      return name;
    case "string":
      return `${name}=${JSON.stringify(attr.value.value)}`;
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
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");
}

function indent(depth: number): string {
  return "\t".repeat(depth);
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
