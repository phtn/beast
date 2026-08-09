import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build as viteBuild } from "vite";
import { buildBeastProject } from "../src/index.js";
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
    await Bun.write(resolve(root, "src", "App.btsx"), "main.app\n  h1 Hello from Beast\n");
    await Bun.write(
      resolve(root, "src", "Native.tsrx"),
      "export function Native() @{\n  <aside>Native TSRX</aside>\n}\n",
    );
    await Bun.write(
      resolve(root, "src", "main.ts"),
      [
        'import { createRoot } from "octane";',
        'import App from "./App.btsx";',
        'import "./Native.tsrx";',
        'createRoot(document.getElementById("app")!).render(App);',
      ].join("\n"),
    );

    await viteBuild({
      root,
      logLevel: "silent",
      plugins: [beastOctane()],
    });

    expect(await readFile(resolve(root, "dist", "index.html"), "utf8")).toContain("/assets/");
  });
});
