import { relative } from "node:path";
import { createOctaneCompiler } from "octane/compiler/bundler";
import {
  octane as octaneVite,
  type OctaneVitePluginOptions,
} from "octane/compiler/vite";
import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { compileBeast, componentNameFromPath } from "./compiler.js";
import type { ProjectComponentOptions } from "./project.js";

export interface BeastViteOptions {
  components?: Readonly<Record<string, ProjectComponentOptions>>;
  octane?: OctaneVitePluginOptions;
}

/** Compile `.btsx` modules through Beast and then Octane in one Vite transform. */
export function beast(options: BeastViteOptions = {}): Plugin {
  let config: ResolvedConfig | undefined;
  let octaneCompiler: ReturnType<typeof createOctaneCompiler> | undefined;

  return {
    name: "beast:tsrx",
    enforce: "pre",
    configResolved(resolved) {
      config = resolved;
      octaneCompiler = createOctaneCompiler({
        root: resolved.root,
        environment: "client",
        hmr: resolved.command === "serve" ? "vite" : false,
        dev: resolved.command === "serve",
        profile: options.octane?.profile === true,
        strong: options.octane?.strong === true,
        warn: (message) => resolved.logger.warn(message),
      });
    },
    transform(source, id, transformOptions) {
      const filename = cleanId(id);
      if (!filename.endsWith(".btsx")) return null;
      if (config === undefined || octaneCompiler === undefined) {
        throw new Error("The Beast Vite plugin was used before Vite configuration completed.");
      }

      const projectName = toPosix(relative(config.root, filename));
      const configured = options.components?.[projectName];
      const tsrx = compileBeast(source, {
        filename,
        componentName: configured?.componentName ?? componentNameFromPath(filename),
        ...(configured?.propsParam === undefined ? {} : { propsParam: configured.propsParam }),
      });
      const tsrxId = filename.replace(/\.btsx$/u, ".tsrx");
      const environment = transformOptions?.ssr === true ? "server" : "client";
      const result = octaneCompiler.transform(tsrx, tsrxId, {
        environment,
        hmr: environment === "client" && config.command === "serve" ? "vite" : false,
        dev: config.command === "serve",
        profile: options.octane?.profile === true,
        strong: options.octane?.strong === true,
      });
      if (result === null) {
        throw new Error(`Octane declined to compile generated TSRX for ${projectName}.`);
      }
      return { code: result.code, map: result.map as never };
    },
    handleHotUpdate(context) {
      if (context.file.endsWith(".btsx")) octaneCompiler?.invalidate(context.file);
    },
  };
}

/**
 * Complete Octane compiler integration for mixed `.btsx` and native `.tsrx`
 * projects. Use this once in `vite.config.ts`.
 */
export function beastOctane(options: BeastViteOptions = {}): PluginOption {
  return [beast(options), octaneVite(options.octane)];
}

function cleanId(id: string): string {
  return id.split(/[?#]/u, 1)[0] ?? id;
}

function toPosix(path: string): string {
  return path.split(/[/\\]/u).join("/");
}
