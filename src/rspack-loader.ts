import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { inferRspackEnvironment } from "@octanejs/rspack-plugin";
import type { LoaderDefinition, RawSourceMap } from "@rspack/core";
import { createOctaneCompiler } from "octane/compiler/bundler";
import { compileBeast, componentNameFromPath } from "./compiler.js";
import type { ProjectComponentOptions } from "./project.js";

interface BeastRspackLoaderOptions {
  root?: string;
  components?: Readonly<Record<string, ProjectComponentOptions>>;
  octane?: {
    environment?: "client" | "server";
    hmr?: boolean;
    dev?: boolean;
    profile?: boolean;
    strong?: boolean;
    exclude?: string[];
    renderers?: unknown;
    requireDirective?: boolean;
    universalRuntime?: unknown;
  };
}

const beastRspackLoader: LoaderDefinition<BeastRspackLoaderOptions> = function (
  source,
  inputSourceMap,
) {
  this.cacheable?.(true);
  const callback = this.async?.() ?? this.callback.bind(this);

  try {
    const options = this.getOptions?.() ?? {};
    const octane = options.octane ?? {};
    const loaderRoot = this.rootContext ?? process.cwd();
    const root = realRoot(options.root === undefined
      ? loaderRoot
      : isAbsolute(options.root)
        ? options.root
        : resolve(loaderRoot, options.root));
    const resource = this.resource ?? this.resourcePath;
    const filename = cleanId(resource);
    const environment = octane.environment ?? inferRspackEnvironment(this.target);
    const hmr = environment === "client" && this.hot === true && octane.hmr !== false
      ? "webpack"
      : false;
    const dev = environment === "client" &&
      (octane.dev ?? (this.mode === undefined || this.mode !== "production"));
    const profile = environment === "client" && octane.profile === true;
    const projectName = toPosix(relative(root, filename));
    const configured = options.components?.[projectName];
    const tsrx = compileBeast(String(source), {
      filename,
      componentName: configured?.componentName ?? componentNameFromPath(filename),
      ...(configured?.propsParam === undefined ? {} : { propsParam: configured.propsParam }),
    });
    const tsrxId = `${filename.replace(/\.btsx$/u, ".tsrx")}${resource.slice(filename.length)}`;
    const compiler = createOctaneCompiler({
      root,
      environment,
      hmr,
      dev,
      profile,
      ...(octane.strong === undefined ? {} : { strong: octane.strong }),
      ...(octane.exclude === undefined ? {} : { exclude: octane.exclude }),
      ...(octane.renderers === undefined ? {} : { renderers: octane.renderers }),
      ...(octane.requireDirective === undefined
        ? {}
        : { requireDirective: octane.requireDirective }),
      ...(octane.universalRuntime === undefined
        ? {}
        : { universalRuntime: octane.universalRuntime }),
      warn: (message) => this.emitWarning?.(new Error(message)),
    });
    const result = compiler.transform(tsrx, tsrxId, {
      environment,
      hmr,
      dev,
      profile,
    });
    if (result === null) {
      throw new Error(`Octane declined to compile generated TSRX for ${projectName}.`);
    }

    for (const dependency of new Set(result.dependencies ?? [])) {
      this.addDependency?.(dependency);
    }
    for (const dependency of new Set(result.missingDependencies ?? [])) {
      this.addMissingDependency?.(dependency);
    }
    setBuildInfo(this._module, tsrxId, root, result);
    callback(
      null,
      result.code,
      this.sourceMap === false
        ? undefined
        : ((result.map ?? inputSourceMap) as RawSourceMap | undefined),
    );
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
};

export default beastRspackLoader;

function cleanId(id: string): string {
  return id.split(/[?#]/u, 1)[0] ?? id;
}

function realRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function canonicalId(id: string, root: string): string {
  const filename = cleanId(id);
  const relativeName = relative(root, filename);
  if (
    relativeName === ".." ||
    relativeName.startsWith(`..${sep}`) ||
    isAbsolute(relativeName)
  ) {
    return toPosix(filename);
  }
  return `/${toPosix(relativeName.replace(/\.btsx$/u, ".tsrx"))}`;
}

function setBuildInfo(
  module: unknown,
  id: string,
  root: string,
  result: { kind: string; code: string; universalRuntime?: unknown; clientReference?: unknown },
): void {
  if (typeof module !== "object" || module === null) return;
  const target = module as { buildInfo?: Record<string, unknown> };
  target.buildInfo ??= {};
  target.buildInfo.octane = {
    canonicalId: canonicalId(id, root),
    transformKind: result.kind,
    serverRpc: result.code.includes("_$__serverRpc(") || result.code.includes("export const _$_server_$_"),
    ...(result.universalRuntime === undefined ? {} : { universalRuntime: result.universalRuntime }),
    ...(result.clientReference === undefined ? {} : { clientReference: result.clientReference }),
  };
}

function toPosix(path: string): string {
  return path.split(/[/\\]/u).join("/");
}
