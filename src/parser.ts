import type {
  Attr,
  BeastDeclaration,
  BeastDocument,
  BeastNode,
  ComponentDeclaration,
  EachNode,
  ElementNode,
  FragmentNode,
  IfBranch,
  IfNode,
  PropsDeclaration,
  SetupDeclaration,
  SourcePosition,
  SourceSpan,
  SourceTextFragment,
  StyleNode,
  SwitchBranch,
  SwitchNode,
  TextSpan,
  TryCatchBranch,
  TryNode,
  TryPendingBranch,
} from "./ast.js";
import { decodeHTML } from "entities";
import { BeastCompileError } from "./diagnostics.js";

interface LogicalLine {
  content: string;
  fragments: LogicalLineFragment[];
  indent: number;
  lineNo: number;
  offset: number;
}

interface LogicalLineFragment {
  logicalStart: number;
  logicalEnd: number;
  source: SourceSpan;
}

interface SourceBlockResult {
  code: string;
  fragments: SourceTextFragment[];
  start: SourcePosition;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const COMPONENT_IDENTIFIER = /^[A-Z_$][A-Za-z0-9_$]*$/u;

export function parse(source: string, filename = "<input>"): BeastDocument {
  const normalized = source.replace(/\r\n?/gu, "\n");
  const lines = createLogicalLines(normalized, filename);
  const parser = new Parser(lines, normalized, filename);
  return parser.parseDocument();
}

class Parser {
  private index = 0;
  private readonly physicalLines: string[];
  private readonly physicalLineOffsets: number[];

  constructor(
    private readonly lines: LogicalLine[],
    source: string,
    private readonly filename: string,
  ) {
    this.physicalLines = source.split("\n");
    this.physicalLineOffsets = [];
    let offset = 0;
    for (const physicalLine of this.physicalLines) {
      this.physicalLineOffsets.push(offset);
      offset += physicalLine.length + 1;
    }
  }

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
            : lineSpan(last).end,
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
          codeFragments: sourceTextFragments(line, 0, line.content.length),
          lineNo: line.lineNo,
          span: lineSpan(line),
        });
        this.index += 1;
        continue;
      }

      if (isComponentDeclaration(line.content)) {
        declarations.push(this.parseComponentDeclaration(line));
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
        declarations.push(this.parsePropsDeclaration(line));
        sawProps = true;
        continue;
      }

      if (isSetupDeclaration(line.content)) {
        declarations.push(this.parseSetupDeclaration(line));
        continue;
      }

      if (isModuleDeclaration(line.content)) {
        const source =
          line.content === "module"
            ? this.parseSourceBlock(
                line,
                "BEAST1506_EMPTY_MODULE",
                "A module block requires indented TypeScript source.",
              )
            : inlineSource(line, "module");
        declarations.push({
          kind: "module",
          code: source.code,
          codeStart: source.start,
          codeFragments: source.fragments,
          lineNo: line.lineNo,
          span: lineSpan(line),
        });
        if (line.content !== "module") this.index += 1;
        continue;
      }

      break;
    }

    return declarations;
  }

  private parseComponentDeclaration(line: LogicalLine): ComponentDeclaration {
    const name = line.content.slice("component".length).trim();
    if (!COMPONENT_IDENTIFIER.test(name)) {
      this.fail(
        "BEAST1801_INVALID_COMPONENT_NAME",
        "A local component requires a single PascalCase TypeScript identifier.",
        line,
      );
    }

    this.index += 1;
    const firstBodyLine = this.lines[this.index];
    if (firstBodyLine === undefined || firstBodyLine.indent <= line.indent) {
      this.fail(
        "BEAST1802_EMPTY_COMPONENT",
        "A local component requires an indented body.",
        line,
      );
    }

    const bodyIndent = firstBodyLine.indent;
    let props: PropsDeclaration | null = null;
    const setup: SetupDeclaration[] = [];

    while (this.index < this.lines.length) {
      const declarationLine = this.lines[this.index];
      if (declarationLine === undefined || declarationLine.indent !== bodyIndent) break;

      if (isPropsDeclaration(declarationLine.content)) {
        if (props !== null) {
          this.fail(
            "BEAST1501_DUPLICATE_PROPS",
            "A component can only declare props once.",
            declarationLine,
          );
        }
        props = this.parsePropsDeclaration(declarationLine);
        continue;
      }

      if (isSetupDeclaration(declarationLine.content)) {
        setup.push(this.parseSetupDeclaration(declarationLine));
        continue;
      }

      break;
    }

    const nextLine = this.lines[this.index];
    const children =
      nextLine !== undefined && nextLine.indent > line.indent
        ? this.parseBlock(bodyIndent)
        : [];
    if (children.length === 0) {
      this.fail(
        "BEAST1803_EMPTY_COMPONENT_TEMPLATE",
        "A local component requires at least one template node after its declarations.",
        line,
      );
    }

    return {
      kind: "component",
      name,
      props,
      setup,
      children,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parsePropsDeclaration(line: LogicalLine): PropsDeclaration {
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
    const parameterStart = line.content.indexOf(parameter, "props".length);
    this.index += 1;
    return {
      kind: "props",
      parameter,
      parameterFragments: sourceTextFragments(
        line,
        parameterStart,
        parameterStart + parameter.length,
      ),
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseSetupDeclaration(line: LogicalLine): SetupDeclaration {
    const source =
      line.content === "setup"
        ? this.parseSourceBlock(
            line,
            "BEAST1505_EMPTY_SETUP",
            "A setup block requires indented TypeScript source.",
          )
        : inlineSource(line, "setup");
    if (line.content !== "setup") this.index += 1;
    return {
      kind: "setup",
      code: source.code,
      codeStart: source.start,
      codeFragments: source.fragments,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseSourceBlock(
    line: LogicalLine,
    code: string,
    message: string,
  ): SourceBlockResult {
    const blockLines: Array<{ raw: string; lineIndex: number }> = [];
    let physicalIndex = line.lineNo;

    while (physicalIndex < this.physicalLines.length) {
      const raw = this.physicalLines[physicalIndex] ?? "";
      if (raw.trim().length === 0) {
        blockLines.push({ raw: "", lineIndex: physicalIndex });
        physicalIndex += 1;
        continue;
      }

      const leading = raw.match(/^ */u)?.[0].length ?? 0;
      if (leading <= line.indent) break;
      blockLines.push({ raw: raw.trimEnd(), lineIndex: physicalIndex });
      physicalIndex += 1;
    }

    while (blockLines[0]?.raw === "") blockLines.shift();
    while (blockLines.at(-1)?.raw === "") blockLines.pop();
    if (blockLines.length === 0) this.fail(code, message, line);

    const authoredLines = blockLines.filter((blockLine) => {
      if (blockLine.raw.length === 0) return false;
      const leading = blockLine.raw.match(/^ */u)?.[0].length ?? 0;
      return !blockLine.raw.slice(leading).startsWith("~");
    });
    if (authoredLines.length === 0) this.fail(code, message, line);
    const sourceIndent = Math.min(
      ...authoredLines.map(
        (blockLine) => blockLine.raw.match(/^ */u)?.[0].length ?? 0,
      ),
    );

    interface NormalizedBlockLine {
      code: string;
      fragments: SourceTextFragment[];
    }
    const normalized: NormalizedBlockLine[] = [];
    let previousCodeLine: NormalizedBlockLine | undefined;
    for (const blockLine of blockLines) {
      if (blockLine.raw.length === 0) {
        normalized.push({ code: "", fragments: [] });
        continue;
      }

      const leading = blockLine.raw.match(/^ */u)?.[0].length ?? 0;
      const content = blockLine.raw.slice(leading);
      if (content.startsWith("~")) {
        const continuation = continuationPayload(content);
        if (
          continuation === null ||
          continuation.text.startsWith("//")
        ) {
          continue;
        }
        if (previousCodeLine === undefined) {
          throw new BeastCompileError({
            code: "BEAST1004_ORPHAN_CONTINUATION",
            severity: "error",
            message: "A continuation line starting with `~` must follow authored source.",
            filename: this.filename,
            span: spanAt(
              (this.physicalLineOffsets[blockLine.lineIndex] ?? 0) + leading,
              blockLine.lineIndex + 1,
              leading + 1,
              Math.max(1, content.length),
            ),
          });
        }
        const fragmentStart = previousCodeLine.code.length + 1;
        previousCodeLine.code += ` ${continuation.text}`;
        previousCodeLine.fragments.push({
          start: fragmentStart,
          end: fragmentStart + continuation.text.length,
          source: spanAt(
            (this.physicalLineOffsets[blockLine.lineIndex] ?? 0) +
              leading +
              continuation.sourceStart,
            blockLine.lineIndex + 1,
            leading + continuation.sourceStart + 1,
            continuation.text.length,
          ),
        });
        continue;
      }

      const blockCode = blockLine.raw.slice(sourceIndent);
      const normalizedLine: NormalizedBlockLine = {
        code: blockCode,
        fragments: blockCode.length === 0
          ? []
          : [
              {
                start: 0,
                end: blockCode.length,
                source: spanAt(
                  (this.physicalLineOffsets[blockLine.lineIndex] ?? 0) + sourceIndent,
                  blockLine.lineIndex + 1,
                  sourceIndent + 1,
                  blockCode.length,
                ),
              },
            ],
      };
      normalized.push(normalizedLine);
      if (!blockCode.trimStart().startsWith("//")) previousCodeLine = normalizedLine;
    }

    while (normalized[0]?.code === "") normalized.shift();
    while (normalized.at(-1)?.code === "") normalized.pop();
    if (normalized.length === 0) this.fail(code, message, line);

    const fragments: SourceTextFragment[] = [];
    let codeOffset = 0;
    for (const normalizedLine of normalized) {
      for (const fragment of normalizedLine.fragments) {
        fragments.push({
          start: codeOffset + fragment.start,
          end: codeOffset + fragment.end,
          source: fragment.source,
        });
      }
      codeOffset += normalizedLine.code.length + 1;
    }
    const sourceCode = normalized.map((blockLine) => blockLine.code).join("\n");

    while ((this.lines[this.index]?.lineNo ?? Infinity) <= physicalIndex) {
      this.index += 1;
    }
    const start = fragments[0]?.source.start;
    if (start === undefined) this.fail(code, message, line);
    return {
      code: sourceCode,
      fragments,
      start,
    };
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
      isModuleDeclaration(line.content) ||
      isComponentDeclaration(line.content) ||
      isPropsDeclaration(line.content) ||
      isSetupDeclaration(line.content)
    ) {
      this.fail(
        "BEAST1503_MISPLACED_DECLARATION",
        "Module code, imports, local components, props, and setup statements must be declared before template content.",
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
    if (line.content === "fragment") return this.parseFragment(line);
    if (line.content === "style") return this.parseStyle(line);
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

  private parseFragment(line: LogicalLine): FragmentNode {
    this.index += 1;
    const children = this.parseChildren(line.indent);
    if (children.length === 0) {
      this.fail(
        "BEAST1901_EMPTY_FRAGMENT",
        "An explicit fragment requires at least one indented template node.",
        line,
      );
    }
    return {
      kind: "fragment",
      children,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
  }

  private parseStyle(line: LogicalLine): StyleNode {
    const source = this.parseSourceBlock(
      line,
      "BEAST1902_EMPTY_STYLE",
      "A style block requires indented CSS source.",
    );
    return {
      kind: "style",
      css: source.code,
      codeStart: source.start,
      cssFragments: source.fragments,
      lineNo: line.lineNo,
      span: lineSpan(line),
    };
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

function isModuleDeclaration(content: string): boolean {
  return content === "module" || /^module\s/u.test(content);
}

function isComponentDeclaration(content: string): boolean {
  return content === "component" || /^component\s/u.test(content);
}

function isPropsDeclaration(content: string): boolean {
  return content === "props" || /^props\s/u.test(content);
}

function isSetupDeclaration(content: string): boolean {
  return content === "setup" || /^setup\s/u.test(content);
}

function inlineSource(line: LogicalLine, keyword: "module" | "setup"): SourceBlockResult {
  const code = line.content.slice(keyword.length).trim();
  const relativeOffset = line.content.indexOf(code, keyword.length);
  const fragments = sourceTextFragments(
    line,
    relativeOffset,
    relativeOffset + code.length,
  );
  const start = fragments[0]?.source.start;
  if (start === undefined) {
    throw new Error(`Unable to locate inline ${keyword} source.`);
  }
  return {
    code,
    fragments,
    start,
  };
}

function isPendingBranch(content: string): boolean {
  return content === "pending" || content.startsWith("pending ") || content.startsWith("pending(");
}

function isCatchBranch(content: string): boolean {
  return content === "catch" || content.startsWith("catch ") || content.startsWith("catch(");
}

function continuationPayload(
  content: string,
): { sourceStart: number; text: string } | null {
  if (!content.startsWith("~")) return null;
  let sourceStart = 1;
  while (content[sourceStart] === " " || content[sourceStart] === "\t") {
    sourceStart += 1;
  }
  const text = content.slice(sourceStart).trimEnd();
  return text.length === 0 ? null : { sourceStart, text };
}

function createLogicalLines(source: string, filename: string): LogicalLine[] {
  const rawLines: LogicalLine[] = [];
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
      rawLines.push({
        content,
        fragments: [
          {
            logicalStart: 0,
            logicalEnd: content.length,
            source: spanAt(
              offset + leading.length,
              index + 1,
              leading.length + 1,
              content.length,
            ),
          },
        ],
        indent: leading.length,
        lineNo: index + 1,
        offset: offset + leading.length,
      });
    }
    offset += raw.length + 1;
  }
  const result: LogicalLine[] = [];
  for (const line of rawLines) {
    if (line.content.startsWith("~")) {
      const prev = result[result.length - 1];
      if (prev === undefined || line.indent <= prev.indent) {
        throw new BeastCompileError({
          code: "BEAST1004_ORPHAN_CONTINUATION",
          severity: "error",
          message: "A continuation line starting with `~` must follow an indented parent line.",
          filename,
          span: lineSpan(line),
        });
      }
      const continuation = continuationPayload(line.content);
      if (continuation === null || continuation.text.startsWith("//")) continue;
      const logicalStart = prev.content.length + 1;
      prev.content += ` ${continuation.text}`;
      const sourceStart = line.fragments[0]?.source.start;
      if (sourceStart === undefined) continue;
      prev.fragments.push({
        logicalStart,
        logicalEnd: logicalStart + continuation.text.length,
        source: spanAt(
          sourceStart.offset + continuation.sourceStart,
          sourceStart.line,
          sourceStart.column + continuation.sourceStart,
          continuation.text.length,
        ),
      });
      continue;
    }
    result.push(line);
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
    if (input[cursor] === "{") {
      const close = findMatchingDelimiter(input, cursor);
      if (close === -1) attributeFailure("Unclosed spread attribute.", line, filename, start);
      const spread = input.slice(cursor + 1, close).trim();
      if (!spread.startsWith("...")) {
        attributeFailure(
          "A braced attribute must begin with `...` to spread an expression.",
          line,
          filename,
          start,
        );
      }
      const code = spread.slice(3).trim();
      if (code.length === 0) {
        attributeFailure("A spread attribute requires an expression.", line, filename, start);
      }
      cursor = close + 1;
      attrs.push({
        kind: "spread",
        code,
        span: attributeSpan(line, columnOffset + start, columnOffset + cursor),
      });
      continue;
    }
    const nameMatch = input.slice(cursor).match(/^[A-Za-z_$][A-Za-z0-9_$:-]*/u);
    if (nameMatch === null) attributeFailure("Expected an attribute name.", line, filename);
    const name = nameMatch[0];
    cursor += name.length;
    while (cursor < input.length && /\s/u.test(input[cursor] ?? "")) cursor += 1;

    if (input[cursor] !== "=") {
      attrs.push({
        kind: "attribute",
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
        kind: "attribute",
        name,
        value: { type: "string", value: decodeHTML(value) },
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
        kind: "attribute",
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
      if (cursor < text.length) spans.push({ type: "literal", text: decodeHTML(text.slice(cursor)) });
      break;
    }
    if (opening > cursor) spans.push({ type: "literal", text: decodeHTML(text.slice(cursor, opening)) });
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
  const closing = opening === "(" ? ")" : opening === "{" ? "}" : "]";
  return scanJavaScriptRegion(input, openingIndex + 1, closing).closingIndex;
}

function findTopLevelSequence(input: string, sequence: string): number {
  return scanJavaScriptRegion(input, 0, null, sequence).foundIndex;
}

interface JavaScriptScanResult {
  closingIndex: number;
  foundIndex: number;
}

function scanJavaScriptRegion(
  input: string,
  start: number,
  closing: ")" | "}" | "]" | null,
  sequence?: string,
): JavaScriptScanResult {
  let canStartRegex = true;
  let index = start;
  while (index < input.length) {
    if (sequence !== undefined && input.startsWith(sequence, index)) {
      return { closingIndex: -1, foundIndex: index };
    }

    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";
    if (/\s/u.test(char)) {
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      const newline = input.indexOf("\n", index + 2);
      index = newline === -1 ? input.length : newline + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = input.indexOf("*/", index + 2);
      if (end === -1) return { closingIndex: -1, foundIndex: -1 };
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipQuoted(input, index, char);
      if (index === -1) return { closingIndex: -1, foundIndex: -1 };
      canStartRegex = false;
      continue;
    }
    if (char === "`") {
      index = skipTemplate(input, index);
      if (index === -1) return { closingIndex: -1, foundIndex: -1 };
      canStartRegex = false;
      continue;
    }
    if (char === "/" && canStartRegex) {
      index = skipRegex(input, index);
      if (index === -1) return { closingIndex: -1, foundIndex: -1 };
      canStartRegex = false;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      const nestedClosing = char === "(" ? ")" : char === "{" ? "}" : "]";
      const nested = scanJavaScriptRegion(input, index + 1, nestedClosing);
      if (nested.closingIndex === -1) return { closingIndex: -1, foundIndex: -1 };
      index = nested.closingIndex + 1;
      canStartRegex = false;
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      return char === closing
        ? { closingIndex: index, foundIndex: -1 }
        : { closingIndex: -1, foundIndex: -1 };
    }
    if (/[A-Za-z_$]/u.test(char)) {
      const identifier = input.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u)?.[0] ?? char;
      canStartRegex = REGEX_PREFIX_KEYWORDS.has(identifier);
      index += identifier.length;
      continue;
    }
    if (/[0-9]/u.test(char)) {
      const number = input.slice(index).match(/^(?:0[xob][0-9a-f]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)/iu)?.[0];
      index += number?.length ?? 1;
      canStartRegex = false;
      continue;
    }

    if (char === "/") {
      canStartRegex = true;
      index += next === "=" ? 2 : 1;
      continue;
    }
    canStartRegex = /[=,:;!?&|+\-*%~^<>]/u.test(char);
    index += 1;
  }
  return { closingIndex: closing === null ? input.length : -1, foundIndex: -1 };
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

function skipQuoted(input: string, opening: number, quote: string): number {
  for (let index = opening + 1; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === quote) return index + 1;
    if (char === "\n") return -1;
  }
  return -1;
}

function skipTemplate(input: string, opening: number): number {
  for (let index = opening + 1; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "`") return index + 1;
    if (char === "$" && input[index + 1] === "{") {
      const expression = scanJavaScriptRegion(input, index + 2, "}");
      if (expression.closingIndex === -1) return -1;
      index = expression.closingIndex;
    }
  }
  return -1;
}

function skipRegex(input: string, opening: number): number {
  let inCharacterClass = false;
  for (let index = opening + 1; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "\n") return -1;
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]") {
      inCharacterClass = false;
      continue;
    }
    if (char === "/" && !inCharacterClass) {
      let end = index + 1;
      while (/[A-Za-z]/u.test(input[end] ?? "")) end += 1;
      return end;
    }
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
  const keyIndex = element.attrs.findIndex(
    (attr) => attr.kind === "attribute" && attr.name === "key",
  );
  if (keyIndex === -1) return null;
  const key = element.attrs[keyIndex];
  if (key === undefined || key.kind !== "attribute" || key.value.type === "bool") {
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
  const first = line.fragments[0]?.source.start;
  const last = line.fragments.at(-1)?.source.end;
  if (first !== undefined && last !== undefined) return { start: first, end: last };
  return spanAt(line.offset, line.lineNo, line.indent + 1, 1);
}

function attributeSpan(line: LogicalLine, start: number, end: number): SourceSpan {
  const spanStart = logicalPosition(line, start, "start");
  const spanEnd = logicalPosition(line, Math.max(start + 1, end), "end");
  return { start: spanStart, end: spanEnd };
}

function sourceTextFragments(
  line: LogicalLine,
  start: number,
  end: number,
): SourceTextFragment[] {
  const fragments: SourceTextFragment[] = [];
  for (const fragment of line.fragments) {
    const overlapStart = Math.max(start, fragment.logicalStart);
    const overlapEnd = Math.min(end, fragment.logicalEnd);
    if (overlapStart >= overlapEnd) continue;
    const sourceDelta = overlapStart - fragment.logicalStart;
    const width = overlapEnd - overlapStart;
    fragments.push({
      start: overlapStart - start,
      end: overlapEnd - start,
      source: spanAt(
        fragment.source.start.offset + sourceDelta,
        fragment.source.start.line,
        fragment.source.start.column + sourceDelta,
        width,
      ),
    });
  }
  return fragments;
}

function logicalPosition(
  line: LogicalLine,
  logicalOffset: number,
  bias: "start" | "end",
): SourcePosition {
  let previous: LogicalLineFragment | undefined;
  for (const fragment of line.fragments) {
    if (logicalOffset < fragment.logicalStart) {
      return bias === "start"
        ? fragment.source.start
        : (previous?.source.end ?? fragment.source.start);
    }
    if (logicalOffset <= fragment.logicalEnd) {
      const delta = Math.min(
        logicalOffset - fragment.logicalStart,
        fragment.logicalEnd - fragment.logicalStart,
      );
      return {
        offset: fragment.source.start.offset + delta,
        line: fragment.source.start.line,
        column: fragment.source.start.column + delta,
      };
    }
    previous = fragment;
  }
  return previous?.source.end ?? {
    offset: line.offset,
    line: line.lineNo,
    column: line.indent + 1,
  };
}

function spanAt(offset: number, line: number, column: number, width: number): SourceSpan {
  return {
    start: { offset, line, column },
    end: { offset: offset + width, line, column: column + width },
  };
}
