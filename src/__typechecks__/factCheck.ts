/**
 * Compiled by `npm run test:check` only (never built, never run): the
 * keyed tables of the facts check name exactly their union — a missing key
 * fails `satisfies` in the source, an extra key fails here.
 */
import type {
  CountedAssertionRule,
  OAuth2GrantType,
} from '@mcp-abap-adt/interfaces-auth';
import type { COUNTED_RULES, GRANT_TYPES } from '../factCheck';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type GrantTypesExact = Expect<
  Equal<keyof typeof GRANT_TYPES, OAuth2GrantType>
>;
export type CountedRulesExact = Expect<
  Equal<keyof typeof COUNTED_RULES, CountedAssertionRule>
>;

/** An extra key does not equal the union. */
export type ExtraKeyFails = Expect<
  // @ts-expect-error a table with one key more is not the grant types
  Equal<keyof typeof GRANT_TYPES | 'extra', OAuth2GrantType>
>;
