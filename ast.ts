/**
 * AST node definitions for the Beast language (.btsx -> .tsx).
 */

export type AttrValue =
  | { type: "string"; value: string }
  | { type: "expr"; code: string }
  | { type: "bool" };

export interface Attr {
  name: string;
  value: AttrValue;
}

export type TextSpan =
  | { type: "literal"; text: string }
  | { type: "expr"; code: string };

export interface ElementNode {
  kind: "element";
  tag: string;
  isComponent: boolean;
  classes: string[];
  id: string | null;
  attrs: Attr[];
  inlineSpans: TextSpan[] | null;
  children: BeastNode[];
  lineNo: number;
}

export interface TextNode {
  kind: "text";
  spans: TextSpan[];
  lineNo: number;
}

export interface IfBranch {
  test: string | null; // null = else branch
  children: BeastNode[];
}

export interface IfNode {
  kind: "if";
  branches: IfBranch[];
  lineNo: number;
}

export interface EachNode {
  kind: "each";
  itemName: string;
  indexName: string | null;
  iterable: string;
  children: BeastNode[];
  lineNo: number;
}

export type BeastNode = ElementNode | TextNode | IfNode | EachNode;
