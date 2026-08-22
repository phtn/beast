import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { compile } from "octane/compiler";
import {
  getSsrSuspenseTimeout,
  renderToPipeableStream,
  renderToReadableStream,
  renderToStaticMarkup,
  renderToString,
  setSsrSuspenseTimeout,
} from "octane/server";
import { prerender, prerenderToNodeStream } from "octane/static";
import { compileBeast } from "../src/index.js";

type CompiledComponent = Parameters<typeof renderToString>[0];

interface ProfileData {
  name: string;
  role: string;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function fulfilledProfile(name: string, role: string): PromiseLike<ProfileData> & {
  status: "fulfilled";
  value: ProfileData;
} {
  return {
    status: "fulfilled",
    value: { name, role },
    then() {},
  } as unknown as PromiseLike<ProfileData> & {
    status: "fulfilled";
    value: ProfileData;
  };
}

function rewriteServerImports(code: string): string {
  let executable = code;
  for (const specifier of ["octane/hydration", "octane/server"]) {
    const resolved = JSON.stringify(import.meta.resolve(specifier));
    executable = executable
      .replaceAll(JSON.stringify(specifier), resolved)
      .replaceAll(`'${specifier}'`, resolved);
  }
  return executable;
}

async function loadCompiledComponent(source: string, filename: string): Promise<CompiledComponent> {
  const tsrx = compileBeast(source, { filename });
  const result = compile(tsrx, filename.replace(/\.btsx$/u, ".tsrx"), {
    mode: "server",
    hmr: false,
    dev: true,
  });
  expect(result.diagnostics).toHaveLength(0);
  const executable = rewriteServerImports(result.code);
  expect(executable).not.toBe(result.code);

  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "beast-renderer-test-"));
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

async function loadFixture(name: string): Promise<CompiledComponent> {
  const filename = resolve("examples", name, `${name}.btsx`);
  return loadCompiledComponent(await readFile(filename, "utf8"), filename);
}

async function readNodeStream(stream: Readable): Promise<string> {
  let output = "";
  for await (const chunk of stream) {
    output += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  }
  return output;
}

async function readWebStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return output + decoder.decode();
    output += decoder.decode(value, { stream: true });
  }
}

describe("Octane server and static renderers", () => {
  test("distinguishes hydratable and static markup and preserves render channels", async () => {
    const AsyncProfile = await loadFixture("async");
    const Styling = await loadFixture("styling");
    const profile = fulfilledProfile("Ada", "Engineer");

    const hydratable = renderToString(AsyncProfile, { profile }, { nonce: "beast-nonce" });
    const staticMarkup = renderToStaticMarkup(AsyncProfile, { profile });
    expect(hydratable.html).toContain("<!--[-->");
    expect(hydratable.html).toContain('data-octane-suspense nonce="beast-nonce"');
    expect(staticMarkup.html).toContain("<h2>Ada</h2><p>Engineer</p>");
    expect(staticMarkup.html).not.toContain("<!--");
    expect(staticMarkup.html).not.toContain("data-octane-suspense");

    const styled = renderToStaticMarkup(Styling, {
      title: "Static styling",
      cardProps: { "data-channel": "static" },
    }, { nonce: "beast-nonce" });
    expect(styled.html).toContain('data-channel="static"');
    expect(styled.css).toContain('data-octane="tsrx-');
    expect(styled.css).toContain('nonce="beast-nonce"');

    const headSource = [
      "props { title }: { title: string }",
      "fragment",
      "  title #{title}",
      "  main",
      "    h1 #{title}",
      "",
    ].join("\n");
    const HeadPage = await loadCompiledComponent(
      headSource,
      resolve("tests/fixtures/HeadPage.btsx"),
    );
    const folded = renderToString(HeadPage, { title: "Beast renderer" });
    const separated = renderToString(
      HeadPage,
      { title: "Beast renderer" },
      { headChannel: "separate" },
    );
    expect(folded.html.indexOf("<title")).toBeLessThan(folded.html.indexOf("<main>"));
    expect(separated.html).not.toContain("<title");
    expect(separated.head).toContain("Beast renderer</title>");
  });

  test("prerender awaits data while timeout and abort controls bound the work", async () => {
    const AsyncProfile = await loadFixture("async");
    const profile = deferred<ProfileData>();
    const pending = prerender(AsyncProfile, { profile: profile.promise });
    profile.resolve({ name: "Grace", role: "Compiler pioneer" });
    const rendered = await pending;
    expect(rendered.html).toContain("<h2>Grace</h2><p>Compiler pioneer</p>");
    expect(rendered.html).not.toContain("Loading profile…");

    const originalTimeout = getSsrSuspenseTimeout();
    try {
      setSsrSuspenseTimeout(7);
      expect(getSsrSuspenseTimeout()).toBe(7);
      await expect(prerender(AsyncProfile, {
        profile: new Promise<ProfileData>(() => {}),
      })).rejects.toThrow("7ms");

      setSsrSuspenseTimeout(1_000);
      await expect(prerender(
        AsyncProfile,
        { profile: new Promise<ProfileData>(() => {}) },
        { timeoutMs: 5 },
      )).rejects.toThrow("5ms");

      const controller = new AbortController();
      const reason = new Error("request closed");
      const aborted = prerender(
        AsyncProfile,
        { profile: new Promise<ProfileData>(() => {}) },
        { signal: controller.signal, timeoutMs: 0 },
      );
      controller.abort(reason);
      await expect(aborted).rejects.toBe(reason);
    } finally {
      setSsrSuspenseTimeout(originalTimeout);
    }
    expect(getSsrSuspenseTimeout()).toBe(originalTimeout);
  });

  test("renderToPipeableStream sends a shell and its resolved boundary through Node", async () => {
    const AsyncProfile = await loadFixture("async");
    const profile = deferred<ProfileData>();
    const shellReady = deferred<void>();
    const allReady = deferred<void>();
    const errors: unknown[] = [];
    const destination = new PassThrough();
    const output = readNodeStream(destination);
    const stream = renderToPipeableStream(
      AsyncProfile,
      { profile: profile.promise },
      {
        onShellReady: shellReady.resolve,
        onAllReady: allReady.resolve,
        onError: (error) => errors.push(error),
      },
    );

    expect(stream.pipe(destination)).toBe(destination);
    expect(typeof stream.abort).toBe("function");
    await shellReady.promise;
    profile.resolve({ name: "Lin", role: "Streamed profile" });
    await allReady.promise;
    const html = await output;

    expect(html).toContain("Loading profile…");
    expect(html).toContain("<h2>Lin</h2><p>Streamed profile</p>");
    expect(errors).toEqual([]);
  });

  test("renderToReadableStream exposes a shell and allReady under Web backpressure", async () => {
    const AsyncProfile = await loadFixture("async");
    const profile = deferred<ProfileData>();
    const callbacks: string[] = [];
    const stream = await renderToReadableStream(
      AsyncProfile,
      { profile: profile.promise },
      {
        onShellReady: () => callbacks.push("shell"),
        onAllReady: () => callbacks.push("all"),
      },
    );
    const output = readWebStream(stream);
    profile.resolve({ name: "Margaret", role: "Web stream" });
    await stream.allReady;
    const html = await output;

    expect(html).toContain("Loading profile…");
    expect(html).toContain("<h2>Margaret</h2><p>Web stream</p>");
    expect(callbacks).toEqual(["shell", "all"]);
  });

  test("prerenderToNodeStream emits the complete await-everything prelude", async () => {
    const AsyncProfile = await loadFixture("async");
    const profile = deferred<ProfileData>();
    const streamPromise = prerenderToNodeStream(AsyncProfile, { profile: profile.promise });
    profile.resolve({ name: "Katherine", role: "Static stream" });
    const { prelude } = await streamPromise;
    const html = await readNodeStream(prelude);

    expect(html).toContain("<h2>Katherine</h2><p>Static stream</p>");
    expect(html).not.toContain("Loading profile…");
  });
});
