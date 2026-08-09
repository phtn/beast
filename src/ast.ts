export interface SourcePosition {
  offset: number;
  line: number;
  column: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export type AttrValue =
  | { type: "string"; value: string }
  | { type: "expr"; code: string }
  | { type: "bool" };

export interface Attr {
  name: string;
  value: AttrValue;
  span: SourceSpan;
}

export type TextSpan =
  | { type: "literal"; text: string }
  | { type: "expr"; code: string };

interface BaseNode {
  lineNo: number;
  span: SourceSpan;
}

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
}

export type BeastNode = ElementNode | TextNode | IfNode | EachNode;

export interface BeastDocument {
  kind: "document";
  filename: string;
  children: BeastNode[];
  span: SourceSpan;
}
