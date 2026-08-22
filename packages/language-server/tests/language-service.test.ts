import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Position } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as localCompiler from "../../../src/index.js";

mock.module("beast-tsrx", () => localCompiler);
const { BeastLanguageService } = await import("../src/language-service.js");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function createProject(): Promise<{
  appPath: string;
  cardPath: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "beast-language-server-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "components"));
  const appPath = join(root, "App.btsx");
  const cardPath = join(root, "components", "Card.btsx");
  await writeFile(
    cardPath,
    "props { title, disabled }: { title: string; disabled?: boolean }\narticle.card #{title}\n",
    "utf8",
  );
  return { appPath, cardPath, root };
}

function document(path: string, source: string): TextDocument {
  return TextDocument.create(pathToFileURL(path).href, "beast", 1, source);
}

describe("BeastLanguageService", () => {
  test("completes workspace components with an auto-import edit", async () => {
    const project = await createProject();
    const source = "Ca";
    await writeFile(project.appPath, source, "utf8");
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const items = await service.completions(
      document(project.appPath, source),
      Position.create(0, 2),
    );

    const card = items.find((item) => item.label === "Card");
    expect(card).toBeDefined();
    expect(card?.additionalTextEdits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: 'import Card from "./components/Card.btsx";\n',
      },
    ]);
  });

  test("keeps module directives ahead of completion auto-imports", async () => {
    const project = await createProject();
    const source = [
      "module",
      '  "use strong";',
      "props { title }: { title: string }",
      "Ca",
    ].join("\n");
    await writeFile(project.appPath, source, "utf8");
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const items = await service.completions(
      document(project.appPath, source),
      Position.create(3, 2),
    );

    expect(items.find((item) => item.label === "Card")?.additionalTextEdits).toEqual([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: 'import Card from "./components/Card.btsx";\n',
      },
    ]);
  });

  test("completes relative import paths", async () => {
    const project = await createProject();
    const source = 'import Card from "./components/Ca';
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const items = await service.completions(
      document(project.appPath, source),
      Position.create(0, source.length),
    );

    expect(items.map((item) => item.label)).toContain("./components/Card.btsx");
  });

  test("completes props declared by an imported component", async () => {
    const project = await createProject();
    const source = 'import Card from "./components/Card.btsx";\nCard(ti';
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const items = await service.completions(
      document(project.appPath, source),
      Position.create(1, "Card(ti".length),
    );

    expect(items.map((item) => item.label)).toContain("title");
  });

  test("uses the file component props instead of preceding local component props", async () => {
    const project = await createProject();
    await writeFile(
      project.cardPath,
      [
        "component Badge",
        "  props { tone }: { tone: string }",
        "  span #{tone}",
        "props { title }: { title: string }",
        "article #{title}",
        "",
      ].join("\n"),
      "utf8",
    );
    const source = 'import Card from "./components/Card.btsx";\nCard(t';
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const items = await service.completions(
      document(project.appPath, source),
      Position.create(1, "Card(t".length),
    );

    expect(items.map((item) => item.label)).toContain("title");
    expect(items.map((item) => item.label)).not.toContain("tone");
  });

  test("resolves component definitions and import document links", async () => {
    const project = await createProject();
    const source = 'import Card from "./components/Card.btsx";\nCard(title="Hello")\n';
    await writeFile(project.appPath, source, "utf8");
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const app = document(project.appPath, source);

    const definitions = await service.definitions(app, Position.create(1, 2));
    const links = await service.documentLinks(app);

    expect(definitions[0]?.uri).toBe(pathToFileURL(project.cardPath).href);
    expect(links).toEqual([
      expect.objectContaining({ target: pathToFileURL(project.cardPath).href }),
    ]);
  });

  test("resolves definitions and links for continued imports", async () => {
    const project = await createProject();
    const source = [
      "import Card",
      '  ~ from "./components/Card.btsx";',
      'Card(title="Hello")',
      "",
    ].join("\n");
    await writeFile(project.appPath, source, "utf8");
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const app = document(project.appPath, source);

    const definitions = await service.definitions(app, Position.create(2, 2));
    const links = await service.documentLinks(app);

    expect(definitions[0]?.uri).toBe(pathToFileURL(project.cardPath).href);
    expect(links).toEqual([
      expect.objectContaining({
        range: {
          start: { line: 1, character: 10 },
          end: { line: 1, character: 32 },
        },
        target: pathToFileURL(project.cardPath).href,
      }),
    ]);
  });

  test("reports Beast compiler diagnostics", async () => {
    const project = await createProject();
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const diagnostics = service.diagnostics(document(project.appPath, "fragment\n"));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("BEAST1901_EMPTY_FRAGMENT");
    expect(diagnostics[0]?.source).toBe("beast");
  });

  test("uses the local continuation-aware compiler for diagnostics", async () => {
    const project = await createProject();
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const valid = [
      "module",
      '  const label = "Beast"',
      '    ~ + " LSP";',
      "p #{label}",
      "",
    ].join("\n");
    const invalid = "p Parent\n~ orphan\n";

    expect(service.diagnostics(document(project.appPath, valid))).toEqual([]);
    expect(service.diagnostics(document(project.appPath, invalid))[0]?.code).toBe(
      "BEAST1004_ORPHAN_CONTINUATION",
    );
  });

  test("finds component references across the workspace", async () => {
    const project = await createProject();
    const source = 'import Card from "./components/Card.btsx";\nCard(title="Hello")\n';
    await writeFile(project.appPath, source, "utf8");
    const service = new BeastLanguageService([pathToFileURL(project.root).href]);
    const app = document(project.appPath, source);

    const references = await service.references(app, Position.create(1, 2), true);

    expect(references.some((location) => location.uri === app.uri)).toBe(true);
    expect(
      references.some((location) => location.uri === pathToFileURL(project.cardPath).href),
    ).toBe(true);
  });
});
