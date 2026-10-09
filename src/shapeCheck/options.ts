import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type * as ts from 'typescript';
import type { ShapeCheckOptions, ShapeRule } from './types';

/**
 * A usage error: what the command reports with exit 2 and its usage line.
 * Thrown by `fail` wherever the check finds it cannot run, and caught only
 * by `checkProviderShape`, which answers it as a report; any other
 * exception is a defect and propagates.
 */
export class Refused {
  constructor(readonly message: string) {}
}

export function fail(message: string): never {
  throw new Refused(message);
}

const KNOWN_RULES: ReadonlySet<unknown> = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

/** The base named by declaration: `<module>#<export>`, split. */
export interface BaseSpec {
  readonly spec: string;
  readonly module: string;
  readonly name: string;
}

/** The options, checked: what the rules and the program loading read. */
export interface CheckedOptions {
  readonly ts: typeof ts;
  readonly rules: ReadonlySet<ShapeRule>;
  readonly root: string;
  readonly project: string | null;
  readonly sites: string | null;
  readonly base: BaseSpec | undefined;
  readonly files: readonly string[];
}

/** Reads an own property of what the caller passed, whatever it is. */
function option(options: unknown, key: keyof ShapeCheckOptions): unknown {
  if (options === null || typeof options !== 'object') return undefined;
  return (options as Readonly<Record<string, unknown>>)[key];
}

function isTypeScript(value: unknown): value is typeof ts {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { readonly createProgram?: unknown }).createProgram ===
      'function'
  );
}

function absolutePath(value: unknown, name: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail(`${name}: an absolute path is required, not ${String(value)}`);
  }
  return resolve(value);
}

/** `project` / `sites`: stated, as an absolute path that exists, or `null`. */
function statedPath(value: unknown, name: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !isAbsolute(value)) {
    fail(
      `${name}: an absolute path, or null when there is none, is required, not ${String(value)}`,
    );
  }
  const path = resolve(value);
  if (!existsSync(path)) fail(`${name}: ${path} does not exist`);
  return path;
}

function checkedRules(value: unknown): ReadonlySet<ShapeRule> {
  if (value === undefined) fail('--rules is required');
  if (!Array.isArray(value)) {
    fail('rules: a list of rule numbers, 1 to 8, is required');
  }
  if (value.length === 0) fail('rules: at least one rule, 1 to 8, is required');
  const rules = new Set<ShapeRule>();
  for (const rule of value as readonly unknown[]) {
    if (!KNOWN_RULES.has(rule)) fail(`unknown rule ${String(rule)}`);
    rules.add(rule as ShapeRule);
  }
  return rules;
}

function checkedFiles(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    fail('files: a list of absolute paths is required');
  return (value as readonly unknown[]).map((file) =>
    absolutePath(file, 'files'),
  );
}

function checkedBase(
  value: unknown,
  rules: ReadonlySet<ShapeRule>,
): BaseSpec | undefined {
  if (value === undefined) {
    if (rules.has(1) || rules.has(2) || rules.has(3)) {
      fail(
        'rules 1, 2 and 3 need --base <module>#AuthProviderBase: the base, by declaration',
      );
    }
    return undefined;
  }
  if (typeof value !== 'string') {
    fail('base: a string, <module>#<export>, is required');
  }
  const at = value.lastIndexOf('#');
  if (at <= 0 || at === value.length - 1) {
    fail(`--base must be <module>#<export>: ${value}`);
  }
  return { spec: value, module: value.slice(0, at), name: value.slice(at + 1) };
}

/**
 * The options checked in the command's order — rules, then the base — with
 * the refusals only an API caller can meet (a module that is not
 * TypeScript, a relative path, a stated path that does not exist) beside
 * them; each refusal is a usage error.
 */
export function checkOptions(options: unknown): CheckedOptions {
  const typescript = option(options, 'typescript');
  if (!isTypeScript(typescript)) {
    fail("typescript: the caller's TypeScript module is required");
  }
  const rules = checkedRules(option(options, 'rules'));
  const root = absolutePath(option(options, 'root'), 'root');
  const project = statedPath(option(options, 'project'), 'project');
  const sites = statedPath(option(options, 'sites'), 'sites');
  const files = checkedFiles(option(options, 'files'));
  const base = checkedBase(option(options, 'base'), rules);
  return { ts: typescript, rules, root, project, sites, base, files };
}
