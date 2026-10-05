/**
 * Compiled by `npm run test:check` only (never built, never run):
 * `AuthProviderFailure` takes a minted error only (spec §6, §11.2). Each
 * `@ts-expect-error` line is a rule; an unused directive fails the check.
 */
import type {
  IAuthProviderError,
  IAuthProviderFailure,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import {
  AuthProviderFailure,
  type AuthProviderFailureLike,
  authError,
  isAuthProviderFailure,
  readFailure,
} from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// Positive: a builder's result constructs.
const failure = new AuthProviderFailure(
  authError['client-certificate']({ problem: 'expired' }),
);
export const asContract: IAuthProviderFailure = failure;

// An unminted object — the same shape, written by hand — does not.
const literal = {
  kind: 'client-certificate',
  facts: { problem: 'expired' },
  reason: 'the client certificate has expired',
} as const;
// @ts-expect-error the brand cannot be written: only a builder mints
new AuthProviderFailure(literal);
declare const plain: {
  kind: 'client-certificate';
  facts: { problem: 'expired' };
  reason: string;
};
// @ts-expect-error an unminted object is not an IAuthProviderError
new AuthProviderFailure(plain);
// @ts-expect-error the constructor takes no free text
new AuthProviderFailure('the token was refused');
// @ts-expect-error the constructor takes no operation
new AuthProviderFailure(authError.unknown({ operation: 'refresh' }), 'refresh');

export type NameIsFixed = Expect<
  Equal<AuthProviderFailure['name'], 'AuthProviderFailure'>
>;
export type ErrorIsTheError = Expect<
  Equal<AuthProviderFailure['error'], IAuthProviderError>
>;
export type ReadFailureSignature = Expect<
  Equal<
    typeof readFailure,
    (thrown: unknown, operation: Operation) => IAuthProviderError
  >
>;
export type IsAuthProviderFailureGuards = Expect<
  Equal<
    typeof isAuthProviderFailure,
    (value: unknown) => value is AuthProviderFailureLike
  >
>;

// After the guard the value is an Error named AuthProviderFailure, nothing
// more: its words are not trusted, so `error` is not offered.
declare const caught: unknown;
if (isAuthProviderFailure(caught)) {
  const name: 'AuthProviderFailure' = caught.name;
  // @ts-expect-error a guarded value offers no `error`: read it with readFailure
  caught.error.reason;
  const read: IAuthProviderError = readFailure(caught, 'refresh');
  void name;
  void read;
}
