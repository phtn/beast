import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OctaneRspackPlugin,
  type OctaneRspackPluginOptions,
} from "@octanejs/rspack-plugin";
import type { Compiler, RspackPluginInstance } from "@rspack/core";
import type { ProjectComponentOptions } from "./project.js";

export interface BeastRspackOptions {
  root?: string;
  components?: Readonly<Record<string, ProjectComponentOptions>>;
  octane?: OctaneRspackPluginOptions;
}

const loaderPath = fileURLToPath(new URL(
  import.meta.url.endsWith(".ts") ? "./rspack-loader.ts" : "./rspack-loader.js",
  import.meta.url,
));

/** Compile `.btsx` resources before Rspack parses the resulting JavaScript. */
export class BeastRspackPlugin implements RspackPluginInstance {
  readonly options: Readonly<BeastRspackOptions>;

  constructor(options: BeastRspackOptions = {}) {
    this.options = Object.freeze({
      ...options,
      ...(options.components === undefined
        ? {}
        : { components: Object.freeze({ ...options.components }) }),
    });
  }

  apply(compiler: Compiler): void {
    const compilerRoot = compiler.options.context ?? process.cwd();
    const configuredRoot = this.options.root ?? this.options.octane?.root;
    const root = realRoot(configuredRoot === undefined
      ? compilerRoot
      : isAbsolute(configuredRoot)
        ? configuredRoot
        : resolve(compilerRoot, configuredRoot));

    compiler.options.resolve ??= {};
    const extensions = compiler.options.resolve.extensions ?? [".js", ".json", ".wasm"];
    compiler.options.resolve.extensions = extensions.includes(".btsx")
      ? extensions
      : [".btsx", ...extensions];

    const extensionAlias = compiler.options.resolve.extensionAlias ?? {};
    const configuredTsrx = extensionAlias[".tsrx"];
    const tsrxAliases = configuredTsrx === undefined
      ? [".tsrx"]
      : Array.isArray(configuredTsrx)
        ? configuredTsrx
        : [configuredTsrx];
    compiler.options.resolve.extensionAlias = {
      ...extensionAlias,
      ".tsrx": [...new Set([...tsrxAliases, ".btsx"])],
    };

    compiler.options.module.rules ??= [];
    compiler.options.module.rules.push({
      test: /\.btsx$/iu,
      type: "javascript/auto",
      enforce: "pre",
      use: [{
        loader: loaderPath,
        options: {
          root,
          ...(this.options.components === undefined
            ? {}
            : { components: this.options.components }),
          ...(this.options.octane === undefined ? {} : { octane: this.options.octane }),
        },
      }],
    });
  }
}

/** Beast-only Rspack transform for configurations that already install Octane. */
export function beast(options: BeastRspackOptions = {}): BeastRspackPlugin {
  return new BeastRspackPlugin(options);
}

/** Complete Rspack integration for mixed `.btsx` and native Octane sources. */
export function beastOctane(options: BeastRspackOptions = {}): RspackPluginInstance {
  return {
    apply(compiler) {
      new OctaneRspackPlugin({
        ...options.octane,
        ...(options.root === undefined ? {} : { root: options.root }),
      }).apply(compiler);
      new BeastRspackPlugin(options).apply(compiler);
    },
  };
}

function realRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
