import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { builtFunction } from './builtPackage';

/**
 * The branded-integer makers: a finite integer inside the range,
 * read without coercion, comes back unchanged; anything else is `undefined`.
 */
const MAKERS = [
  { name: 'httpStatus', min: 100, max: 599 },
  { name: 'count', min: 0, max: 1_000_000 },
  { name: 'port', min: 0, max: 65_535 },
] as const;

/** Never a number in any range: wrong type, not finite, not an integer. */
const NOT_INTEGERS: ReadonlyArray<[string, unknown]> = [
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['-Infinity', Number.NEGATIVE_INFINITY],
  ['undefined', undefined],
  ['null', null],
  ['true', true],
  ['an object', {}],
  ['an array', [200]],
  ['a bigint', 200n],
  ['a boxed number', Object(200)],
];

for (const { name, min, max } of MAKERS) {
  describe(`${name}`, () => {
    const make = builtFunction(name);

    it(`admits both bounds, ${min} and ${max}, unchanged`, () => {
      assert.equal(make(min), min);
      assert.equal(make(max), max);
    });

    it('admits an integer inside the range, unchanged', () => {
      const inside = Math.floor((min + max) / 2);
      assert.equal(make(inside), inside);
    });

    it(`refuses one past each bound, ${min - 1} and ${max + 1}`, () => {
      assert.equal(make(min - 1), undefined);
      assert.equal(make(max + 1), undefined);
    });

    it('refuses a non-integer inside the range', () => {
      assert.equal(make(min + 0.5), undefined);
      assert.equal(make(max - 0.001), undefined);
    });

    for (const [_label, value] of NOT_INTEGERS) {
      it(`refuses ${_label}`, () => {
        assert.equal(make(value), undefined);
      });
    }

    it('refuses a numeric string, without coercion', () => {
      assert.equal(make(String(min)), undefined);
      assert.equal(make(String(max)), undefined);
      assert.equal(make(` ${min} `), undefined);
    });

    it('refuses far outside the range', () => {
      assert.equal(make(Number.MAX_SAFE_INTEGER), undefined);
      assert.equal(make(-Number.MAX_SAFE_INTEGER), undefined);
    });
  });
}

describe('-0', () => {
  it('is no HTTP status', () => {
    assert.equal(builtFunction('httpStatus')(-0), undefined);
  });

  it('is 0 for count and port, normalised to +0: a fact never carries -0', () => {
    assert.equal(Object.is(builtFunction('count')(-0), 0), true);
    assert.equal(Object.is(builtFunction('port')(-0), 0), true);
  });
});
