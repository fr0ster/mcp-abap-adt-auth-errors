/**
 * The shape check of the MCP ABAP ADT authentication error contract: the
 * rules TypeScript alone cannot express, decided on the compiler API of the
 * TypeScript module the caller gives. It answers a report — the findings,
 * or why nothing could be checked — and writes to no stream, reads no
 * environment variable and keeps nothing between calls.
 */
import { checkOptions, Refused } from './options';
import { createContext } from './program';
import type {
  ShapeCheckOptions,
  ShapeCheckReport,
  ShapeFinding,
} from './types';

export type {
  ShapeCheckOptions,
  ShapeCheckReport,
  ShapeFinding,
  ShapeRule,
} from './types';

/** Findings by file, line, column and rule, as the command prints them. */
function sortFindings(findings: readonly ShapeFinding[]): ShapeFinding[] {
  return [...findings].sort((a, b) =>
    a.file === b.file
      ? a.line - b.line || a.column - b.column || a.rule - b.rule
      : a.file < b.file
        ? -1
        : 1,
  );
}

/**
 * Checks `options.files`, or the project's files under `<root>/src` outside
 * tests and declarations, against the rules asked for. A usage error is the
 * command's exit-2 refusal, in its words; a program that does not
 * type-check is not checked. Any other exception is a defect of a rule and
 * propagates.
 */
export function checkProviderShape(
  options: ShapeCheckOptions,
): ShapeCheckReport {
  try {
    const context = createContext(checkOptions(options));
    if (!('report' in context)) return context;
    return { status: 'checked', findings: sortFindings(context.findings) };
  } catch (error) {
    if (error instanceof Refused) {
      return { status: 'usage-error', message: error.message };
    }
    throw error;
  }
}

/** A finding as the command prints it: `<file>:<line>:<column>: rule <n>: <what>`. */
export function formatFinding(finding: ShapeFinding): string {
  return `${finding.file}:${finding.line}:${finding.column}: rule ${finding.rule}: ${finding.what}`;
}

/**
 * The lines a test compares with `[]`: one per finding, or why nothing
 * could be checked.
 */
export function reportLines(report: ShapeCheckReport): readonly string[] {
  switch (report.status) {
    case 'checked':
      return report.findings.map(formatFinding);
    case 'usage-error':
      return [`cannot check: ${report.message}`];
    case 'type-errors': {
      const lines = report.diagnostics.split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return ['cannot check: the program does not type-check', ...lines];
    }
  }
}
