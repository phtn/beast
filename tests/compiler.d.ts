declare module 'octane/compiler' {
  export interface OctaneCompileOptions {
    mode?: 'client' | 'server'
    hmr?: boolean | 'vite' | 'webpack'
    dev?: boolean
    profile?: boolean
    strong?: boolean
  }

  export interface OctaneCompileResult {
    code: string
    map: unknown
    diagnostics: readonly unknown[]
  }

  export function compile(source: string, filename: string, options?: OctaneCompileOptions): OctaneCompileResult
}
