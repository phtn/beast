import type {
  Attr,
  BeastDocument,
  BeastNode,
  EachNode,
  ElementNode,
  IfNode,
  TextSpan,
} from "./ast.js";
import { BeastCompileError } from "./diagnostics.js";

export interface GenerateOptions {
  componentName: string;
  propsParam?: string;
}

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

  const parameter = options.propsParam?.trim() ?? "";
  const lines = [`export default function ${options.componentName}(${parameter}) @{`];
  const rootNeedsFragment =
    document.children.length !== 1 || document.children[0]?.kind === "text";
  if (rootNeedsFragment) {
    lines.push("  <>");
    for (const child of document.children) lines.push(...generateNode(child, 2, document));
    lines.push("  </>");
  } else {
    const child = document.children[0];
    if (child !== undefined) lines.push(...generateNode(child, 1, document));
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
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
  return "  ".repeat(depth);
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
