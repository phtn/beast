#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { compileBeast } from "./compiler";

function componentNameFromPath(inputPath: string): string {
  const base = basename(inputPath, extname(inputPath));
  const pascal = base
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return pascal.length > 0 ? pascal : "BeastComponent";
}

function main(argv: string[]): void {
  const inputArg = argv[0];
  if (inputArg === undefined) {
    console.error(
      'Usage: beast <input.btsx> [output.tsx] [--props "{ destructured, fields }: Type"]',
    );
    process.exit(1);
  }

  const propsFlagIndex = argv.indexOf("--props");
  // The --props value is the FULL parameter text, e.g.
  //   "{ user, unreadCount, messages }: { user: User; unreadCount: number; messages: Msg[] }"
  // so that identifiers used bare inside the .btsx file (e.g. #{user.name})
  // resolve directly against destructured props.
  const propsParam = propsFlagIndex !== -1 ? argv[propsFlagIndex + 1] : undefined;

  const outputArg = argv[1] !== undefined && argv[1] !== "--props" ? argv[1] : undefined;

  const inputPath = resolve(process.cwd(), inputArg);
  const outputPath = resolve(
    process.cwd(),
    outputArg ?? inputArg.replace(/\.btsx$/, "") + ".tsx",
  );

  const source = readFileSync(inputPath, "utf-8");
  const componentName = componentNameFromPath(inputPath);

  const tsx = compileBeast(source, {
    componentName,
    ...(propsParam !== undefined ? { propsParam } : {}),
  });

  writeFileSync(outputPath, tsx, "utf-8");
  console.log(`Compiled ${inputArg} -> ${outputPath}`);
}

main(process.argv.slice(2));
