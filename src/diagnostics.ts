import type { SourceSpan } from "./ast.js";

export type DiagnosticSeverity = "error" | "warning";

export interface BeastDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  filename: string;
  span: SourceSpan;
  hint?: string;
}

export class BeastCompileError extends Error {
  readonly diagnostic: BeastDiagnostic;

  constructor(diagnostic: BeastDiagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = "BeastCompileError";
    this.diagnostic = diagnostic;
  }
}

export function formatDiagnostic(
  diagnostic: BeastDiagnostic,
  source?: string,
): string {
  const location = `${diagnostic.filename}:${diagnostic.span.start.line}:${diagnostic.span.start.column}`;
  const header = `${location} - ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  if (source === undefined) {
    return diagnostic.hint === undefined ? header : `${header}\nHint: ${diagnostic.hint}`;
  }

  const line = source.split(/\r?\n/u)[diagnostic.span.start.line - 1] ?? "";
  const caretWidth = Math.max(
    1,
    diagnostic.span.end.line === diagnostic.span.start.line
      ? diagnostic.span.end.column - diagnostic.span.start.column
      : 1,
  );
  const marker = `${" ".repeat(Math.max(0, diagnostic.span.start.column - 1))}${"^".repeat(caretWidth)}`;
  const body = `${line}\n${marker}`;
  return diagnostic.hint === undefined
    ? `${header}\n${body}`
    : `${header}\n${body}\nHint: ${diagnostic.hint}`;
}
