import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadBuilt } from './builtPackage';

describe('OK', () => {
  it('is exported by the built package, deep-equal to { ok: true }', () => {
    const { OK } = loadBuilt();
    assert.deepEqual(OK, { ok: true });
  });

  it('is frozen: an assignment throws in strict mode', () => {
    const { OK } = loadBuilt();
    assert.equal(Object.isFrozen(OK), true);
    assert.throws(() => {
      (OK as { ok: boolean }).ok = false;
    }, TypeError);
    assert.throws(() => {
      (OK as Record<string, unknown>).refusal = {};
    }, TypeError);
    assert.deepEqual(OK, { ok: true });
  });

  it('is one object, the same on every read', () => {
    assert.equal(loadBuilt().OK, loadBuilt().OK);
  });
});
