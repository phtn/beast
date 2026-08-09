#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRECTORY = "beast-app";
const DEFAULT_COMPILER_SPEC = "latest";
const TEMPLATE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../template");

const HELP = `Create Beast — scaffold a Beast, Octane, and Vite project

Usage:
  bun create beast@latest [directory] [options]
  bun x create-beast@latest [directory] [options]

Options:
  --no-install  Create files without running bun install.
  --no-git      Do not initialize a Git repository.
  --force       Write template files into a non-empty directory.
  -h, --help    Show this help.
`;

export interface CreateProjectOptions {
  directory: string;
  cwd?: string;
  force?: boolean;
  install?: boolean;
  git?: boolean;
  /** Override used by local integration tests and prerelease channels. */
  compilerSpec?: string;
}

export interface CreateProjectResult {
  directory: string;
  packageName: string;
  installed: boolean;
  gitInitialized: boolean;
}

export async function createProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const requestedDirectory = options.directory.trim();
  if (requestedDirectory.length === 0) throw new Error("The project directory cannot be empty.");

  const cwd = resolve(options.cwd ?? process.cwd());
  const target = resolve(cwd, requestedDirectory);
  const packageName = normalizePackageName(basename(target));
  await prepareTarget(target, options.force === true);
  await copyTemplate(TEMPLATE_DIRECTORY, target, {
    "__PROJECT_NAME__": packageName,
    "__BEAST_PACKAGE_SPEC__": options.compilerSpec ?? DEFAULT_COMPILER_SPEC,
  });

  let gitInitialized = false;
  if (options.git !== false && (await runCommand("git", ["--version"], cwd, "ignore")) === 0) {
    gitInitialized = (await runCommand("git", ["init"], target, "inherit")) === 0;
  }

  let installed = false;
  if (options.install !== false) {
    const installStatus = await runCommand("bun", ["install"], target, "inherit");
    if (installStatus !== 0) {
      throw new Error(
        "The project was created, but bun install failed. Run it manually in the project directory.",
      );
    }
    installed = true;
  }

  return { directory: target, packageName, installed, gitInitialized };
}

export async function runCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }

  try {
    const args = argv.filter((arg) => arg !== "--");
    const install = !takeFlag(args, "--no-install");
    const git = !takeFlag(args, "--no-git");
    const force = takeFlag(args, "--force");
    const unknown = args.find((arg) => arg.startsWith("-"));
    if (unknown !== undefined) throw new Error(`Unknown option: ${unknown}`);
    if (args.length > 1) throw new Error("Create Beast accepts at most one project directory.");

    const directory = args[0] ?? (await askForDirectory());
    console.log(`\nCreating a Beast project in ${resolve(directory)}...\n`);
    const result = await createProject({ directory, force, install, git });
    const nextDirectory = relative(process.cwd(), result.directory) || ".";

    console.log("\nBeast project created.");
    console.log(`\n  cd ${shellDisplay(nextDirectory)}`);
    if (!result.installed) console.log("  bun install");
    console.log("  bun run dev\n");
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function askForDirectory(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return DEFAULT_DIRECTORY;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(`Project directory (${DEFAULT_DIRECTORY}): `)).trim();
    return answer || DEFAULT_DIRECTORY;
  } finally {
    prompt.close();
  }
}

async function prepareTarget(target: string, force: boolean): Promise<void> {
  try {
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) throw new Error(`Target exists and is not a directory: ${target}`);
    const entries = await readdir(target);
    if (entries.length > 0 && !force) {
      throw new Error(
        `Target directory is not empty: ${target}\nChoose another directory or pass --force.`,
      );
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      await mkdir(target, { recursive: true });
      return;
    }
    throw error;
  }
}

async function copyTemplate(
  source: string,
  target: string,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = resolve(source, entry.name);
    const outputName = entry.name === "gitignore" ? ".gitignore" : entry.name;
    const targetPath = resolve(target, outputName);
    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, targetPath, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    let contents = await readFile(sourcePath, "utf8");
    for (const [placeholder, value] of Object.entries(replacements)) {
      contents = contents.replaceAll(placeholder, value);
    }
    await writeFile(targetPath, contents, "utf8");
  }
}

function normalizePackageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "")
    .slice(0, 214);
  return normalized || DEFAULT_DIRECTORY;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  stdio: "ignore" | "inherit",
): Promise<number | null> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, stdio });
    child.once("error", () => done(null));
    child.once("exit", (code) => done(code));
  });
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function shellDisplay(path: string): string {
  return /\s/u.test(path) ? JSON.stringify(path) : path;
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
