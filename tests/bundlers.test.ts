import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRsbuild } from "@rsbuild/core";
import { rspack, type Configuration, type Stats } from "@rspack/core";
import { beastOctane as beastOctaneRsbuild } from "../src/rsbuild.js";
import { beastOctane as beastOctaneRspack } from "../src/rspack.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryProject(prefix: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  await symlink(resolve("node_modules"), resolve(directory, "node_modules"), "dir");
  await mkdir(resolve(directory, "src"), { recursive: true });
  return directory;
}

async function writeMixedApplication(root: string): Promise<void> {
  await Bun.write(
    resolve(root, "src", "App.btsx"),
    [
      'import { Hydrate, useState } from "octane";',
      'import { interaction } from "octane/hydration";',
      'import { Native } from "./Native.tsrx";',
      "component DeferredCounter",
      "  setup",
      "    const [count, setCount] = useState(0);",
      "  button#activate(type=\"button\" onClick={() => setCount(count + 1)}) Count #{count}",
      "main",
      "  h1 Bundler lifecycle",
      "  Native",
      "  Hydrate(when={interaction({ events: \"click\" })})",
      "    DeferredCounter",
    ].join("\n"),
  );
  await Bun.write(
    resolve(root, "src", "Native.tsrx"),
    "export function Native() @{\n  <aside>Native TSRX</aside>\n}\n",
  );
  await Bun.write(
    resolve(root, "src", "main.ts"),
    [
      'import { createRoot } from "octane";',
      'import App from "./App.btsx";',
      'createRoot(document.getElementById("app")!).render(App);',
    ].join("\n"),
  );
  await Bun.write(
    resolve(root, "src", "entry-server.ts"),
    [
      'import { renderToString } from "octane/server";',
      'import App from "./App.btsx";',
      "export function render() {",
      "  return renderToString(App).html;",
      "}",
    ].join("\n"),
  );
}

async function runRspack(config: Configuration): Promise<Stats> {
  return await new Promise<Stats>((resolveBuild, rejectBuild) => {
    const compiler = rspack(config, (error, stats) => {
      const finish = (closeError?: Error | null) => {
        if (error !== null) rejectBuild(error);
        else if (closeError != null) rejectBuild(closeError);
        else if (stats === undefined) rejectBuild(new Error("Rspack returned no build stats."));
        else if (stats.hasErrors()) {
          rejectBuild(new Error(stats.toString({ colors: false, all: false, errors: true })));
        } else resolveBuild(stats);
      };
      compiler.close(finish);
    });
  });
}

describe("Octane bundler integrations", () => {
  test("Rspack builds a split client graph and executable server render", async () => {
    const root = await temporaryProject("beast-rspack-test-");
    await writeMixedApplication(root);
    const outDir = resolve(root, "dist");

    await runRspack({
      context: root,
      mode: "production",
      target: "web",
      entry: "./src/main.ts",
      output: {
        path: outDir,
        filename: "main.js",
        chunkFilename: "chunks/[name].js",
        clean: true,
      },
      optimization: { minimize: false },
      plugins: [beastOctaneRspack()],
    });

    const files = await readdir(outDir, { recursive: true });
    expect(files.filter((file) => file.endsWith(".js"))).toHaveLength(2);
    expect(files.some((file) => file.startsWith("chunks/") && file.endsWith(".js"))).toBe(true);
    const entry = await readFile(resolve(outDir, "main.js"), "utf8");
    expect(entry).toContain("Native TSRX");
    expect(entry).toContain("Bundler lifecycle");

    const serverOutDir = resolve(root, "dist-server");
    await runRspack({
      context: root,
      mode: "production",
      target: "node",
      entry: "./src/entry-server.ts",
      output: {
        path: serverOutDir,
        filename: "server.cjs",
        library: { type: "commonjs2" },
        clean: true,
      },
      optimization: { minimize: false },
      plugins: [beastOctaneRspack()],
    });
    const server = (await import(
      `${pathToFileURL(resolve(serverOutDir, "server.cjs")).href}?test=${Date.now()}`
    )) as { default: { render(): string } };
    const html = server.default.render();
    expect(html).toContain("Native TSRX");
    expect(html).toContain('data-octane-hydrate-when="interaction"');
  });

  test("Rsbuild composes its Octane integration with mixed BTSX/TSRX", async () => {
    const root = await temporaryProject("beast-rsbuild-test-");
    await writeMixedApplication(root);
    const outDir = resolve(root, "dist");
    const instance = await createRsbuild({
      cwd: root,
      config: {
        plugins: beastOctaneRsbuild(),
        source: { entry: { index: "./src/main.ts" } },
        output: {
          distPath: { root: outDir },
          filenameHash: false,
          minify: false,
        },
      },
    });
    const result = await instance.build();
    try {
      expect(result.stats?.hasErrors()).toBe(false);
      const files = await readdir(outDir, { recursive: true });
      expect(files.filter((file) => file.endsWith(".js")).length).toBeGreaterThanOrEqual(2);
      expect(files.some((file) => file.endsWith(".html"))).toBe(true);
      const scripts = await Promise.all(
        files.filter((file) => file.endsWith(".js"))
          .map((file) => readFile(resolve(outDir, file), "utf8")),
      );
      expect(scripts.some((source) => source.includes("Native TSRX"))).toBe(true);
      expect(scripts.some((source) => source.includes("Bundler lifecycle"))).toBe(true);
    } finally {
      await result.close();
    }
  });

  test("Rsbuild routes a BTSX entry through browser and Node environments", async () => {
    const root = await temporaryProject("beast-rsbuild-app-test-");
    await writeMixedApplication(root);
    await Bun.write(
      resolve(root, "index.html"),
      [
        "<!doctype html>",
        "<html>",
        "  <head><!--ssr-head--></head>",
        '  <body><div id="root"><!--ssr-body--></div></body>',
        "</html>",
      ].join("\n"),
    );
    await Bun.write(
      resolve(root, "octane.config.ts"),
      [
        'import { defineConfig, RenderRoute } from "@octanejs/rsbuild-plugin";',
        "export default defineConfig({",
        "  build: { minify: false },",
        "  router: { routes: [new RenderRoute({ path: \"/\", entry: \"/src/App.btsx\" })] },",
        "});",
      ].join("\n"),
    );
    const instance = await createRsbuild({
      cwd: root,
      config: { plugins: beastOctaneRsbuild() },
    });
    const result = await instance.build();
    try {
      expect(result.stats?.hasErrors()).toBe(false);
      const environmentStats = result.stats !== undefined && "stats" in result.stats
        ? result.stats.stats
        : result.stats === undefined
          ? []
          : [result.stats];
      const outputPaths = environmentStats.map((stats) => stats.compilation.outputOptions.path);
      const clientOutDir = outputPaths.find((path) => path.endsWith("client"));
      const serverOutDir = outputPaths.find((path) => path.endsWith("server"));
      if (clientOutDir === undefined || serverOutDir === undefined) {
        throw new Error(`Expected Rsbuild client/server outputs, received ${outputPaths.join(", ")}.`);
      }
      const clientFiles = await readdir(clientOutDir, { recursive: true });
      expect(await readFile(resolve(serverOutDir, "index.html"), "utf8"))
        .toContain("/static/js/index.js");
      expect(clientFiles.filter((file) => file.endsWith(".js")).length).toBeGreaterThanOrEqual(2);

      const server = (await import(
        `${pathToFileURL(resolve(serverOutDir, "entry.js")).href}?test=${Date.now()}`
      )) as { handler(request: Request): Promise<Response> };
      const response = await server.handler(new Request("https://beast.test/"));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain("Bundler lifecycle");
      expect(html).toContain("Native TSRX");
    } finally {
      await result.close();
    }
  });
});
