import type {
  Attr,
  BeastDeclaration,
  BeastDocument,
  BeastNode,
  EachNode,
  ElementNode,
  IfBranch,
  IfNode,
  SourceSpan,
  SwitchBranch,
  SwitchNode,
  TextSpan,
  TryCatchBranch,
  TryNode,
  TryPendingBranch,
} from "./ast.js";
import { BeastCompileError } from "./diagnostics.js";

interface LogicalLine {
  content: string;
  indent: number;
  lineNo: number;
  offset: number;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

export function parse(source: string, filename = "<input>"): BeastDocument {
  const normalized = source.replace(/\r\n?/gu, "\n");
  const lines = createLogicalLines(normalized, filename);
  const parser = new Parser(lines, normalized, filename);
  return parser.parseDocument();
}

class Parser {
  private index = 0;

  constructor(
    private readonly lines: LogicalLine[],
    private readonly source: string,
    private readonly filename: string,
  ) {}

  parseDocument(): BeastDocument {
    const first = this.lines[0];
    if (first !== undefined && first.indent !== 0) {
      this.fail(
        "BEAST1001_INVALID_INDENT",
        "The first content line must start at indentation level zero.",
        first,
      );
    }

    const declarations = this.parseDeclarations();
    const children = this.lines[this.index] === undefined ? [] : this.parseBlock(0);
    const last = this.lines.at(-1);
    return {
      kind: "document",
      filename: this.filename,
      declarations,
      children,
      span: {
        start: { offset: 0, line: 1, column: 1 },
        end:
          last === undefined
            ? { offset: 0, line: 1, column: 1 }
            : {
                offset: last.offset + last.content.length,
                line: last.lineNo,
                column: last.indent + last.content.length + 1,
              },
      },
    };
  }

  private parseDeclarations(): BeastDeclaration[] {
    const declarations: BeastDeclaration[] = [];
    let sawProps = false;

    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line === undefined || line.indent !== 0) break;

      if (isImportDeclaration(line.content)) {
        if (line.content === "import") {
          this.fail(
            "BEAST1504_EMPTY_IMPORT",
            "An import declaration requires a module specifier.",
            line,
          );
        }
        declarations.push({
          kind: "import",
          code: line.content,
          lineNo: line.lineNo,
          span: lineSpan(line),
        });
        this.index += 1;
        continue;
      }

      if (isPropsDeclaration(line.content)) {
        if (sawProps) {
          this.fail(
            "BEAST1501_DUPLICATE_PROPS",
            "A BTSX component can only declare props once.",
            line,
          );
        }
        const rawParameter = line.content.slice("props".length).trim();
        const parameter = rawParameter.endsWith(";")
          ? rawParameter.slice(0, -1).trimEnd()
          : rawParameter;
        if (parameter.length === 0) {
          this.fail(
            "BEAST1502_EMPTY_PROPS",
            "A props declaration requires a typed function parameter.",
            line,
          );
        }
        declarations.push({
          kind: "props",
          parameter,
          lineNo: line.lineNo,
          span: lineSpan(line),
        });
        sawProps = true;
        this.index += 1;
        continue;
      }

      if (isSetupDeclaration(line.content)) {
        const code = line.content.slice("setup".length).trim();
        if (code.length === 0) {
          this.fail(
            "BEAST1505_EMPTY_SETUP",
            "A setup declaration requires a TypeScript statement.",
            line,
          );
        }
        declarations.push({
          kind: "setup",
          code,
          lineNo: line.lineNo,
          span: lineSpan(line),
        });
        this.index += 1;
        continue;
      }

      break;
    }

    return declarations;
  }

  private parseBlock(indent: number): BeastNode[] {
    const nodes: BeastNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index];
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) {
        this.fail(
          "BEAST1002_UNEXPECTED_INDENT",
          "This line is indented more deeply than its surrounding block permits.",
          line,
        );
      }
      nodes.push(this.parseNode(line));
    }
    return nodes;
  }

  private parseNode(line: LogicalLine): BeastNode {
    if (
      isImportDeclaration(line.content) ||
      isPropsDeclaration(line.content) ||
      isSetupDeclaration(line.content)
    ) {
      this.fail(
        "BEAST1503_MISPLACED_DECLARATION",
        "Imports, props, and setup statements must be declared before template content.",
        line,
      );
    }
    if (line.content.startsWith("if ")) return this.parseIf(line);
    if (line.content.startsWith("each ")) return this.parseEach(line);
    if (line.content === "switch" || line.content.startsWith("switch ")) {
      return this.parseSwitch(line);
    }
    if (line.content === "try" || line.content.startsWith("try ")) {
      return this.parseTry(line);
    }
    if (line.content === "empty") {
      this.fail(
        "BEAST1407_ORPHAN_EMPTY",
        "`empty` must immediately follow an each block at the same indentation.",
        line,
      );
    }
    if (line.content === "else" || line.content.startsWith("elseif ")) {
      this.fail(
        "BEAST1301_ORPHAN_BRANCH",
        `\`${line.content.split(/\s/u, 1)[0]}\` must immediately follow an if branch at the same indentation.`,
        line,
      );
    }
    if (
      line.content === "case" ||
      line.content.startsWith("case ") ||
      line.content === "default"
    ) {
      this.fail(
        "BEAST1607_ORPHAN_SWITCH_ARM",
        `\`${line.content.split(/\s/u, 1)[0]}\` must be nested directly inside a switch block.`,
        line,
      );
    }
    if (isPendingBranch(line.content) || isCatchBranch(line.content)) {
      this.fail(
        "BEAST1711_ORPHAN_TRY_BRANCH",
        `\`${line.content.split(/\s/u, 1)[0]}\` must immediately follow a try block.`,
        line,
      );
    }
    if (line.content.startsWith("|")) {
      this.index += 1;
      return {
        kind: "text",
        spans: parseTextSpans(line.content.slice(1).trimStart(), line, this.filename),
        lineNo: line.lineNo,
        span: lineSpan(line),
      };
    }
    return this.parseElement(line);
  }

  private parseIf(line: LogicalLine): IfNode {
    const test = line.content.slice(3).trim();
    if (test.length === 0) {
      this.fail("BEAST1302_EMPTY_IF", "An if branch requires a condition.", line);
    }

    const branches: IfBranch[] = [];
    this.index += 1;
    branches.push({ test, children: this.parseChildren(line.indent), span: lineSpan(line) });

    let sawElse = false;
    while (this.index < this.lines.length) {
      const branchLine = this.lines[this.index];
      if (branchLine === undefined || branchLine.indent !== line.indent) break;

      if (branchLine.content.startsWith("elseif ")) {
        if (sawElse) {
          this.fail(
            "BEAST1303_BRANCH_AFTER_ELSE",
            "An elseif branch cannot follow else.",
            branchLine,
          );
        }
        const branchTest = branchLine.content.slice("elseif ".length).trim();
        if (branchTest.length === 0) {
          this.fail("BEAST1304_EMPTY_ELSEIF", "An elseif branch requires a condition.", branchLine);
        }
        this.index += 1;
        branches.push({
          test: branchTest,
          children: this.parseChildren(branchLine.indent),
          span: lineSpan(branchLine),
        });
        continue;
      }

      if (branchLine.content === "else") {
        if (sawElse) {
          this.fail("BEAST1305_DUPLICATE_ELSE", "An if chain can only contain one else branch.", branchLine);
        }
        sawElse = true;
        this.index += 1;
        branches.push({
          test: null,
          children: this.parseChildren(branchLine.indent),
          span: lineSpan(branchLine),
        });
        continue;
      }
      break;
    }

    return {
      kind: "if",
      branches,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseEach(line: LogicalLine): EachNode {
    const header = line.content.slice("each ".length).trim();
    const inIndex = findTopLevelSequence(header, " in ");
    if (inIndex === -1) {
      this.fail(
        "BEAST1401_INVALID_EACH",
        "Expected `each item[, index] in iterable`.",
        line,
      );
    }

    const bindingText = header.slice(0, inIndex).trim();
    let iterableAndKey = header.slice(inIndex + 4).trim();
    const keyIndex = findTopLevelSequence(iterableAndKey, " key ");
    const explicitKey = keyIndex === -1 ? null : iterableAndKey.slice(keyIndex + 5).trim();
    if (keyIndex !== -1) iterableAndKey = iterableAndKey.slice(0, keyIndex).trim();

    const bindings = bindingText.split(",").map((part) => part.trim());
    const itemName = bindings[0] ?? "";
    const indexName = bindings[1] ?? null;
    if (
      bindings.length > 2 ||
      !IDENTIFIER.test(itemName) ||
      (indexName !== null && !IDENTIFIER.test(indexName))
    ) {
      this.fail(
        "BEAST1402_INVALID_EACH_BINDING",
        "Loop bindings must be one or two valid TypeScript identifiers.",
        line,
      );
    }
    if (iterableAndKey.length === 0) {
      this.fail("BEAST1403_EMPTY_ITERABLE", "An each loop requires an iterable expression.", line);
    }
    if (explicitKey !== null && explicitKey.length === 0) {
      this.fail("BEAST1404_EMPTY_KEY", "A loop key requires an expression.", line);
    }

    this.index += 1;
    const children = this.parseChildren(line.indent);
    const hoistedKey = extractSingleRootKey(children, line, this.filename);
    if (explicitKey !== null && hoistedKey !== null) {
      this.fail(
        "BEAST1405_DUPLICATE_KEY",
        "Specify the loop key either in the each header or on its single root element, not both.",
        line,
      );
    }

    let emptyChildren: BeastNode[] | null = null;
    const emptyLine = this.lines[this.index];
    if (emptyLine?.indent === line.indent && emptyLine.content === "empty") {
      this.index += 1;
      emptyChildren = this.parseChildren(emptyLine.indent);
      if (emptyChildren.length === 0) {
        this.fail(
          "BEAST1408_EMPTY_EMPTY_BRANCH",
          "An empty branch requires at least one template node.",
          emptyLine,
        );
      }
    }

    return {
      kind: "each",
      itemName,
      indexName,
      iterable: iterableAndKey,
      key: explicitKey ?? hoistedKey,
      children,
      emptyChildren,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseSwitch(line: LogicalLine): SwitchNode {
    const discriminant = line.content.slice("switch".length).trim();
    if (discriminant.length === 0) {
      this.fail("BEAST1601_EMPTY_SWITCH", "A switch block requires an expression.", line);
    }

    this.index += 1;
    const firstArm = this.lines[this.index];
    if (firstArm === undefined || firstArm.indent <= line.indent) {
      this.fail(
        "BEAST1602_EMPTY_SWITCH_BODY",
        "A switch block requires at least one indented case or default arm.",
        line,
      );
    }

    const armIndent = firstArm.indent;
    const branches: SwitchBranch[] = [];
    let sawDefault = false;

    while (this.index < this.lines.length) {
      const armLine = this.lines[this.index];
      if (armLine === undefined || armLine.indent < armIndent) break;
      if (armLine.indent > armIndent) {
        this.fail(
          "BEAST1002_UNEXPECTED_INDENT",
          "This line is indented more deeply than its surrounding switch block permits.",
          armLine,
        );
      }

      let test: string | null;
      if (armLine.content === "case" || armLine.content.startsWith("case ")) {
        test = armLine.content.slice("case".length).trim();
        if (test.length === 0) {
          this.fail("BEAST1604_EMPTY_CASE", "A case arm requires an expression.", armLine);
        }
      } else if (armLine.content === "default") {
        if (sawDefault) {
          this.fail(
            "BEAST1605_DUPLICATE_DEFAULT",
            "A switch block can only contain one default arm.",
            armLine,
          );
        }
        sawDefault = true;
        test = null;
      } else {
        this.fail(
          "BEAST1603_INVALID_SWITCH_ARM",
          "Only case and default arms may appear directly inside a switch block.",
          armLine,
        );
      }

      this.index += 1;
      const children = this.parseChildren(armLine.indent);
      if (children.length === 0) {
        this.fail(
          "BEAST1606_EMPTY_SWITCH_ARM",
          "A case or default arm requires at least one template node.",
          armLine,
        );
      }
      branches.push({ test, children, span: lineSpan(armLine) });
    }

    return {
      kind: "switch",
      discriminant,
      branches,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseTry(line: LogicalLine): TryNode {
    if (line.content !== "try") {
      this.fail("BEAST1701_INVALID_TRY_HEADER", "A try block does not accept a header expression.", line);
    }

    this.index += 1;
    const children = this.parseChildren(line.indent);
    if (children.length === 0) {
      this.fail(
        "BEAST1702_EMPTY_TRY_BODY",
        "A try block requires at least one template node.",
        line,
      );
    }

    let pendingBranch: TryPendingBranch | null = null;
    let catchBranch: TryCatchBranch | null = null;
    let branchLine = this.lines[this.index];

    if (branchLine?.indent === line.indent && isPendingBranch(branchLine.content)) {
      if (branchLine.content !== "pending") {
        this.fail(
          "BEAST1704_INVALID_PENDING_HEADER",
          "A pending branch does not accept bindings or an expression.",
          branchLine,
        );
      }
      this.index += 1;
      const pendingChildren = this.parseChildren(branchLine.indent);
      if (pendingChildren.length === 0) {
        this.fail(
          "BEAST1705_EMPTY_PENDING_BRANCH",
          "A pending branch requires at least one template node.",
          branchLine,
        );
      }
      pendingBranch = { children: pendingChildren, span: lineSpan(branchLine) };
      branchLine = this.lines[this.index];
    }

    if (branchLine?.indent === line.indent && isCatchBranch(branchLine.content)) {
      const bindings = this.parseCatchBindings(branchLine);
      this.index += 1;
      const catchChildren = this.parseChildren(branchLine.indent);
      if (catchChildren.length === 0) {
        this.fail(
          "BEAST1707_EMPTY_CATCH_BRANCH",
          "A catch branch requires at least one template node.",
          branchLine,
        );
      }
      catchBranch = {
        bindings,
        children: catchChildren,
        span: lineSpan(branchLine),
      };
    }

    const trailingBranch = this.lines[this.index];
    if (trailingBranch?.indent === line.indent) {
      if (isPendingBranch(trailingBranch.content)) {
        if (catchBranch !== null) {
          this.fail(
            "BEAST1708_PENDING_AFTER_CATCH",
            "A pending branch must appear before the catch branch.",
            trailingBranch,
          );
        }
        this.fail(
          "BEAST1709_DUPLICATE_PENDING",
          "A try block can only contain one pending branch.",
          trailingBranch,
        );
      }
      if (isCatchBranch(trailingBranch.content)) {
        this.fail(
          "BEAST1710_DUPLICATE_CATCH",
          "A try block can only contain one catch branch.",
          trailingBranch,
        );
      }
    }

    if (pendingBranch === null && catchBranch === null) {
      this.fail(
        "BEAST1703_MISSING_TRY_BRANCH",
        "A try block requires a pending branch, a catch branch, or both.",
        line,
      );
    }

    return {
      kind: "try",
      children,
      pendingBranch,
      catchBranch,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseCatchBindings(line: LogicalLine): string | null {
    let bindings = line.content.slice("catch".length).trim();
    if (bindings.length === 0) return null;
    if (!bindings.startsWith("(")) return bindings;

    const close = findMatchingDelimiter(bindings, 0);
    if (close !== bindings.length - 1) {
      this.fail(
        "BEAST1706_INVALID_CATCH_BINDINGS",
        "Catch bindings must be written after catch, with optional balanced parentheses.",
        line,
      );
    }
    bindings = bindings.slice(1, -1).trim();
    if (bindings.length === 0) {
      this.fail(
        "BEAST1706_INVALID_CATCH_BINDINGS",
        "Use `catch` without empty parentheses when no bindings are needed.",
        line,
      );
    }
    return bindings;
  }

  private parseElement(line: LogicalLine): ElementNode {
    const selectorEnd = findSelectorEnd(line.content);
    const selector = line.content.slice(0, selectorEnd);
    if (selector.length === 0) {
      this.fail("BEAST1101_INVALID_SELECTOR", "Expected an element selector.", line);
    }

    let cursor = selectorEnd;
    let attrs: Attr[] = [];
    if (line.content[cursor] === "(") {
      const close = findMatchingDelimiter(line.content, cursor);
      if (close === -1) {
        this.fail(
          "BEAST1201_UNCLOSED_ATTRIBUTES",
          "The element attribute list is missing a closing parenthesis.",
          line,
        );
      }
      attrs = parseAttributes(
        line.content.slice(cursor + 1, close),
        line,
        cursor + 1,
        this.filename,
      );
      cursor = close + 1;
    }

    const trailing = line.content.slice(cursor);
    if (trailing.length > 0 && !/^\s/u.test(trailing)) {
      this.fail(
        "BEAST1102_INVALID_ELEMENT",
        "Unexpected characters after the element selector.",
        line,
      );
    }
    const inlineText = trailing.trimStart();
    const parsedSelector = parseSelector(selector, line, this.filename);

    this.index += 1;
    return {
      kind: "element",
      ...parsedSelector,
      attrs,
      inlineSpans:
        inlineText.length === 0 ? null : parseTextSpans(inlineText, line, this.filename),
      children: this.parseChildren(line.indent),
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseChildren(parentIndent: number): BeastNode[] {
    const next = this.lines[this.index];
    if (next === undefined || next.indent <= parentIndent) return [];
    return this.parseBlock(next.indent);
  }

  private fail(code: string, message: string, line: LogicalLine): never {
    throw new BeastCompileError({
      code,
      severity: "error",
      message,
      filename: this.filename,
      span: lineSpan(line),
    });
  }
}

function isImportDeclaration(content: string): boolean {
  return content === "import" || /^import\s/u.test(content);
}

function isPropsDeclaration(content: string): boolean {
  return content === "props" || /^props\s/u.test(content);
}

function isSetupDeclaration(content: string): boolean {
  return content === "setup" || /^setup\s/u.test(content);
}

function isPendingBranch(content: string): boolean {
  return content === "pending" || content.startsWith("pending ") || content.startsWith("pending(");
}

function isCatchBranch(content: string): boolean {
  return content === "catch" || content.startsWith("catch ") || content.startsWith("catch(");
}

function createLogicalLines(source: string, filename: string): LogicalLine[] {
  const result: LogicalLine[] = [];
  let offset = 0;
  const physicalLines = source.split("\n");
  for (let index = 0; index < physicalLines.length; index += 1) {
    const raw = physicalLines[index] ?? "";
    const leading = raw.match(/^[ \t]*/u)?.[0] ?? "";
    if (leading.includes("\t")) {
      const span = spanAt(offset, index + 1, 1, Math.max(1, leading.length));
      throw new BeastCompileError({
        code: "BEAST1003_TAB_INDENT",
        severity: "error",
        message: "Tabs are not allowed in indentation; use spaces consistently.",
        filename,
        span,
      });
    }
    const content = raw.slice(leading.length).trimEnd();
    if (content.length > 0 && !content.startsWith("//")) {
      result.push({
        content,
        indent: leading.length,
        lineNo: index + 1,
        offset: offset + leading.length,
      });
    }
    offset += raw.length + 1;
  }
  return result;
}

function findSelectorEnd(content: string): number {
  let index = 0;
  while (index < content.length && !/\s|\(/u.test(content[index] ?? "")) index += 1;
  return index;
}

function parseSelector(
  selector: string,
  line: LogicalLine,
  filename: string,
): Pick<ElementNode, "tag" | "isComponent" | "classes" | "id"> {
  let cursor = 0;
  let tag = "div";
  if (selector[0] !== "." && selector[0] !== "#") {
    const match = selector.match(/^[A-Za-z][A-Za-z0-9_$:-]*/u);
    if (match === null) selectorFailure(selector, line, filename);
    tag = match[0];
    cursor = tag.length;

    if (/^[A-Z]/u.test(tag)) {
      while (selector[cursor] === ".") {
        const member = selector.slice(cursor + 1).match(/^[A-Z_$][A-Za-z0-9_$]*/u);
        if (member === null) break;
        tag += `.${member[0]}`;
        cursor += member[0].length + 1;
      }
    }
  }

  const classes: string[] = [];
  let id: string | null = null;
  while (cursor < selector.length) {
    const prefix = selector[cursor];
    if (prefix !== "." && prefix !== "#") selectorFailure(selector, line, filename);
    cursor += 1;
    const match = selector.slice(cursor).match(/^[A-Za-z0-9_-]+/u);
    if (match === null) selectorFailure(selector, line, filename);
    const value = match[0];
    cursor += value.length;
    if (prefix === ".") {
      classes.push(value);
    } else {
      if (id !== null) {
        throw new BeastCompileError({
          code: "BEAST1103_DUPLICATE_ID",
          severity: "error",
          message: "An element selector can only contain one ID shorthand.",
          filename,
          span: lineSpan(line),
        });
      }
      id = value;
    }
  }

  return { tag, isComponent: /^[A-Z]/u.test(tag), classes, id };
}

function selectorFailure(selector: string, line: LogicalLine, filename: string): never {
  throw new BeastCompileError({
    code: "BEAST1101_INVALID_SELECTOR",
    severity: "error",
    message: `Invalid element selector \`${selector}\`.`,
    filename,
    span: lineSpan(line),
  });
}

function parseAttributes(
  input: string,
  line: LogicalLine,
  columnOffset: number,
  filename: string,
): Attr[] {
  const attrs: Attr[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && /[\s,]/u.test(input[cursor] ?? "")) cursor += 1;
    if (cursor >= input.length) break;
    const start = cursor;
    const nameMatch = input.slice(cursor).match(/^[A-Za-z_$][A-Za-z0-9_$:-]*/u);
    if (nameMatch === null) attributeFailure("Expected an attribute name.", line, filename);
    const name = nameMatch[0];
    cursor += name.length;
    while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) cursor += 1;

    if (input[cursor] !== "=") {
      attrs.push({
        name,
        value: { type: "bool" },
        span: attributeSpan(line, columnOffset + start, columnOffset + cursor),
      });
      continue;
    }

    cursor += 1;
    while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) cursor += 1;
    const valueStart = cursor;
    const opening = input[cursor];
    if (opening === '"' || opening === "'") {
      cursor += 1;
      let value = "";
      let closed = false;
      while (cursor < input.length) {
        const char = input[cursor] ?? "";
        if (char === "\\" && cursor + 1 < input.length) {
          value += char + (input[cursor + 1] ?? "");
          cursor += 2;
          continue;
        }
        if (char === opening) {
          cursor += 1;
          closed = true;
          break;
        }
        value += char;
        cursor += 1;
      }
      if (!closed) attributeFailure(`Unclosed string value for attribute \`${name}\`.`, line, filename);
      attrs.push({
        name,
        value: { type: "string", value },
        span: attributeSpan(line, columnOffset + start, columnOffset + cursor),
      });
      continue;
    }

    if (opening === "{") {
      const close = findMatchingDelimiter(input, cursor);
      if (close === -1) attributeFailure(`Unclosed expression for attribute \`${name}\`.`, line, filename);
      const code = input.slice(cursor + 1, close).trim();
      if (code.length === 0) attributeFailure(`Attribute \`${name}\` has an empty expression.`, line, filename);
      cursor = close + 1;
      attrs.push({
        name,
        value: { type: "expr", code },
        span: attributeSpan(line, columnOffset + start, columnOffset + cursor),
      });
      continue;
    }

    attributeFailure(
      `Attribute \`${name}\` must use a quoted string or a braced expression.`,
      line,
      filename,
      valueStart,
    );
  }
  return attrs;
}

function attributeFailure(
  message: string,
  line: LogicalLine,
  filename: string,
  relativeColumn = 0,
): never {
  throw new BeastCompileError({
    code: "BEAST1202_INVALID_ATTRIBUTE",
    severity: "error",
    message,
    filename,
    span: attributeSpan(line, relativeColumn, relativeColumn + 1),
  });
}

function parseTextSpans(text: string, line: LogicalLine, filename: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const opening = text.indexOf("#{", cursor);
    if (opening === -1) {
      if (cursor < text.length) spans.push({ type: "literal", text: text.slice(cursor) });
      break;
    }
    if (opening > cursor) spans.push({ type: "literal", text: text.slice(cursor, opening) });
    const close = findMatchingDelimiter(text, opening + 1);
    if (close === -1) {
      throw new BeastCompileError({
        code: "BEAST1203_UNCLOSED_INTERPOLATION",
        severity: "error",
        message: "Text interpolation is missing a closing brace.",
        filename,
        span: lineSpan(line),
      });
    }
    const code = text.slice(opening + 2, close).trim();
    if (code.length === 0) {
      throw new BeastCompileError({
        code: "BEAST1204_EMPTY_INTERPOLATION",
        severity: "error",
        message: "Text interpolation requires an expression.",
        filename,
        span: lineSpan(line),
      });
    }
    spans.push({ type: "expr", code });
    cursor = close + 1;
  }
  return spans;
}

function findMatchingDelimiter(input: string, openingIndex: number): number {
  const opening = input[openingIndex];
  if (opening !== "(" && opening !== "{" && opening !== "[") return -1;
  const stack = [opening];
  let quote: string | null = null;
  let escaped = false;
  for (let index = openingIndex + 1; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      const expected = char === ")" ? "(" : char === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function findTopLevelSequence(input: string, sequence: string): number {
  const stack: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index <= input.length - sequence.length; index += 1) {
    const char = input[index] ?? "";
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") stack.push(char);
    else if (char === ")" || char === "}" || char === "]") stack.pop();
    else if (stack.length === 0 && input.startsWith(sequence, index)) return index;
  }
  return -1;
}

function extractSingleRootKey(
  children: BeastNode[],
  line: LogicalLine,
  filename: string,
): string | null {
  if (children.length !== 1 || children[0]?.kind !== "element") return null;
  const element = children[0];
  const keyIndex = element.attrs.findIndex((attr) => attr.name === "key");
  if (keyIndex === -1) return null;
  const key = element.attrs[keyIndex];
  if (key === undefined || key.value.type === "bool") {
    throw new BeastCompileError({
      code: "BEAST1406_INVALID_KEY",
      severity: "error",
      message: "A loop key must have a string or expression value.",
      filename,
      span: lineSpan(line),
    });
  }
  element.attrs.splice(keyIndex, 1);
  return key.value.type === "string" ? JSON.stringify(key.value.value) : key.value.code;
}

function lineSpan(line: LogicalLine): SourceSpan {
  return spanAt(line.offset, line.lineNo, line.indent + 1, Math.max(1, line.content.length));
}

function attributeSpan(line: LogicalLine, start: number, end: number): SourceSpan {
  return spanAt(
    line.offset + start,
    line.lineNo,
    line.indent + start + 1,
    Math.max(1, end - start),
  );
}

function spanAt(offset: number, line: number, column: number, width: number): SourceSpan {
  return {
    start: { offset, line, column },
    end: { offset: offset + width, line, column: column + width },
  };
}
