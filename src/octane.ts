import { compile } from "octane/compiler";

export interface OctaneValidationResult {
  code: string;
  map: unknown;
  diagnostics: readonly unknown[];
}

export function validateTsrx(
  source: string,
  filename: string,
  mode: "client" | "server" = "client",
): OctaneValidationResult {
  return compile(source, filename, { mode, hmr: false, dev: false });
}
