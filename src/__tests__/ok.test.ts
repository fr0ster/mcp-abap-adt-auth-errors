import { loadBuilt } from './builtPackage';

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
