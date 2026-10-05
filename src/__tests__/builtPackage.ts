import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The built package, required by path as a consumer would: what `main`
 * names, not the TypeScript source. `npm run build` must run first (CI does).
 */
const builtEntry = resolve(__dirname, '../../dist/index.js');

export function loadBuilt(): Record<string, unknown> {
  if (!existsSync(builtEntry)) {
    throw new Error(`${builtEntry} is missing: run "npm run build" first`);
  }
  return require(builtEntry) as Record<string, unknown>;
}

/** An export of the built package that must be a function. */
export function builtFunction(name: string): (value: unknown) => unknown {
  const exported = loadBuilt()[name];
  if (typeof exported !== 'function') {
    throw new Error(`the built package exports no function "${name}"`);
  }
  return exported as (value: unknown) => unknown;
}

/**
 * One internal module of the built package, required by its `dist/` path:
 * for a module the builders use but the entry does not export (admission).
 */
export function loadBuiltModule(name: string): Record<string, unknown> {
  const file = resolve(__dirname, `../../dist/${name}.js`);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: run "npm run build" first`);
  }
  return require(file) as Record<string, unknown>;
}

/** A second copy of the built package, loaded from a temporary path. */
export interface SecondCopy {
  readonly exports: Record<string, unknown>;
  /** Removes the temporary directory. */
  readonly remove: () => void;
}

/**
 * Copies `dist/` into a fresh temporary directory, links the repository's
 * `node_modules` beside it (so the copy resolves `interfaces-auth`), and
 * requires the copy's entry: another copy of the package, with its own
 * module state — its own minted `WeakSet` — as a second install would have.
 */
export function loadSecondCopy(): SecondCopy {
  if (!existsSync(builtEntry)) {
    throw new Error(`${builtEntry} is missing: run "npm run build" first`);
  }
  const root = mkdtempSync(join(tmpdir(), 'auth-errors-copy-'));
  cpSync(resolve(__dirname, '../../dist'), join(root, 'dist'), {
    recursive: true,
  });
  symlinkSync(
    resolve(__dirname, '../../node_modules'),
    join(root, 'node_modules'),
    'dir',
  );
  const exports = require(join(root, 'dist/index.js')) as Record<
    string,
    unknown
  >;
  return {
    exports,
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
