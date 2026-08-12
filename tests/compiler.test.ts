import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "octane/compiler";
import {
  BeastCompileError,
  compileBeast,
  compileBeastResult,
  componentNameFromPath,
} from "../src/index.js";

function getCompileError(source: string, filename = "Invalid.btsx"): BeastCompileError {
  try {
    compileBeast(source, { filename });
  } catch (error) {
    if (error instanceof BeastCompileError) return error;
    throw error;
  }
  throw new Error("Expected Beast compilation to fail.");
}

const GOLDEN_FIXTURES = (await readdir(resolve("examples"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe("BTSX to TSRX", () => {
  test.each(GOLDEN_FIXTURES)("matches the %s golden fixture", async (fixture) => {
    const directory = resolve("examples", fixture);
    const filename = resolve(directory, `${fixture}.btsx`);
    const source = await readFile(filename, "utf8");
    const expected = await readFile(resolve(directory, `${fixture}.tsrx`), "utf8");
    const actual = compileBeast(source, { filename });
    expect(actual).toBe(expected);
    const octane = compile(actual, filename.replace(/\.btsx$/u, ".tsrx"), {
      mode: "client",
      hmr: false,
    });
    expect(octane.diagnostics).toHaveLength(0);
    expect(octane.code.length).toBeGreaterThan(0);
  });

  test("supports explicit Octane loop keys", () => {
    const output = compileBeast("each item, i in items key item.id\n  li #{item.name}\n", {
      filename: "List.btsx",
    });
    expect(output).toContain("@for (const item of items; index i; key item.id)");
  });

  test("emits Octane empty branches for loops", () => {
    const result = compileBeastResult(
      "each item in items key item.id\n  Row(item={item})\nempty\n  p No items.\n",
      { filename: "List.btsx" },
    );

    expect(result.code).toContain(
      "\t@for (const item of items; key item.id) {\n\t\t<Row item={item} />\n\t} @empty {\n\t\t<p>No items.</p>\n\t}",
    );
    const loop = result.ast.children[0];
    expect(loop?.kind).toBe("each");
    if (loop?.kind === "each") expect(loop.emptyChildren).toHaveLength(1);
  });

  test("preserves dotted component APIs without changing class shorthand", () => {
    const output = compileBeast(
      "Theme.Provider(value={theme})\n  Card.featured Featured\n",
      { filename: "ThemeShell.btsx" },
    );

    expect(output).toContain('<Theme.Provider value={theme}>');
    expect(output).toContain('<Card className="featured">Featured</Card>');
    expect(output).toContain("</Theme.Provider>");
  });

  test.each([
    ["orphan empty", "empty\n  p Nothing\n", "BEAST1407_ORPHAN_EMPTY"],
    [
      "empty empty branch",
      "each item in items\n  p #{item}\nempty\np After\n",
      "BEAST1408_EMPTY_EMPTY_BRANCH",
    ],
  ])("reports invalid loop syntax for %s", (_label, source, code) => {
    const error = getCompileError(source, "InvalidLoop.btsx");
    expect(error.diagnostic.code).toBe(code);
  });

  test("emits isolated Octane switch arms", () => {
    const result = compileBeastResult(
      [
        "switch status",
        '  case "ready"',
        "    ReadyView",
        '  case "loading"',
        "    LoadingView",
        "  default",
        "    UnknownView",
      ].join("\n"),
      { filename: "StatusView.btsx" },
    );

    expect(result.code).toContain(
      '\t@switch (status) {\n\t\t@case "ready": {\n\t\t\t<ReadyView />\n\t\t}',
    );
    expect(result.code).toContain("\t\t@default: {\n\t\t\t<UnknownView />\n\t\t}");
    const node = result.ast.children[0];
    expect(node?.kind).toBe("switch");
    if (node?.kind === "switch") {
      expect(node.discriminant).toBe("status");
      expect(node.branches.map((branch) => branch.test)).toEqual([
        '"ready"',
        '"loading"',
        null,
      ]);
    }
  });

  test.each([
    ["empty switch", "switch\n", "BEAST1601_EMPTY_SWITCH"],
    ["empty switch body", "switch status\n", "BEAST1602_EMPTY_SWITCH_BODY"],
    [
      "invalid direct child",
      "switch status\n  p Not an arm\n",
      "BEAST1603_INVALID_SWITCH_ARM",
    ],
    [
      "empty case expression",
      "switch status\n  case\n    p Missing expression\n",
      "BEAST1604_EMPTY_CASE",
    ],
    [
      "duplicate default",
      "switch status\n  default\n    p First\n  default\n    p Second\n",
      "BEAST1605_DUPLICATE_DEFAULT",
    ],
    [
      "empty switch arm",
      'switch status\n  case "ready"\n  default\n    p Other\n',
      "BEAST1606_EMPTY_SWITCH_ARM",
    ],
    [
      "orphan case",
      'case "ready"\n  p Ready\n',
      "BEAST1607_ORPHAN_SWITCH_ARM",
    ],
    ["orphan default", "default\n  p Other\n", "BEAST1607_ORPHAN_SWITCH_ARM"],
  ])("reports invalid switch syntax for %s", (_label, source, code) => {
    const error = getCompileError(source, "InvalidSwitch.btsx");
    expect(error.diagnostic.code).toBe(code);
  });

  test("emits pending and catch boundaries with optional bindings", () => {
    const result = compileBeastResult(
      [
        "try",
        "  Profile(data={data})",
        "pending",
        "  p Loading profile…",
        "catch (error, reset)",
        '  button(type="button" onClick={reset}) #{String(error)}',
      ].join("\n"),
      { filename: "ProfileBoundary.btsx" },
    );

    expect(result.code).toContain(
      "\t@try {\n\t\t<Profile data={data} />\n\t} @pending {\n\t\t<p>Loading profile…</p>\n\t} @catch (error, reset) {",
    );
    const node = result.ast.children[0];
    expect(node?.kind).toBe("try");
    if (node?.kind === "try") {
      expect(node.pendingBranch?.children).toHaveLength(1);
      expect(node.catchBranch?.bindings).toBe("error, reset");
    }
  });

  test.each([
    ["pending only", "try\n  Profile\npending\n  p Loading\n", "@pending {"],
    ["catch only", "try\n  Profile\ncatch\n  p Failed\n", "@catch {"],
    [
      "unwrapped catch bindings",
      "try\n  Profile\ncatch error, reset\n  button(onClick={reset}) #{String(error)}\n",
      "@catch (error, reset) {",
    ],
  ])("supports %s try boundaries", (_label, source, expected) => {
    expect(compileBeast(source, { filename: "Boundary.btsx" })).toContain(expected);
  });

  test.each([
    ["invalid try header", "try value\n  p Value\n", "BEAST1701_INVALID_TRY_HEADER"],
    ["empty try body", "try\npending\n  p Loading\n", "BEAST1702_EMPTY_TRY_BODY"],
    [
      "missing continuation",
      "try\n  p Content\np After\n",
      "BEAST1703_MISSING_TRY_BRANCH",
    ],
    [
      "invalid pending header",
      "try\n  p Content\npending value\n  p Loading\n",
      "BEAST1704_INVALID_PENDING_HEADER",
    ],
    [
      "empty pending branch",
      "try\n  p Content\npending\n",
      "BEAST1705_EMPTY_PENDING_BRANCH",
    ],
    [
      "empty catch bindings",
      "try\n  p Content\ncatch ()\n  p Failed\n",
      "BEAST1706_INVALID_CATCH_BINDINGS",
    ],
    [
      "empty catch branch",
      "try\n  p Content\ncatch error\n",
      "BEAST1707_EMPTY_CATCH_BRANCH",
    ],
    [
      "pending after catch",
      "try\n  p Content\ncatch\n  p Failed\npending\n  p Loading\n",
      "BEAST1708_PENDING_AFTER_CATCH",
    ],
    [
      "duplicate pending",
      "try\n  p Content\npending\n  p One\npending\n  p Two\n",
      "BEAST1709_DUPLICATE_PENDING",
    ],
    [
      "duplicate catch",
      "try\n  p Content\ncatch\n  p One\ncatch error\n  p Two\n",
      "BEAST1710_DUPLICATE_CATCH",
    ],
    ["orphan pending", "pending\n  p Loading\n", "BEAST1711_ORPHAN_TRY_BRANCH"],
    ["orphan catch", "catch error\n  p Failed\n", "BEAST1711_ORPHAN_TRY_BRANCH"],
  ])("reports invalid try syntax for %s", (_label, source, code) => {
    const error = getCompileError(source, "InvalidBoundary.btsx");
    expect(error.diagnostic.code).toBe(code);
  });

  test("emits source-level module and component declarations", () => {
    const result = compileBeastResult(
      [
        'import type { User } from "./types.ts";',
        'import Avatar from "./Avatar.btsx";',
        "props { user }: { user: User };",
        "setup const label = user.name;",
        "Avatar(user={user} label={label})",
      ].join("\n"),
      { filename: "Profile.btsx" },
    );

    expect(result.code).toStartWith(
      [
        'import type { User } from "./types.ts";',
        'import Avatar from "./Avatar.btsx";',
        "",
        "export default function Profile({ user }: { user: User }) @{",
      ].join("\n"),
    );
    expect(result.code).toContain("\n\tconst label = user.name;\n\n\t<Avatar");
    expect(result.ast.declarations.map((declaration) => declaration.kind)).toEqual([
      "import",
      "import",
      "props",
      "setup",
    ]);
  });

  test("lets explicit compile options override source-level props", () => {
    const output = compileBeast("props { value }: { value: string }\np #{value}\n", {
      filename: "Value.btsx",
      propsParam: "{ value }: { value: number }",
    });
    expect(output).toStartWith(
      "export default function Value({ value }: { value: number }) @{\n",
    );
  });

  test("rejects duplicate and misplaced declarations", () => {
    const duplicate = getCompileError(
      "props { one }: { one: string }\nprops { two }: { two: string }\np Hi\n",
      "Duplicate.btsx",
    );
    expect(duplicate.diagnostic.code).toBe("BEAST1501_DUPLICATE_PROPS");

    const misplaced = getCompileError(
      'p Hi\nimport Thing from "./Thing.btsx";\n',
      "Misplaced.btsx",
    );
    expect(misplaced.diagnostic.code).toBe("BEAST1503_MISPLACED_DECLARATION");

    const misplacedSetup = getCompileError("p Hi\nsetup const value = 1;\n", "Setup.btsx");
    expect(misplacedSetup.diagnostic.code).toBe("BEAST1503_MISPLACED_DECLARATION");
  });

  test.each([
    ["empty props", "props\n", "BEAST1502_EMPTY_PROPS"],
    ["empty import", "import\n", "BEAST1504_EMPTY_IMPORT"],
    ["empty setup", "setup\n", "BEAST1505_EMPTY_SETUP"],
  ])("reports invalid declaration syntax for %s", (_label, source, code) => {
    const error = getCompileError(source, "InvalidDeclaration.btsx");
    expect(error.diagnostic.code).toBe(code);
    expect(error.diagnostic.span.start.line).toBe(1);
  });

  test("keeps short parameters inline and preserves embedded expressions", () => {
    const output = compileBeast("if status === \"ready\"\n  p Ready\n", {
      filename: "State.btsx",
      propsParam: "{ status }: { status: string }",
    });
    expect(output).toStartWith(
      "export default function State({ status }: { status: string }) @{\n",
    );
    expect(output).toContain('@if (status === "ready") {');
  });

  test("wraps multiple root outputs in a fragment", () => {
    const output = compileBeast("h1 One\np Two\n", { filename: "Pair.btsx" });
    expect(output).toContain("<>\n\t\t<h1>One</h1>\n\t\t<p>Two</p>\n\t</>");
  });

  test("reports source-located indentation errors", () => {
    expect(() => compileBeast("div\n\tspan Nope\n", { filename: "bad.btsx" })).toThrow(
      BeastCompileError,
    );
    try {
      compileBeast("div\n\tspan Nope\n", { filename: "bad.btsx" });
    } catch (error) {
      expect(error).toBeInstanceOf(BeastCompileError);
      expect((error as BeastCompileError).diagnostic.code).toBe("BEAST1003_TAB_INDENT");
      expect((error as BeastCompileError).diagnostic.span.start.line).toBe(2);
    }
  });

  test("sanitizes component names derived from filenames", () => {
    expect(componentNameFromPath("123-user.card.btsx")).toBe("Beast123UserCard");
  });
});
