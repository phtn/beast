import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "octane/compiler";
import {
  BeastCompileError,
  compileBeast,
  componentNameFromPath,
} from "../src/index.js";

const CARD_PROPS =
  "{ user, unreadCount, messages }: { user: { name: string; id: string; isAdmin: boolean }; unreadCount: number; messages: { id: string; text: string }[] }";
const STATUS_PROPS =
  "{ groups }: { groups: { id: string; title: string; status: string; items: { label: string; value: string }[] }[] }";

describe("BTSX to TSRX", () => {
  test.each([
    ["card", "Card", CARD_PROPS],
    ["status", "Status", STATUS_PROPS],
  ])("matches the %s golden fixture", async (fixture, componentName, propsParam) => {
    const directory = resolve("examples", fixture);
    const filename = resolve(directory, `${fixture}.btsx`);
    const source = await readFile(filename, "utf8");
    const expected = await readFile(resolve(directory, `${fixture}.tsrx`), "utf8");
    const actual = compileBeast(source, { filename, componentName, propsParam });
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

  test("wraps multiple root outputs in a fragment", () => {
    const output = compileBeast("h1 One\np Two\n", { filename: "Pair.btsx" });
    expect(output).toContain("<>\n    <h1>One</h1>\n    <p>Two</p>\n  </>");
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
