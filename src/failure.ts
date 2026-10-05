/**
 * `AuthProviderFailure`, the one thrown class (spec §6), and how a consumer
 * reads a thrown value: `readFailure` (which is `classify`) and
 * `isAuthProviderFailure`.
 *
 * A failure holds one minted error and nothing else: its `message` is the
 * error's words (`reason`, or `reason — hint`), never its diagnostics; it has
 * no `cause`, so no original travels with it. `name`, `message` and `error`
 * are its only enumerable own properties, so `JSON.stringify` and a
 * serializer copying enumerable properties (pino's) see those three.
 */
import type {
  IAuthProviderError,
  IAuthProviderFailure,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { readOwn } from './admission';
import { authError } from './builders';
import { classify, rebuildFrom } from './classify';
import { isMinted } from './mint';

const defineProperty = Object.defineProperty;

/** An own data property: enumerable, neither writable nor configurable. */
function fixed(value: unknown): PropertyDescriptor {
  return { value, enumerable: true, writable: false, configurable: false };
}

/** `reason`, or `reason — hint` (connection's `AuthRefusedError` format). */
function messageOf(error: IAuthProviderError): string {
  return error.hint === undefined
    ? error.reason
    : `${error.reason} — ${error.hint}`;
}

/**
 * What a value that passed `isAuthProviderFailure` is known to be: a value
 * named `AuthProviderFailure` — a failure of this copy or another, or any
 * object shaped like one, a plain JSON copy included (so not known to be an
 * `Error`). Its words are not known to be this copy's: read the error with
 * `readFailure(value, operation)`, never `value.message` or
 * `value.error.reason`.
 */
export type AuthProviderFailureLike = {
  readonly name: 'AuthProviderFailure';
};

/**
 * What `getTokens()` / `refreshTokens()` reject with. The constructor takes
 * an error minted by this copy (typed, and checked against the minted set):
 * anything else — a structural copy, a clone, another copy's error — becomes
 * the fixed `unknown` error with `operation: 'unfamiliar-error'`, since the
 * constructor takes no operation. Classify a foreign value first
 * (`readFailure`) to keep its kind and facts.
 *
 * `error` and `message` are own data properties, enumerable, neither
 * writable nor configurable: `classify` reads `error` without a getter, a
 * subclass's prototype accessor cannot intercept it, and an assignment
 * cannot make the message describe another error.
 */
export class AuthProviderFailure extends Error implements IAuthProviderFailure {
  override readonly name = 'AuthProviderFailure';
  declare readonly error: IAuthProviderError;

  constructor(error: IAuthProviderError) {
    const held = isMinted(error)
      ? error
      : authError.unknown({ operation: 'unfamiliar-error' });
    const message = messageOf(held);
    super(message);
    // `Error` defines `message` non-enumerable; the contract's serialised
    // form is name, message and error.
    defineProperty(this, 'message', fixed(message));
    defineProperty(this, 'error', fixed(held));
  }
}

/**
 * What a caught value is, as an error of this contract: `classify` with the
 * operation the catch was at (spec §5.4, §6). This copy's failure, or one
 * carrying this copy's error, answers that error as it is, diagnostics
 * included; another copy's failure, or any other carrier, is rebuilt
 * without diagnostics. Total.
 */
export function readFailure(
  thrown: unknown,
  operation: Operation,
): IAuthProviderError {
  return classify(thrown, operation);
}

/**
 * Whether `value` is an `AuthProviderFailure`, of this copy or another
 * (Decision D2): an own data `name` of `'AuthProviderFailure'` and an own
 * data `error` that this copy minted or that passes the structural rebuild.
 * No `instanceof`, no getter, never `message`. Total.
 *
 * It answers what the value is, not whose words it holds: a forged object
 * passes as well as another copy's failure. So it narrows to
 * `AuthProviderFailureLike`, without `error`: read the error with
 * `readFailure(value, operation)`, which rebuilds a foreign one with this
 * copy's words, and never print `message` or `error.reason` of a value this
 * copy did not construct.
 */
export function isAuthProviderFailure(
  value: unknown,
): value is AuthProviderFailureLike {
  try {
    if (readOwn(value, 'name') !== 'AuthProviderFailure') return false;
    const error = readOwn(value, 'error');
    return isMinted(error) || rebuildFrom(error) !== undefined;
  } catch {
    return false;
  }
}
