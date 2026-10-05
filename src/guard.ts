/**
 * Rule 1 held structurally (spec §7, §8.1): `guard`, the one boundary every
 * moment of a provider runs inside, and `relayOutcome`, how a provider hands
 * on what a logon target answered without ever returning the target's object.
 *
 * Neither ever throws or rejects: everything that can throw runs inside one
 * `try`, and the `catch` reads only locals this module set, then `classify`,
 * which is total.
 */

import { isPromise } from 'node:util/types';
import type {
  AuthOutcome,
  LogonTargetRefusal,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { authError } from './builders';
import { classify, classifyOutcome } from './classify';
import { isGrantType } from './factCheck';

const freeze = Object.freeze;
const promiseThen: (
  promise: Promise<unknown>,
  onFulfilled: undefined,
  onRejected: () => void,
) => Promise<unknown> = Function.prototype.call.bind(Promise.prototype.then);
const ignore = (): void => {};

/**
 * A native promise answered where an outcome or a grant was expected is not
 * awaited, but its rejection must not go unhandled: under Node's default an
 * unhandled rejection ends the process and prints the foreign value. Only a
 * native promise gets the handler, through the `then` captured at load —
 * a foreign thenable's `then` is never called. Never throws.
 */
function quiet(value: unknown): void {
  try {
    if (isPromise(value)) promiseThen(value, undefined, ignore);
  } catch {
    // A tampered promise (a throwing `constructor` getter): nothing to do.
  }
}

/**
 * Runs one moment of a provider (spec §8.1). `operation` is a value its
 * caller already validated; `grant`, when given, is read inside the
 * boundary and kept only when it is an `OAuth2GrantType`. A throw — from
 * `grant`, from `body`, from a thenable `body` answers — becomes
 * `{ ok: false, refusal: classify(thrown, operation, grant) }`, the grant
 * being what was read before the throw (none when `grant` itself threw).
 * Never rejects.
 */
export async function guard(
  operation: Operation,
  body: () => AuthOutcome | Promise<AuthOutcome>,
  grant?: () => unknown,
): Promise<AuthOutcome> {
  let read: OAuth2GrantType | undefined;
  try {
    const candidate = grant?.();
    quiet(candidate);
    if (isGrantType(candidate)) read = candidate;
    return await body();
  } catch (thrown) {
    // Only the two locals: never a property of the provider.
    return freeze({ ok: false, refusal: classify(thrown, operation, read) });
  }
}

/** What a logon target's call came to, as a provider decides on it (§7). */
export interface RelayedOutcome {
  readonly outcome: AuthOutcome;
  /** The call threw (a broken target), as opposed to answering. */
  readonly thrown: boolean;
}

/**
 * Calls a logon target (`logon.tlsMaterial(…)`, `logon.logonParameters(…)`)
 * and answers what it came to, never the target's own object (spec §7): a
 * throw is `classify(thrown, operation)` with `thrown: true`; an answer goes
 * through `classifyOutcome` — this copy's minted refusal as it is, another
 * copy's rebuilt without diagnostics, anything else the `logon-target`
 * fallback `{ wire: 'unknown', refused }`, built here — with `thrown:
 * false`, even when the answer is unusable, because the target answered.
 * Never throws.
 */
export function relayOutcome(
  call: () => unknown,
  refused: LogonTargetRefusal,
  operation: Operation,
): RelayedOutcome {
  let answered: unknown;
  try {
    answered = call();
  } catch (thrown) {
    return freeze({
      outcome: freeze({ ok: false, refusal: classify(thrown, operation) }),
      thrown: true,
    });
  }
  quiet(answered);
  // Built by this copy: classifyOutcome hands the fallback back unchecked.
  const fallback = authError['logon-target']({ wire: 'unknown', refused });
  return freeze({
    outcome: classifyOutcome(answered, fallback),
    thrown: false,
  });
}
