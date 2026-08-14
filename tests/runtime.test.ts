import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "octane/compiler";
import { renderToString } from "octane/server";
import { Window } from "happy-dom";
import { compileBeast } from "../src/index.js";

type CompiledComponent = Parameters<typeof renderToString>[0];
type CompileMode = "client" | "server";

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
  "HTMLOptionElement",
  "HTMLSelectElement",
  "HTMLTemplateElement",
  "HTMLTextAreaElement",
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

const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
let browser: Window;

function installDom(): void {
  browser = new Window({ url: "https://beast.test/" });
  const values = browser as unknown as Record<string, unknown>;

  for (const name of ["window", "self", "document", ...DOM_GLOBALS]) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    const value = name === "window" || name === "self"
      ? browser
      : name === "document"
        ? browser.document
        : values[name];
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  for (const name of ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"] as const) {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: browser[name].bind(browser),
    });
  }
}

function restoreDom(): void {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor === undefined) delete (globalThis as Record<string, unknown>)[name];
    else Object.defineProperty(globalThis, name, descriptor);
  }
  originalGlobals.clear();
  browser.close();
}

function rewriteRuntimeImports(code: string, mode: CompileMode): string {
  const specifiers = mode === "client"
    ? ["octane/hydration", "octane"]
    : ["octane/hydration", "octane/server"];
  let executable = code;

  for (const specifier of specifiers) {
    const resolved = JSON.stringify(import.meta.resolve(specifier));
    executable = executable
      .replaceAll(JSON.stringify(specifier), resolved)
      .replaceAll(`'${specifier}'`, resolved);
  }

  return executable;
}

async function loadCompiledComponent(
  source: string,
  filename: string,
  mode: CompileMode,
): Promise<CompiledComponent> {
  const tsrx = compileBeast(source, { filename });
  const result = compile(tsrx, filename.replace(/\.btsx$/u, ".tsrx"), {
    mode,
    hmr: false,
    dev: true,
  });
  expect(result.diagnostics).toHaveLength(0);

  const executable = rewriteRuntimeImports(result.code, mode);
  expect(executable).not.toBe(result.code);

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), `beast-${mode}-test-`));
  const modulePath = resolve(temporaryDirectory, `${basename(filename, ".btsx")}.mjs`);
  try {
    await writeFile(modulePath, executable, "utf8");
    const module = (await import(pathToFileURL(modulePath).href)) as {
      default: CompiledComponent;
    };
    return module.default;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function loadFixture(name: string, mode: CompileMode): Promise<CompiledComponent> {
  const filename = resolve("examples", name, `${name}.btsx`);
  return loadCompiledComponent(await readFile(filename, "utf8"), filename, mode);
}

function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} in the test DOM.`);
  return element;
}

function click(element: Element): void {
  element.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true }));
}

beforeAll(installDom);

beforeEach(() => {
  browser.document.head.replaceChildren();
  browser.document.body.replaceChildren();
});

afterAll(restoreDom);

describe("Octane client lifecycle", () => {
  test("createRoot, act, flushSync, prop updates, and unmount execute compiled BTSX", async () => {
    const Counter = await loadFixture("counter", "client");
    const { act, createRoot, flushSync } = await import("octane");
    const container = browser.document.createElement("div");
    browser.document.body.append(container);
    const observed: number[] = [];
    const onCountChange = (count: number) => observed.push(count);
    const root = createRoot(container, { identifierPrefix: "beast-client-" });

    await act(() => root.render(Counter, { initialCount: 1, step: 1, onCountChange }));

    const section = requiredElement<HTMLElement>(container, "section.counter");
    const buttons = container.querySelectorAll("button");
    expect(section.textContent).toContain("Current: 1");
    expect(section.textContent).toContain("Doubled: 2");
    expect(observed).toEqual([1]);

    flushSync(() => click(buttons[1]!));
    expect(section.textContent).toContain("Current: 2");
    expect(observed).toEqual([1]);
    await act(() => {});
    expect(observed).toEqual([1, 2]);

    await act(() => click(buttons[0]!));
    expect(section.textContent).toContain("Current: 1");
    expect(observed).toEqual([1, 2, 1]);

    await act(() => root.render(Counter, { initialCount: 99, step: 2, onCountChange }));
    expect(requiredElement(container, "section.counter")).toBe(section);
    flushSync(() => click(buttons[1]!));
    expect(section.textContent).toContain("Current: 3");
    await act(() => {});
    expect(observed).toEqual([1, 2, 1, 3]);

    root.unmount();
    expect(container.childNodes).toHaveLength(0);
  });

  test("hydrateRoot adopts server DOM and keeps it interactive", async () => {
    const ServerCounter = await loadFixture("counter", "server");
    const ClientCounter = await loadFixture("counter", "client");
    const { act, hydrateRoot } = await import("octane");
    const container = browser.document.createElement("div");
    const server = renderToString(ServerCounter, {
      initialCount: 4,
      step: 2,
      onCountChange() {},
    });
    container.innerHTML = server.html;
    browser.document.body.append(container);
    const serverSection = requiredElement(container, "section.counter");
    const observed: number[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;

    await act(() => {
      root = hydrateRoot(container, ClientCounter, {
        initialCount: 4,
        step: 2,
        onCountChange: (count: number) => observed.push(count),
      });
    });

    expect(requiredElement(container, "section.counter")).toBe(serverSection);
    expect(observed).toEqual([4]);
    const increase = container.querySelectorAll("button")[1]!;
    await act(() => click(increase));
    expect(serverSection.textContent).toContain("Current: 6");
    expect(serverSection.textContent).toContain("Doubled: 12");

    root!.unmount();
    expect(container.childNodes).toHaveLength(0);
  });

  test("an interaction boundary adopts dormant HTML, activates, and replays intent", async () => {
    const source = [
      'import { Hydrate } from "octane";',
      'import { interaction } from "octane/hydration";',
      "props { onHydrated, onActivate }: { onHydrated: () => void; onActivate: () => void }",
      "",
      'Hydrate(when={interaction({ events: "click" })} split={false} onHydrated={onHydrated})',
      '  button#activate(type="button" onClick={onActivate}) Activate',
      "",
    ].join("\n");
    const filename = resolve("tests/fixtures/DeferredActivation.btsx");
    const ServerBoundary = await loadCompiledComponent(source, filename, "server");
    const ClientBoundary = await loadCompiledComponent(source, filename, "client");
    const { act, hydrateRoot } = await import("octane");
    const server = renderToString(ServerBoundary, { onHydrated() {}, onActivate() {} });
    const container = browser.document.createElement("div");
    container.innerHTML = server.html;
    browser.document.body.append(container);
    const wrapper = requiredElement<HTMLElement>(container, "[data-octane-hydrate-id]");
    const serverButton = requiredElement<HTMLButtonElement>(wrapper, "#activate");
    let hydrated = 0;
    let activated = 0;
    let root: ReturnType<typeof hydrateRoot> | undefined;

    await act(() => {
      root = hydrateRoot(container, ClientBoundary, {
        onHydrated: () => hydrated++,
        onActivate: () => activated++,
      });
    });

    expect(hydrated).toBe(0);
    expect(wrapper.getAttribute("data-octane-hydrate-when")).toBe("interaction");
    expect(requiredElement(wrapper, "#activate")).toBe(serverButton);

    await act(() => click(serverButton));

    expect(hydrated).toBe(1);
    expect(activated).toBe(1);
    expect(requiredElement(wrapper, "#activate")).toBe(serverButton);
    expect(wrapper.hasAttribute("data-octane-hydrate-when")).toBe(false);

    root!.unmount();
  });

  test("a portal mounts outside the root and preserves logical event ancestry", async () => {
    const Portal = await loadFixture("portal", "client");
    const { act, createRoot } = await import("octane");
    const container = browser.document.createElement("div");
    const portalTarget = browser.document.createElement("div");
    browser.document.body.append(container, portalTarget);
    let dismissals = 0;
    let bubbles = 0;
    const root = createRoot(container);

    await act(() => root.render(Portal, {
      target: portalTarget,
      onDismiss: () => dismissals++,
      onBubble: () => bubbles++,
    }));

    expect(requiredElement(container, "section.editor")).toBeTruthy();
    const toast = requiredElement<HTMLElement>(portalTarget, "aside.toast");
    await act(() => click(requiredElement(toast, "button")));
    expect(dismissals).toBe(1);
    expect(bubbles).toBe(1);

    root.unmount();
    expect(container.childNodes).toHaveLength(0);
    expect(portalTarget.childNodes).toHaveLength(0);
  });
});

describe("Octane behavior roots", () => {
  test("adopts an externally owned range and disposes without changing its DOM", async () => {
    const { attachBehaviorRoot } = await import("octane/behavior");
    const container = browser.document.createElement("main");
    container.innerHTML = '<article data-owner><button data-action type="button">Run</button></article>';
    browser.document.body.append(container);
    const article = requiredElement<HTMLElement>(container, "[data-owner]");
    const button = requiredElement<HTMLButtonElement>(article, "[data-action]");
    const originalMarkup = container.innerHTML;
    const owner = { name: "independent-stream" };
    let releaseRange!: () => void;
    const rangeReady = new Promise<void>((resolveReady) => {
      releaseRange = resolveReady;
    });
    const root = attachBehaviorRoot(container);
    const range = root.registerExternalRange(article, { owner, ready: rangeReady });
    const adoptions: Element[] = [];
    const cleanups: Element[] = [];
    const events: Event[] = [];
    const registration = root.registerBehavior({
      id: "run-action",
      owner,
      target: "[data-action]",
      events: ["click"],
      adopt(element, context) {
        expect(context.range).toBe(range);
        adoptions.push(element);
        return () => cleanups.push(element);
      },
      handleEvent(event, element, context) {
        expect(element).toBe(button);
        expect(context.range).toBe(range);
        events.push(event);
      },
    });

    expect(adoptions).toEqual([]);
    releaseRange();
    await Promise.all([range.ready, registration.ready, root.ready]);
    expect(adoptions).toEqual([button]);

    click(button);
    expect(events).toHaveLength(1);
    registration.dispose();
    expect(cleanups).toEqual([button]);
    click(button);
    expect(events).toHaveLength(1);

    range.dispose();
    root.dispose();
    expect(container.innerHTML).toBe(originalMarkup);
    expect(root.signal.aborted).toBe(true);
  });
});
