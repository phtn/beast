import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build as viteBuild } from "vite";
import { BeastCompileError, buildBeastProject } from "../src/index.js";
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
    });

    expect(await readFile(resolve(root, "dist", "index.html"), "utf8")).toContain("/assets/");
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
