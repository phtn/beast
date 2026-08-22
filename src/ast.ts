export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

/**
 * Maps a contiguous slice of normalized Beast text back to the authored
 * source. Continuations introduce unmapped separator spaces between slices,
 * so a single SourceSpan is not sufficient for embedded TypeScript or CSS.
 */
export interface SourceTextFragment {
  start: number;
  end: number;
  source: SourceSpan;
}

export type AttrValue =
  | { type: "string"; value: string }
  | { type: "expr"; code: string }
  | { type: "bool" };

export interface NamedAttr {
  kind: "attribute";
  name: string;
  value: AttrValue;
  span: SourceSpan;
}

export interface SpreadAttr {
  kind: "spread";
  code: string;
  span: SourceSpan;
}

export type Attr = NamedAttr | SpreadAttr;

export type TextSpan =
  | { type: "literal"; text: string }
  | { type: "expr"; code: string };

interface BaseNode {
  lineNo: number;
  span: SourceSpan;
}

export interface ImportDeclaration extends BaseNode {
  kind: "import";
  code: string;
  codeFragments: SourceTextFragment[];
}

export interface ModuleDeclaration extends BaseNode {
  kind: "module";
  code: string;
  codeStart: SourcePosition;
  codeFragments: SourceTextFragment[];
}

export interface PropsDeclaration extends BaseNode {
  kind: "props";
  parameter: string;
  parameterFragments: SourceTextFragment[];
}

export interface SetupDeclaration extends BaseNode {
  kind: "setup";
  code: string;
  codeStart: SourcePosition;
  codeFragments: SourceTextFragment[];
}

export interface ComponentDeclaration extends BaseNode {
  kind: "component";
  name: string;
  props: PropsDeclaration | null;
  setup: SetupDeclaration[];
  children: BeastNode[];
}

export type BeastDeclaration =
  | ImportDeclaration
  | ModuleDeclaration
  | ComponentDeclaration
  | PropsDeclaration
  | SetupDeclaration;

export interface ElementNode extends BaseNode {
  kind: "element";
  tag: string;
  isComponent: boolean;
  classes: string[];
  id: string | null;
  attrs: Attr[];
  inlineSpans: TextSpan[] | null;
  children: BeastNode[];
}

export interface TextNode extends BaseNode {
  kind: "text";
  spans: TextSpan[];
}

export interface FragmentNode extends BaseNode {
  kind: "fragment";
  children: BeastNode[];
}

export interface StyleNode extends BaseNode {
  kind: "style";
  css: string;
  codeStart: SourcePosition;
  cssFragments: SourceTextFragment[];
}

export interface IfBranch {
  test: string | null;
  children: BeastNode[];
  span: SourceSpan;
}

export interface IfNode extends BaseNode {
  kind: "if";
  branches: IfBranch[];
}

export interface EachNode extends BaseNode {
  kind: "each";
  itemName: string;
  indexName: string | null;
  iterable: string;
  key: string | null;
  children: BeastNode[];
  emptyChildren: BeastNode[] | null;
}

export interface SwitchBranch {
  test: string | null;
  children: BeastNode[];
  span: SourceSpan;
}

export interface SwitchNode extends BaseNode {
  kind: "switch";
  discriminant: string;
  branches: SwitchBranch[];
}

export interface TryPendingBranch {
  children: BeastNode[];
  span: SourceSpan;
}

export interface TryCatchBranch {
  bindings: string | null;
  children: BeastNode[];
  span: SourceSpan;
}

export interface TryNode extends BaseNode {
  kind: "try";
  children: BeastNode[];
  pendingBranch: TryPendingBranch | null;
  catchBranch: TryCatchBranch | null;
}

export type BeastNode =
  | ElementNode
  | TextNode
  | FragmentNode
  | StyleNode
  | IfNode
  | EachNode
  | SwitchNode
  | TryNode;

export interface BeastDocument {
  kind: "document";
  filename: string;
  declarations: BeastDeclaration[];
  children: BeastNode[];
  span: SourceSpan;
}
