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
    expect(await readFile(resolve(result.directory, "src/style.css"), "utf8")).not.toContain(
      "@import \"tailwindcss\"",
    );
    expect(await readFile(resolve(result.directory, "src/style.css"), "utf8")).not.toContain(
      "@import 'tailwindcss'",
    );
    const main = await readFile(resolve(result.directory, "src", "main.ts"), "utf8");
    expect(main).toContain("links");
    expect(main).toContain("Beast → Octane");
  });

  test("creates a Tailwind project with dedicated template", async () => {
    const cwd = await temporaryDirectory();
    const result = await createProject({
      cwd,
      directory: "my-tailwind-app",
      install: false,
      git: false,
      tailwind: true,
      compilerSpec: "file:/local/beast-tsrx.tgz",
    });

    expect(result.packageName).toBe("my-tailwind-app");
    const packageJson = JSON.parse(
      await readFile(resolve(result.directory, "package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };
    expect(packageJson.devDependencies["tailwindcss"]).toBe("^4.1.8");
    expect(packageJson.devDependencies["@tailwindcss/vite"]).toBe("^4.1.8");
    const viteConfig = await readFile(resolve(result.directory, "vite.config.ts"), "utf8");
    expect(viteConfig).toContain('import tailwindcss from "@tailwindcss/vite"');
    expect(viteConfig).toContain("plugins: [tailwindcss(), beastOctane()]");
    const style = await readFile(resolve(result.directory, "src/style.css"), "utf8");
    expect(style).toContain('@import "tailwindcss"');
    const app = await readFile(resolve(result.directory, "src", "App.btsx"), "utf8");
    expect(app).toContain("props { source, direction, output, links }: Props");
    expect(app).toContain("Header(source=");
    expect(app).toContain("flex flex-col");
    const header = await readFile(resolve(result.directory, "src/Header.btsx"), "utf8");
    expect(header).toContain("props { source, direction, output }: HeaderProps");
    expect(header).toContain("-skew-6");
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
