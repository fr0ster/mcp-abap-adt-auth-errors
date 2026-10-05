/**
 * Minting (spec §5.1, §5.6): the one place an `IAuthProviderError` comes
 * into being. `IAuthProviderError` carries a brand keyed by a symbol
 * interfaces-auth declares and does not export, so no code can write one; the
 * single type assertion in `mint` is what produces one, and every builder
 * reaches it. Besides `numbers.ts`' three makers, it is the only assertion
 * site of this package.
 *
 * Every error minted here is recorded in a module-private `WeakSet` — never
 * exported, never returned, never passed to a callback. Membership is the
 * only provenance mark (`isMinted`): an error rebuilt from a structure, by
 * any copy or forger, is not a member. `WeakSet.prototype.add` and `has` are
 * captured at load, so patching them later changes nothing here.
 */
import type {
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';

const freeze = Object.freeze;
const isFrozen = Object.isFrozen;
const ownKeys = Reflect.ownKeys;
const getOwnDescriptor = Reflect.getOwnPropertyDescriptor;
const weakAdd: (set: WeakSet<object>, value: object) => WeakSet<object> =
  Function.prototype.call.bind(WeakSet.prototype.add);
const weakHas: (set: WeakSet<object>, value: object) => boolean =
  Function.prototype.call.bind(WeakSet.prototype.has);

/** Every error this copy minted. Module-private: the provenance mark. */
const MINTED: WeakSet<object> = new WeakSet();

/**
 * What a builder hands to `mint`: the error without its brand. Built only by
 * the builders, from facts already normalised and diagnostics already
 * admitted, with words rendered from `kind` and `facts`.
 */
export interface ErrorDraft {
  readonly kind: AuthProviderErrorKind;
  readonly variant?: string;
  readonly facts: object;
  readonly reason: string;
  readonly hint?: string;
  readonly diagnostics?: object;
}

/**
 * Freezes `value` and every object and array reachable from it through own
 * data properties. A minted error is plain data (strings, numbers, booleans,
 * arrays, plain objects), so the walk ends; an object already frozen is
 * still walked, since freezing is shallow.
 */
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const key of ownKeys(value)) {
    const descriptor = getOwnDescriptor(value, key);
    if (descriptor !== undefined && 'value' in descriptor) {
      deepFreeze(descriptor.value);
    }
  }
  if (!isFrozen(value)) freeze(value);
}

/**
 * The one assertion: freezes the draft deeply, records it as minted by this
 * copy, and answers it typed as an error. Only the builders call it.
 */
export function mint(draft: ErrorDraft): IAuthProviderError {
  deepFreeze(draft);
  weakAdd(MINTED, draft);
  return draft as IAuthProviderError;
}

/**
 * Whether `value` is an error this copy of the package minted — a member of
 * the module-private `WeakSet`. A structurally identical object (a spread, a
 * parsed JSON value, an error of another copy) is not. Total.
 */
export function isMinted(value: unknown): value is IAuthProviderError {
  if (value === null || typeof value !== 'object') return false;
  return weakHas(MINTED, value);
}
