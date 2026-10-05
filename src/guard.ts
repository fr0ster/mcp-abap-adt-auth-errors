/**
 * Rule 1 held structurally (spec §7, §8.1): `guard`, the one boundary every
 * moment of a provider runs inside — a throw becomes a refusal, an answer is
 * classified — and `relayOutcome`, how a provider hands
 * on what a logon target answered without ever returning the target's object.
 *
 * Neither ever throws or rejects: everything that can throw runs inside one
 * `try`, and the `catch` reads only locals this module set, then `classify`,
 * which is total.
 */

import { isPromise, isProxy } from 'node:util/types';
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
const getPrototypeOf = Object.getPrototypeOf;
const getOwnDescriptor = Reflect.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const NativePromise = Promise;
const PROMISE_PROTOTYPE = Promise.prototype;
const SPECIES_GETTER = getOwnDescriptor(Promise, Symbol.species)?.get;
const promiseThen: (
  promise: Promise<unknown>,
  onFulfilled: undefined,
  onRejected: () => void,
) => Promise<unknown> = Function.prototype.call.bind(Promise.prototype.then);
const ignore = (): void => {};

/**
 * Whether `then` on `value` runs no code but the engine's: a native promise
 * (no Proxy around it) whose prototype is `Promise.prototype` and which has
 * no own `constructor` — `then` reads `value.constructor` and its
 * `Symbol.species` (SpeciesConstructor), so both must still be the
 * built-ins captured at load. Every read here is of an object that is not a
 * Proxy, so no trap runs.
 */
function isPlainPromise(value: unknown): value is Promise<unknown> {
  if (!isPromise(value) || isProxy(value)) return false;
  if (getPrototypeOf(value) !== PROMISE_PROTOTYPE) return false;
  if (hasOwn(value, 'constructor')) return false;
  const ctor = getOwnDescriptor(PROMISE_PROTOTYPE, 'constructor');
  if (ctor === undefined || ctor.value !== NativePromise) {
    return false;
  }
  const species = getOwnDescriptor(NativePromise, Symbol.species);
  return species !== undefined && species.get === SPECIES_GETTER;
}

/**
 * A native promise answered where an outcome or a grant was expected is not
 * awaited, but its rejection must not go unhandled: under Node's default an
 * unhandled rejection ends the process and prints the foreign value. Only a
 * plain native promise (`isPlainPromise`) gets a no-op rejection handler,
 * through the `then` captured at load; anything else — a foreign thenable,
 * a Promise subclass, a Proxy around a promise, a promise with an own
 * `constructor` — gets none, since handling it would run its code. Never
 * throws.
 */
function quiet(value: unknown): void {
  try {
    if (isPlainPromise(value)) promiseThen(value, undefined, ignore);
  } catch {
    // Nothing to do: no rejection handler is attached.
  }
}

/** The facts of `guard`'s fallback: the operation, and the grant when kept. */
function unknownFacts(
  operation: Operation,
  grant: OAuth2GrantType | undefined,
): { readonly operation: Operation; readonly grant?: OAuth2GrantType } {
  return grant === undefined ? { operation } : { operation, grant };
}

/**
 * Runs one moment of a provider (spec §8.1). `operation` is a value its
 * caller already validated; `grant`, when given, is read inside the
 * boundary and kept only when it is an `OAuth2GrantType`. A throw — from
 * `grant`, from `body`, from a thenable `body` answers — becomes
 * `{ ok: false, refusal: classify(thrown, operation, grant) }`, the grant
 * being what was read before the throw (none when `grant` itself threw).
 * The answer of a body that does not throw is never handed back as it is:
 * it goes through `classifyOutcome` — `{ ok: true }` answers `OK`, a refusal
 * this copy minted passes as itself (in a fresh frozen outcome), another
 * copy's or a forged one is rebuilt without diagnostics, and anything else
 * (not an outcome, an unrebuildable refusal) answers the fallback built
 * here: `unknown` with the operation and the kept grant — the refusal a
 * throw without facts gets.
 * Never rejects. A grant thunk answering a plain native promise gets a
 * no-op rejection handler; one answering a rejecting Promise subclass or a
 * Proxy around a promise (breaking its contract) can still cause an
 * unhandled rejection, since handling it would run its code — a limit.
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
    const answer: unknown = await body();
    return classifyOutcome(
      answer,
      authError.unknown(unknownFacts(operation, read)),
    );
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
 * Never throws. A target is synchronous by contract: a plain native promise
 * it answers is the fallback and gets a no-op rejection handler; a
 * rejecting Promise subclass, a Proxy around a promise or a promise with an
 * own `constructor` gets none, and can still cause an unhandled rejection,
 * since handling it would run its code — a limit.
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
