import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createProject } from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "create-beast-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("create-beast", () => {
  test("creates a complete project without installing or initializing Git", async () => {
    const cwd = await temporaryDirectory();
    const result = await createProject({
      cwd,
      directory: "My Beast App",
      install: false,
      git: false,
      compilerSpec: "file:/local/beast-tsrx.tgz",
    });

    expect(result.packageName).toBe("my-beast-app");
    expect(result.installed).toBe(false);
    expect(result.gitInitialized).toBe(false);
    expect(await readFile(resolve(result.directory, ".gitignore"), "utf8")).toContain(
      "node_modules/",
    );

    const packageJson = JSON.parse(
      await readFile(resolve(result.directory, "package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(packageJson.name).toBe("my-beast-app");
    expect(packageJson.dependencies["beast-tsrx"]).toBe("file:/local/beast-tsrx.tgz");
    const app = await readFile(resolve(result.directory, "src", "App.btsx"), "utf8");
    expect(app).toContain("props { title, links }: Props");
    expect(app).toContain("interface Props");
    expect(app).toContain("BTSX → TSRX → Octane");
    expect(app).toContain("each link in links key link.id");
    expect(await readFile(resolve(result.directory, "vite.config.ts"), "utf8")).toContain(
      "plugins: [beastOctane()]",
    );
    const main = await readFile(resolve(result.directory, "src", "main.ts"), "utf8");
    expect(main).toContain("links");
    expect(main).toContain("Beast → Octane");
  });

  test("refuses a non-empty directory unless force is explicit", async () => {
    const cwd = await temporaryDirectory();
    const target = resolve(cwd, "existing");
    await Bun.write(resolve(target, "mine.txt"), "keep me");

    await expect(
      createProject({ cwd, directory: "existing", install: false, git: false }),
    ).rejects.toThrow("Target directory is not empty");

    await createProject({
      cwd,
      directory: "existing",
      install: false,
      git: false,
      force: true,
    });
    expect(await readFile(resolve(target, "mine.txt"), "utf8")).toBe("keep me");
  });
});
