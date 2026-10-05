import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
