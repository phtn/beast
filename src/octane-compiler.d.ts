declare module "octane/compiler" {
  export interface OctaneCompileOptions {
    mode?: "client" | "server";
    hmr?: boolean | "vite" | "webpack";
    dev?: boolean;
    profile?: boolean;
    strong?: boolean;
  }

  export interface OctaneCompileResult {
    code: string;
    map: unknown;
    diagnostics: readonly unknown[];
  }

  export function compile(
    source: string,
    filename: string,
    options?: OctaneCompileOptions,
  ): OctaneCompileResult;
}

declare module "octane/compiler/bundler" {
  import type { OctaneCompileResult } from "octane/compiler";

  export interface OctaneBundlerTransformResult extends OctaneCompileResult {
    kind: string;
    dependencies: string[];
    missingDependencies: string[];
  }

  export interface OctaneBundlerCompiler {
    transform(
      source: string,
      id: string,
      options?: {
        environment?: "client" | "server";
        hmr?: boolean | "vite" | "webpack";
        dev?: boolean;
        profile?: boolean;
        strong?: boolean;
      },
    ): OctaneBundlerTransformResult | null;
    invalidate(path?: string): void;
  }

  export function createOctaneCompiler(options?: {
    root?: string;
    environment?: "client" | "server";
    hmr?: boolean | "vite" | "webpack";
    dev?: boolean;
    profile?: boolean;
    strong?: boolean;
    warn?: (message: string) => void;
  }): OctaneBundlerCompiler;
}
