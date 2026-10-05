/**
 * Compiled by `npm run test:check` only (never built, never run): a branded
 * integer is obtained only from its maker, and only once narrowed (§4.3).
 */
import type { Count, HttpStatus, Port } from '@mcp-abap-adt/interfaces-auth';
import { type count, httpStatus, type port } from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type HttpStatusMaker = Expect<
  Equal<typeof httpStatus, (value: unknown) => HttpStatus | undefined>
>;
export type CountMaker = Expect<
  Equal<typeof count, (value: unknown) => Count | undefined>
>;
export type PortMaker = Expect<
  Equal<typeof port, (value: unknown) => Port | undefined>
>;

// @ts-expect-error a bare literal is no HttpStatus
export const literalStatus: HttpStatus = 500;
// @ts-expect-error a bare literal is no Count
export const literalCount: Count = 3;
// @ts-expect-error a bare literal is no Port
export const literalPort: Port = 61001;

export function rangeCheckDoesNotBrand(n: number): void {
  if (Number.isInteger(n) && n >= 100 && n <= 599) {
    // @ts-expect-error a range check does not narrow number to the brand
    const s: HttpStatus = n;
    void s;
  }
}

// @ts-expect-error the maker's answer may be undefined until narrowed
export const unnarrowed: HttpStatus = httpStatus(500);

export function narrowed(): HttpStatus | undefined {
  const made = httpStatus(500);
  if (made === undefined) return undefined;
  const s: HttpStatus = made;
  return s;
}

export function brandsAreDistinct(c: Count, p: Port, s: HttpStatus): void {
  // @ts-expect-error a Count is no HttpStatus
  const a: HttpStatus = c;
  // @ts-expect-error a Port is no Count
  const b: Count = p;
  // @ts-expect-error an HttpStatus is no Port
  const d: Port = s;
  // a branded integer is still a number
  const n: number = s;
  void [a, b, d, n];
}
