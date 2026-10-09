/**
 * The shape check of the MCP ABAP ADT authentication error contract: the
 * rules TypeScript alone cannot express, decided on the compiler API of the
 * TypeScript module the caller gives. It answers a report — the findings,
 * or why nothing could be checked — and writes to no stream, reads no
 * environment variable and keeps nothing between calls.
 */
import { checkOptions, Refused } from './options';
import { createContext } from './program';
import { runRules } from './rules';
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
 *
 * Limits: it decides on syntax and types, without data flow, so it does not
 * see, among others: a provider built by a mixin returning an anonymous
 * class; writes through an alias of `this`, of a prototype, of
 * `Object.assign` or of `Object.defineProperties`; an unconstrained generic
 * cast helper, or a value of type `any` assigned without an assertion;
 * `structuredClone` of an error; `Reflect.apply` of a builder or of `guard`;
 * a provider property read into a local before a `guard` call; a `Basic `
 * value assembled from pieces, or a secret under a name the heuristic does
 * not know. Rule 8's crypto boundary is recognised only for direct calls
 * resolving to `@types/node`'s `crypto` declarations, in a closed grammar;
 * a method replaced on a crypto object is not detected. The threat model is
 * a well-meaning developer's mistake, not hostile code. Tested with
 * TypeScript `^5.9.0`.
 */
export function checkProviderShape(
  options: ShapeCheckOptions,
): ShapeCheckReport {
  try {
    const context = createContext(checkOptions(options));
    if (!('report' in context)) return context;
    runRules(context);
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
