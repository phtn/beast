#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBeast, componentNameFromPath } from "./compiler.js";
import { BeastCompileError, formatDiagnostic } from "./diagnostics.js";
import { buildBeastProject, watchBeastProject } from "./project.js";

const HELP = `Beast — compile indentation-based BTSX to Octane TSRX

Usage:
  beast compile <input.btsx> [-o output.tsrx] [--props <parameter>] [--no-validate]
  beast <input.btsx> [output.tsrx] [--props <parameter>] [--no-validate]
  beast build [source-dir] [--out-dir <directory>] [--no-validate] [--watch]
  beast --help

Commands:
  compile  Compile one BTSX component to TSRX.
  build    Compile every BTSX file in a source tree and validate native TSRX.
`;

export async function runCli(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }

  try {
    if (argv[0] === "build") return await runBuild(argv.slice(1));
    return await runCompile(argv[0] === "compile" ? argv.slice(1) : argv);
  } catch (error) {
    await reportCliError(error);
    return 1;
  }
}

async function runCompile(rawArgs: string[]): Promise<number> {
  const args = [...rawArgs];
  const propsParam = takeOption(args, "--props");
  const configuredName = takeOption(args, "--component-name");
  const optionOutput = takeOption(args, "--output") ?? takeOption(args, "-o");
  const validate = !takeFlag(args, "--no-validate");
  rejectUnknownOptions(args);
  const positional = args.filter((arg) => !arg.startsWith("-"));
  const inputArg = positional[0];
  if (inputArg === undefined) throw new Error("A .btsx input file is required.");
  if (!inputArg.endsWith(".btsx")) throw new Error("The input file must use the .btsx extension.");
  if (positional.length > 2) throw new Error("Too many positional arguments for compile.");

  const input = resolve(inputArg);
  const output = resolve(
    optionOutput ?? positional[1] ?? inputArg.replace(/\.btsx$/u, ".tsrx"),
  );
  if (input === output) throw new Error("The output path must differ from the input path.");
  const code = compileBeast(await readFile(input, "utf8"), {
    filename: input,
    componentName: configuredName ?? componentNameFromPath(input),
    ...(propsParam === undefined ? {} : { propsParam }),
  });
  if (validate) {
    const { validateTsrx } = await import("./octane.js");
    validateTsrx(code, output);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, code, "utf8");
  console.log(`Compiled ${inputArg} -> ${output}`);
  return 0;
}

async function runBuild(rawArgs: string[]): Promise<number> {
  const args = [...rawArgs];
  const output = takeOption(args, "--out-dir");
  const validate = !takeFlag(args, "--no-validate");
  const watch = takeFlag(args, "--watch");
  rejectUnknownOptions(args);
  const positional = args.filter((arg) => !arg.startsWith("-"));
  if (positional.length > 1) throw new Error("Build accepts at most one source directory.");
  const root = resolve(positional[0] ?? ".");
  const options = {
    root,
    ...(output === undefined ? {} : { outDir: resolve(output) }),
    validate,
  };
  if (watch) {
    const session = watchBeastProject({
      ...options,
      onBuild: reportBuild,
      onError: (error) => void reportCliError(error),
    });
    try {
      await session.ready;
    } catch {
      // The watch remains active so a later edit can recover the build.
    }
    return 0;
  }

  reportBuild(await buildBeastProject(options));
  return 0;
}

function reportBuild(result: Awaited<ReturnType<typeof buildBeastProject>>): void {
  console.log(
    `Built ${result.generated.length} BTSX component(s); removed ${result.removed.length} stale output(s); validated ${result.validatedNativeTsrx.length} native TSRX file(s) in ${result.outDir}`,
  );
}

async function reportCliError(error: unknown): Promise<void> {
  if (error instanceof BeastCompileError) {
    let source: string | undefined;
    try {
      source = await readFile(error.diagnostic.filename, "utf8");
    } catch {
      source = undefined;
    }
    console.error(formatDiagnostic(error.diagnostic, source));
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Option ${name} requires a value.`);
  }
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function rejectUnknownOptions(args: string[]): void {
  const unknown = args.find((arg) => arg.startsWith("-"));
  if (unknown !== undefined) throw new Error(`Unknown option: ${unknown}`);
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
