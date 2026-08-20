import { basename, extname } from "node:path";
import type { BeastDocument } from "./ast.js";
import { generateTsrxResult } from "./codegen.js";
import type { BeastDiagnostic } from "./diagnostics.js";
import { parse } from "./parser.js";
import type { BeastSourceMap } from "./source-map.js";

export interface CompileOptions {
  filename?: string;
  componentName?: string;
  propsParam?: string;
}

export interface CompileResult {
  code: string;
  map: BeastSourceMap;
  ast: BeastDocument;
  diagnostics: BeastDiagnostic[];
}

export function compileBeastResult(
  source: string,
  options: CompileOptions = {},
): CompileResult {
  const filename = options.filename ?? "component.btsx";
  const componentName = options.componentName ?? componentNameFromPath(filename);
  const ast = parse(source, filename);
  const generated = generateTsrxResult(ast, source, {
    componentName,
    ...(options.propsParam === undefined ? {} : { propsParam: options.propsParam }),
  });
  return { code: generated.code, map: generated.map, ast, diagnostics: [] };
}

export function compileBeast(source: string, options: CompileOptions = {}): string {
  return compileBeastResult(source, options).code;
}

export function componentNameFromPath(inputPath: string): string {
  const base = basename(inputPath, extname(inputPath));
  const parts = base.split(/[^A-Za-z0-9_$]+/u).filter(Boolean);
  let name = parts
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
  if (name.length === 0) name = "BeastComponent";
  if (!/^[A-Za-z_$]/u.test(name)) name = `Beast${name}`;
  return name;
}
