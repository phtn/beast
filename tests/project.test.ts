import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as viteBuild } from "vite";
import { Window } from "happy-dom";
import { BeastCompileError, buildBeastProject, watchBeastProject } from "../src/index.js";
import { beastOctane } from "../src/vite.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryProject(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "beast-project-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

const DOM_GLOBALS = [
  "AbortController",
  "AbortSignal",
  "CharacterData",
  "Comment",
  "CompositionEvent",
  "CustomEvent",
  "Document",
  "DocumentFragment",
  "DOMException",
  "Element",
  "Event",
  "FocusEvent",
  "HTMLButtonElement",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTemplateElement",
  "InputEvent",
  "KeyboardEvent",
  "MathMLElement",
  "MouseEvent",
  "MutationObserver",
  "Node",
  "NodeFilter",
  "PointerEvent",
  "Range",
  "SVGElement",
  "Text",
  "TouchEvent",
] as const;

function installDomGlobals(browser: Window): () => void {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const browserValues = browser as unknown as Record<string, unknown>;

  for (const name of ["window", "self", "document", ...DOM_GLOBALS]) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "window" || name === "self"
        ? browser
        : name === "document"
          ? browser.document
          : browserValues[name],
    });
  }

  for (const name of ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"] as const) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: browserValues[name] instanceof Function
        ? browserValues[name].bind(browser)
        : browserValues[name],
    });
  }

  return () => {
    for (const [name, descriptor] of originals) {
      if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
    browser.close();
  };
}

async function waitFor(check: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(10);
  }
}

async function waitForFileText(path: string, text: string, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      if ((await readFile(path, "utf8")).includes(text)) return;
    } catch {
      // The initial build may not have created the file yet.
    }
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(10);
  }
}

describe("project building", () => {
  test("builds a mirrored TSRX source tree and validates native TSRX", async () => {
    const root = await temporaryProject();
    await mkdir(resolve(root, "components"), { recursive: true });
    await Bun.write(resolve(root, "components", "Hello.btsx"), ".hello Hello, #{name}\n");
    await Bun.write(
      resolve(root, "components", "Native.tsrx"),
      "export function Native() @{\n  <span>Native</span>\n}\n",
    );
    const outDir = resolve(root, "generated");
    const result = await buildBeastProject({
      root,
      outDir,
      components: {
        "components/Hello.btsx": { propsParam: "{ name }: { name: string }" },
      },
    });

    expect(result.generated).toHaveLength(1);
    expect(result.removed).toEqual([]);
    expect(result.validatedNativeTsrx).toEqual(["components/Native.tsrx"]);
    expect(await readFile(resolve(outDir, "components", "Hello.tsrx"), "utf8")).toContain(
      "export default function Hello({ name }: { name: string }) @{",
    );
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      schemaVersion: number;
      generated: unknown[];
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generated).toHaveLength(1);
  });

  test("watches source changes, recovers from errors, and ignores its output tree", async () => {
    const root = await temporaryProject();
    const outDir = resolve(root, ".generated");
    const sourceFile = resolve(root, "App.btsx");
    await Bun.write(sourceFile, "main\n  h1 First\n");
    expect(() => watchBeastProject({ root, outDir: root })).toThrow(
      "output directory must differ",
    );
    expect(() => watchBeastProject({ root, debounceMs: -1 })).toThrow(
      "debounce must be a non-negative finite number",
    );
    const builds: Awaited<ReturnType<typeof buildBeastProject>>[] = [];
    const errors: unknown[] = [];
    const session = watchBeastProject({
      root,
      outDir,
      validate: false,
      debounceMs: 10,
      onBuild: (result) => builds.push(result),
      onError: (error) => errors.push(error),
    });

    try {
      const initial = await session.ready;
      expect(initial.generated.map((file) => file.output)).toEqual(["App.tsrx"]);
      expect(builds).toHaveLength(1);

      await Bun.write(sourceFile, "main\n\tspan Broken\n");
      await waitFor(() => errors.length > 0, "Expected the watcher to report a compile error.");
      expect(errors[0]).toBeInstanceOf(BeastCompileError);

      await Bun.write(sourceFile, "main\n  h1 Recovered\n");
      await waitFor(() => builds.length >= 2, "Expected the watcher to recover after an edit.");
      expect(await readFile(resolve(outDir, "App.tsrx"), "utf8")).toContain("Recovered");

      await rm(sourceFile);
      await waitFor(() => builds.length >= 3, "Expected the watcher to rebuild after deletion.");
      expect(builds.at(-1)?.removed).toEqual(["App.tsrx"]);
      await expect(readFile(resolve(outDir, "App.tsrx"), "utf8")).rejects.toThrow();

      await Bun.sleep(100);
      expect(builds).toHaveLength(3);
    } finally {
      await session.close();
    }
  });

  test("runs standalone CLI watch builds until the process is stopped", async () => {
    const root = await temporaryProject();
    const outDir = resolve(root, ".generated");
    const sourceFile = resolve(root, "App.btsx");
    const outputFile = resolve(outDir, "App.tsrx");
    await Bun.write(sourceFile, "main\n  h1 First\n");
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        resolve("src", "cli.ts"),
        "build",
        root,
        "--out-dir",
        outDir,
        "--no-validate",
        "--watch",
      ],
      cwd: resolve("."),
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      await waitForFileText(outputFile, "First", "Expected the CLI watch initial build.");
      await Bun.write(sourceFile, "main\n  h1 Updated\n");
      await waitForFileText(outputFile, "Updated", "Expected the CLI watch rebuild.");
    } finally {
      child.kill();
      await child.exited;
    }
    expect(await new Response(child.stdout).text()).toContain("Built 1 BTSX component");
    expect(await new Response(child.stderr).text()).toBe("");
  });

  test("Vite builds mixed BTSX and native TSRX through Octane", async () => {
    const root = await temporaryProject();
    await symlink(resolve("node_modules"), resolve(root, "node_modules"), "dir");
    await mkdir(resolve(root, "src"), { recursive: true });
    await Bun.write(
      resolve(root, "index.html"),
      '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n',
    );
    await Bun.write(
      resolve(root, "src", "App.btsx"),
      [
        'import { Native } from "./Native.tsrx";',
        "props { title }: { title: string }",
        "main.app",
        "  h1 #{title}",
        "  Native",
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
        'createRoot(document.getElementById("app")!).render(App, { title: "Hello from Beast" });',
      ].join("\n"),
    );

    await viteBuild({
      root,
      logLevel: "silent",
      plugins: [beastOctane()],
      build: { sourcemap: true },
    });

    expect(await readFile(resolve(root, "dist", "index.html"), "utf8")).toContain("/assets/");
    const outputFiles = await readdir(resolve(root, "dist"), { recursive: true });
    const sourceMaps = await Promise.all(
      outputFiles.filter((file) => file.endsWith(".js.map"))
        .map(async (file) => JSON.parse(await readFile(resolve(root, "dist", file), "utf8")) as {
          sources: string[];
          sourcesContent?: Array<string | null>;
        }),
    );
    const beastMap = sourceMaps.find((map) =>
      map.sources.some((source) => source.endsWith("/src/App.btsx")),
    );
    expect(beastMap).toBeDefined();
    expect(beastMap?.sources.some((source) => source.endsWith("/src/App.tsrx"))).toBe(false);
    expect(beastMap?.sourcesContent?.some((source) => source?.includes("h1 #{title}")))
      .toBe(true);
  });

  test("Vite renders an SSR build and hydrates a compiler-split BTSX boundary", async () => {
    const root = await temporaryProject();
    await symlink(resolve("node_modules"), resolve(root, "node_modules"), "dir");
    await mkdir(resolve(root, "src"), { recursive: true });
    await Bun.write(
      resolve(root, "src", "App.btsx"),
      [
        'import { Hydrate, useState } from "octane";',
        'import { interaction } from "octane/hydration";',
        "component DeferredCounter",
        "  setup",
        "    const [count, setCount] = useState(0);",
        "  button#activate(type=\"button\" onClick={() => setCount(count + 1)}) Count #{count}",
        "main",
        "  h1 Vite lifecycle",
        "  Hydrate(when={interaction({ events: \"click\" })} onHydrated={() => ((globalThis as any).__beastHydrated += 1)})",
        "    DeferredCounter",
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
    await Bun.write(
      resolve(root, "src", "entry-client.ts"),
      [
        'import { hydrateRoot } from "octane";',
        'import { initializeHydrationEventCapture } from "octane/hydration";',
        'import App from "./App.btsx";',
        "const container = document.getElementById(\"app\")!;",
        "initializeHydrationEventCapture(document);",
        "(globalThis as any).__beastRoot = hydrateRoot(container, App);",
      ].join("\n"),
    );

    await viteBuild({
      root,
      logLevel: "silent",
      plugins: [beastOctane()],
      build: {
        minify: false,
        outDir: "dist/server",
        ssr: "src/entry-server.ts",
        rollupOptions: { output: { entryFileNames: "server.js" } },
      },
    });
    await viteBuild({
      root,
      logLevel: "silent",
      plugins: [beastOctane()],
      build: {
        minify: false,
        outDir: "dist/client",
        rollupOptions: {
          input: resolve(root, "src", "entry-client.ts"),
          output: {
            entryFileNames: "client.js",
            chunkFileNames: "chunks/[name]-[hash].js",
          },
        },
      },
    });

    const clientFiles = await readdir(resolve(root, "dist", "client"), { recursive: true });
    expect(clientFiles.filter((file) => file.endsWith(".js"))).toHaveLength(2);
    expect(clientFiles.some((file) => file.startsWith("chunks/") && file.endsWith(".js"))).toBe(true);

    const serverModule = (await import(
      `${pathToFileURL(resolve(root, "dist", "server", "server.js")).href}?test=${Date.now()}`
    )) as { render(): string };
    const html = serverModule.render();
    expect(html).toContain("Vite lifecycle");
    expect(html).toContain('data-octane-hydrate-when="interaction"');

    const browser = new Window({ url: "https://beast.test/" });
    const restoreDom = installDomGlobals(browser);
    const state = globalThis as Record<string, any>;
    try {
      state.__beastHydrated = 0;
      const container = browser.document.createElement("div");
      container.id = "app";
      container.innerHTML = html;
      browser.document.body.append(container);
      const serverButton = container.querySelector<HTMLButtonElement>("#activate");
      expect(serverButton).not.toBeNull();

      await import(
        `${pathToFileURL(resolve(root, "dist", "client", "client.js")).href}?test=${Date.now()}`
      );
      expect(container.querySelector("#activate")).toBe(serverButton);
      serverButton!.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }));

      await waitFor(
        () => state.__beastHydrated === 1 && serverButton!.textContent === "Count 1",
        "Expected the split boundary to hydrate and replay its activating click.",
      );
      expect(container.querySelector("#activate")).toBe(serverButton);
      state.__beastRoot.unmount();
    } finally {
      delete state.__beastRoot;
      delete state.__beastHydrated;
      restoreDom();
    }
  });

  test("removes only stale manifest outputs and prunes their empty directories", async () => {
    const root = await temporaryProject();
    await mkdir(resolve(root, "old"), { recursive: true });
    await Bun.write(resolve(root, "old", "Old.btsx"), ".old Old\n");
    const outDir = resolve(root, ".generated");

    const first = await buildBeastProject({ root, outDir });
    expect(first.removed).toEqual([]);
    await Bun.write(resolve(outDir, "keep.txt"), "unrelated");

    await mkdir(resolve(root, "new"), { recursive: true });
    await rename(resolve(root, "old", "Old.btsx"), resolve(root, "new", "New.btsx"));
    const renamed = await buildBeastProject({ root, outDir });

    expect(renamed.removed).toEqual(["old/Old.tsrx"]);
    expect(await readFile(resolve(outDir, "new", "New.tsrx"), "utf8")).toContain(
      "function New()",
    );
    await expect(readFile(resolve(outDir, "old", "Old.tsrx"), "utf8")).rejects.toThrow();
    await expect(stat(resolve(outDir, "old"))).rejects.toThrow();
    expect(await readFile(resolve(outDir, "keep.txt"), "utf8")).toBe("unrelated");

    await rm(resolve(root, "new", "New.btsx"));
    const deleted = await buildBeastProject({ root, outDir });
    expect(deleted.generated).toEqual([]);
    expect(deleted.removed).toEqual(["new/New.tsrx"]);
    await expect(stat(resolve(outDir, "new"))).rejects.toThrow();
    expect(await readFile(resolve(outDir, "keep.txt"), "utf8")).toBe("unrelated");
  });

  test("ignores unsafe stale paths from a previous manifest", async () => {
    const root = await temporaryProject();
    const outDir = resolve(root, ".generated");
    const outsideDir = resolve(root, "outside");
    await mkdir(outDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await Bun.write(resolve(root, "Current.btsx"), ".current Current\n");
    await Bun.write(resolve(root, "protected.tsrx"), "protected");
    await Bun.write(resolve(outsideDir, "linked.tsrx"), "linked");
    await Bun.write(resolve(outDir, "keep.txt"), "unrelated");
    await symlink(outsideDir, resolve(outDir, "linked"), "dir");
    await Bun.write(
      resolve(outDir, "beast-manifest.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          generated: [
            { source: "old.btsx", output: "../protected.tsrx", componentName: "Old" },
            {
              source: "linked/linked.btsx",
              output: "linked/linked.tsrx",
              componentName: "Linked",
            },
          ],
          validatedNativeTsrx: [],
        },
        null,
        2,
      )}\n`,
    );

    const result = await buildBeastProject({ root, outDir, validate: false });
    expect(result.removed).toEqual([]);
    expect(await readFile(resolve(root, "protected.tsrx"), "utf8")).toBe("protected");
    expect(await readFile(resolve(outsideDir, "linked.tsrx"), "utf8")).toBe("linked");
    expect(await readFile(resolve(outDir, "keep.txt"), "utf8")).toBe("unrelated");
  });

  test("defers stale cleanup until the current build succeeds", async () => {
    const root = await temporaryProject();
    const outDir = resolve(root, ".generated");
    await Bun.write(resolve(root, "Old.btsx"), ".old Old\n");
    await buildBeastProject({ root, outDir });

    await rm(resolve(root, "Old.btsx"));
    await Bun.write(resolve(root, "Broken.btsx"), "div\n\tspan Broken\n");
    await expect(buildBeastProject({ root, outDir })).rejects.toThrow(BeastCompileError);

    expect(await readFile(resolve(outDir, "Old.tsrx"), "utf8")).toContain("function Old()");
  });
});
