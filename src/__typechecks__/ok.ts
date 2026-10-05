/**
 * Compiled by `npm run test:check` only (never built, never run): `OK` is
 * typed exactly as the `{ ok: true }` member of `AuthOutcome`.
 */
import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';
import type { OK } from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type OkIsTheOkMember = Expect<
  Equal<typeof OK, Extract<AuthOutcome, { ok: true }>>
>;
