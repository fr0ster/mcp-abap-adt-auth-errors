import type { Count, HttpStatus, Port } from '@mcp-abap-adt/interfaces-auth';

/**
 * The branded-integer makers (spec §4.3). A range check does not narrow
 * `number` to a brand, so each maker ends in one type assertion; these three
 * and `mint` are the only assertion sites the shape check permits (§8.2
 * rule 4). Each answers `undefined` outside its range.
 */

/** A finite integer in [min, max], read without coercion. */
function inRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

/** An integer HTTP status, 100–599, else `undefined`. */
export function httpStatus(value: unknown): HttpStatus | undefined {
  return inRange(value, 100, 599) ? (value as HttpStatus) : undefined;
}

/** An integer count, 0–1 000 000, else `undefined`. */
export function count(value: unknown): Count | undefined {
  return inRange(value, 0, 1_000_000) ? (value as Count) : undefined;
}

/** An integer TCP port, 0–65 535, else `undefined`. */
export function port(value: unknown): Port | undefined {
  return inRange(value, 0, 65_535) ? (value as Port) : undefined;
}
