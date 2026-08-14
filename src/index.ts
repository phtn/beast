export type {
  Attr,
  AttrValue,
  BeastDeclaration,
  BeastDocument,
  BeastNode,
  ComponentDeclaration,
  EachNode,
  ElementNode,
  FragmentNode,
  IfBranch,
  IfNode,
  ImportDeclaration,
  ModuleDeclaration,
  NamedAttr,
  PropsDeclaration,
  SetupDeclaration,
  SourcePosition,
  SourceSpan,
  SpreadAttr,
  StyleNode,
  SwitchBranch,
  SwitchNode,
  TextNode,
  TextSpan,
  TryCatchBranch,
  TryNode,
  TryPendingBranch,
} from "./ast.js";
export {
  compileBeast,
  compileBeastResult,
  componentNameFromPath,
} from "./compiler.js";
export type { CompileOptions, CompileResult } from "./compiler.js";
export { BeastCompileError, formatDiagnostic } from "./diagnostics.js";
export type { BeastDiagnostic, DiagnosticSeverity } from "./diagnostics.js";
export { parse } from "./parser.js";
export { buildBeastProject, resolveProjectPath } from "./project.js";
export type {
  BuildProjectOptions,
  BuiltProjectFile,
  ProjectBuildResult,
  ProjectComponentOptions,
} from "./project.js";
