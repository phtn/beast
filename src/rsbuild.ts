import {
  loadOctaneConfig,
  octaneConfigExists,
  pluginOctane,
  type OctaneRsbuildPluginOptions,
} from "@octanejs/rsbuild-plugin";
import type { RsbuildPlugin, RsbuildPlugins } from "@rsbuild/core";
import {
  BeastRspackPlugin,
  type BeastRspackOptions,
} from "./rspack.js";
import type { ProjectComponentOptions } from "./project.js";

export interface BeastRsbuildOptions {
  components?: Readonly<Record<string, ProjectComponentOptions>>;
  octane?: OctaneRsbuildPluginOptions;
}

/** Beast-only Rsbuild transform for configurations that already install Octane. */
export function beast(options: BeastRsbuildOptions = {}): RsbuildPlugin {
  return {
    name: "beast:tsrx",
    enforce: "pre",
    async setup(api) {
      const root = api.context.rootPath;
      const projectConfig = octaneConfigExists(root) ? await loadOctaneConfig(root) : null;
      const inline = options.octane;
      const strong = inline?.strong ?? projectConfig?.compiler.strong;
      const rspackOctane: NonNullable<BeastRspackOptions["octane"]> = {
        ...(inline?.hmr === undefined ? {} : { hmr: inline.hmr }),
        ...(inline?.profile === undefined ? {} : { profile: inline.profile }),
        ...(inline?.exclude === undefined ? {} : { exclude: inline.exclude }),
        ...(inline?.requireDirective === undefined
          ? {}
          : { requireDirective: inline.requireDirective }),
        ...(strong === undefined ? {} : { strong }),
        ...(projectConfig?.compiler.renderers === undefined
          ? {}
          : { renderers: projectConfig.compiler.renderers }),
      };
      api.modifyRspackConfig((config) => {
        config.plugins ??= [];
        const rspackOptions: BeastRspackOptions = {
          root,
          ...(options.components === undefined ? {} : { components: options.components }),
          octane: rspackOctane,
        };
        config.plugins.push(new BeastRspackPlugin(rspackOptions));
        return config;
      });
    },
  };
}

/** Complete Rsbuild integration for mixed `.btsx` and native Octane sources. */
export function beastOctane(options: BeastRsbuildOptions = {}): RsbuildPlugins {
  return [pluginOctane(options.octane), beast(options)];
}
