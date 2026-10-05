import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The built package, required by path as a consumer would: what `main`
 * names, not the TypeScript source. `npm run build` must run first (CI does).
 */
const builtEntry = resolve(__dirname, '../../dist/index.js');

function loadBuilt(): Record<string, unknown> {
  if (!existsSync(builtEntry)) {
    throw new Error(`${builtEntry} is missing: run "npm run build" first`);
  }
  return require(builtEntry) as Record<string, unknown>;
}

describe('OK', () => {
  it('is exported by the built package, deep-equal to { ok: true }', () => {
    const { OK } = loadBuilt();
    expect(OK).toStrictEqual({ ok: true });
  });

  it('is frozen: an assignment throws in strict mode', () => {
    const { OK } = loadBuilt();
    expect(Object.isFrozen(OK)).toBe(true);
    expect(() => {
      (OK as { ok: boolean }).ok = false;
    }).toThrow(TypeError);
    expect(() => {
      (OK as Record<string, unknown>).refusal = {};
    }).toThrow(TypeError);
    expect(OK).toStrictEqual({ ok: true });
  });

  it('is one object, the same on every read', () => {
    expect(loadBuilt().OK).toBe(loadBuilt().OK);
  });
});
