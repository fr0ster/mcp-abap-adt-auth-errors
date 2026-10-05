import { builtFunction } from './builtPackage';

/**
 * The branded-integer makers (spec §4.3): a finite integer inside the range,
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

describe.each(MAKERS)('$name', ({ name, min, max }) => {
  const make = builtFunction(name);

  it(`admits both bounds, ${min} and ${max}, unchanged`, () => {
    expect(make(min)).toBe(min);
    expect(make(max)).toBe(max);
  });

  it('admits an integer inside the range, unchanged', () => {
    const inside = Math.floor((min + max) / 2);
    expect(make(inside)).toBe(inside);
  });

  it(`refuses one past each bound, ${min - 1} and ${max + 1}`, () => {
    expect(make(min - 1)).toBeUndefined();
    expect(make(max + 1)).toBeUndefined();
  });

  it('refuses a non-integer inside the range', () => {
    expect(make(min + 0.5)).toBeUndefined();
    expect(make(max - 0.001)).toBeUndefined();
  });

  it.each(NOT_INTEGERS)('refuses %s', (_label, value) => {
    expect(make(value)).toBeUndefined();
  });

  it('refuses a numeric string, without coercion', () => {
    expect(make(String(min))).toBeUndefined();
    expect(make(String(max))).toBeUndefined();
    expect(make(` ${min} `)).toBeUndefined();
  });

  it('refuses far outside the range', () => {
    expect(make(Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect(make(-Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });
});

describe('-0', () => {
  it('is no HTTP status', () => {
    expect(builtFunction('httpStatus')(-0)).toBeUndefined();
  });

  it('is in range for count and port, admitted as the spec writes the makers (an integer, >= 0)', () => {
    expect(Object.is(builtFunction('count')(-0), -0)).toBe(true);
    expect(Object.is(builtFunction('port')(-0), -0)).toBe(true);
  });
});
