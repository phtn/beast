import { lstat, mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { compileBeast, componentNameFromPath } from "./compiler.js";
import type { CompileOptions } from "./compiler.js";

export interface ProjectComponentOptions {
  componentName?: string;
  propsParam?: string;
}

export interface BuildProjectOptions {
  root: string;
  outDir?: string;
  validate?: boolean;
  components?: Readonly<Record<string, ProjectComponentOptions>>;
}

export interface BuiltProjectFile {
  source: string;
  output: string;
  componentName: string;
}

export interface ProjectBuildResult {
  root: string;
  outDir: string;
  generated: BuiltProjectFile[];
  removed: string[];
  validatedNativeTsrx: string[];
  manifestPath: string;
}

interface BuildManifest {
  schemaVersion: 1;
  generated: Array<{
    source: string;
    output: string;
    componentName: string;
  }>;
  validatedNativeTsrx: string[];
}

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".beast",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export async function buildBeastProject(
  options: BuildProjectOptions,
): Promise<ProjectBuildResult> {
  const root = resolve(options.root);
  const outDir = resolve(options.outDir ?? resolve(root, ".beast"));
  if (outDir === root) {
    throw new Error("The Beast project output directory must differ from the source root.");
  }

  const manifestPath = resolve(outDir, "beast-manifest.json");
  const previousOutputs = await readPreviousGeneratedOutputs(manifestPath);
  const files = await collectSourceFiles(root, outDir);
  const generated: BuiltProjectFile[] = [];
  const validatedNativeTsrx: string[] = [];
  const shouldValidate = options.validate ?? true;

  for (const filename of files) {
    const relativeName = toPosix(relative(root, filename));
    if (filename.endsWith(".tsrx")) {
      if (shouldValidate) {
        await validateWithOctane(await readFile(filename, "utf8"), filename);
        validatedNativeTsrx.push(relativeName);
      }
      continue;
    }

    const configured = options.components?.[relativeName];
    const componentName = configured?.componentName ?? componentNameFromPath(filename);
    const compileOptions: CompileOptions = {
      filename,
      componentName,
      ...(configured?.propsParam === undefined ? {} : { propsParam: configured.propsParam }),
    };
    const code = compileBeast(await readFile(filename, "utf8"), compileOptions);
    const outputRelative = relativeName.replace(/\.btsx$/u, ".tsrx");
    const output = resolve(outDir, outputRelative);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, code, "utf8");
    if (shouldValidate) await validateWithOctane(code, output);
    generated.push({ source: relativeName, output: outputRelative, componentName });
  }

  generated.sort((left, right) => left.source.localeCompare(right.source));
  validatedNativeTsrx.sort();
  const removed = await removeStaleGeneratedFiles(
    outDir,
    previousOutputs,
    new Set(generated.map((file) => file.output)),
  );
  await mkdir(outDir, { recursive: true });
  const manifest: BuildManifest = {
    schemaVersion: 1,
    generated: generated.map((file) => ({
      source: file.source,
      output: file.output,
      componentName: file.componentName,
    })),
    validatedNativeTsrx,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { root, outDir, generated, removed, validatedNativeTsrx, manifestPath };
}

async function readPreviousGeneratedOutputs(manifestPath: string): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return [];
    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return [];
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.generated)) {
    return [];
  }

  return value.generated.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.source !== "string" ||
      typeof entry.output !== "string" ||
      !entry.source.endsWith(".btsx") ||
      entry.output !== entry.source.replace(/\.btsx$/u, ".tsrx")
    ) {
      return [];
    }
    return [entry.output];
  });
}

async function removeStaleGeneratedFiles(
  outDir: string,
  previousOutputs: readonly string[],
  currentOutputs: ReadonlySet<string>,
): Promise<string[]> {
  const staleOutputs = [...new Set(previousOutputs)]
    .filter((output) => !currentOutputs.has(output))
    .sort((left, right) => left.localeCompare(right));
  const removed: string[] = [];

  for (const output of staleOutputs) {
    const target = await safeGeneratedFileTarget(outDir, output);
    if (target === null) continue;

    let targetStat: Awaited<ReturnType<typeof lstat>>;
    try {
      targetStat = await lstat(target);
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) continue;
      throw error;
    }
    if (targetStat.isDirectory()) continue;

    try {
      await unlink(target);
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) continue;
      throw error;
    }
    removed.push(output);
    await removeEmptyGeneratedDirectories(dirname(target), outDir);
  }

  return removed;
}

async function safeGeneratedFileTarget(outDir: string, output: string): Promise<string | null> {
  const normalized = toPosix(output);
  const parts = normalized.split("/");
  if (
    !normalized.endsWith(".tsrx") ||
    isAbsolute(output) ||
    isAbsolute(normalized) ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return null;
  }

  const target = resolve(outDir, ...parts);
  const targetRelative = relative(outDir, target);
  if (
    targetRelative.length === 0 ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative)
  ) {
    return null;
  }

  let parent = outDir;
  for (const part of parts.slice(0, -1)) {
    parent = resolve(parent, part);
    try {
      const parentStat = await lstat(parent);
      if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) return null;
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return target;
      throw error;
    }
  }
  return target;
}

async function removeEmptyGeneratedDirectories(directory: string, outDir: string): Promise<void> {
  let current = directory;
  while (current !== outDir) {
    const currentRelative = relative(outDir, current);
    if (
      currentRelative === ".." ||
      currentRelative.startsWith(`..${sep}`) ||
      isAbsolute(currentRelative)
    ) {
      return;
    }
    try {
      await rmdir(current);
    } catch (error) {
      if (
        isFileSystemError(error, "ENOENT") ||
        isFileSystemError(error, "ENOTEMPTY") ||
        isFileSystemError(error, "EEXIST")
      ) {
        return;
      }
      throw error;
    }
    current = dirname(current);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function collectSourceFiles(root: string, outDir: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (path === outDir) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path);
      } else if (entry.isFile() && (entry.name.endsWith(".btsx") || entry.name.endsWith(".tsrx"))) {
        result.push(path);
      }
    }
  }
  await visit(root);
  return result;
}

async function validateWithOctane(source: string, filename: string): Promise<void> {
  let compiler: typeof import("octane/compiler");
  try {
    compiler = await import("octane/compiler");
  } catch (error) {
    throw new Error(
      "Octane validation requires the optional `octane` peer dependency. Install the pinned supported version or build with validation disabled.",
      { cause: error },
    );
  }
  compiler.compile(source, filename, { mode: "client", hmr: false, dev: false });
}

function toPosix(path: string): string {
  return path.split(/[/\\]/u).join("/");
}

export function resolveProjectPath(root: string, configuredPath: string): string {
  return isAbsolute(configuredPath) ? configuredPath : resolve(root, configuredPath);
}
