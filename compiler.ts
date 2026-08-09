import { generateTsx, type CompileOptions } from './codegen'
import { parse } from './parser'

export function compileBeast(source: string, options: CompileOptions): string {
  const ast = parse(source)
  return generateTsx(ast, options)
}

export { CompileOptions }
