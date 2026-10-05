/**
 * Classification (spec §5.4): the first boundary of goal invariant 4. What a
 * provider caught, or an outcome a collaborator answered, becomes an error of
 * this contract — and nothing of it but its allowlisted facts survives.
 *
 * `classify` runs six steps in order:
 *
 * 1. a value this copy minted (`WeakSet` membership): itself;
 * 2. carrier extraction: an object's `error`, read once into a local; minted
 *    by this copy: that error, diagnostics included;
 * 3. structural rebuild, on that local first, then on the value itself:
 *    `kind` in the list and every fact passing the per-kind validator
 *    (`factCheck.ts`) — re-minted with words rendered here, without
 *    diagnostics; its `reason`, `hint` and `diagnostics` are never read;
 * 4. a TLS failure `code`: `tls`;
 * 5. an integer status (`status`, else `response.status`), a registered
 *    OAuth error (`oauthError`, else `response.data.error`) or an
 *    allowlisted system `code`: `unknown` with those facts;
 * 6. anything else: `unknown` with the operation.
 *
 * Every property is read at most once, as an own data property (`readOwn`):
 * a getter is never invoked, a Proxy trap or a revoked Proxy that throws
 * reads as absent. No `message`, `cause`, `stack`, `name`, body or string
 * form is read, and no `instanceof` is evaluated. Both functions run inside
 * their own `try`: they never throw.
 */
import type {
  AuthOutcome,
  IAuthProviderError,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { readOwn } from './admission';
import {
  isAuthProviderErrorKind,
  isOAuthErrorCode,
  isSystemCode,
  isTlsFailureCode,
} from './allowlists';
import { authError, rebuild } from './builders';
import { isMinted } from './mint';
import { httpStatus } from './numbers';

const freeze = Object.freeze;

/**
 * The one success outcome, `{ ok: true }`, frozen: every provider and every
 * relay answers this object, so no caller can change what "Ok" means.
 */
export const OK: Extract<AuthOutcome, { ok: true }> = freeze({
  ok: true,
});

/**
 * Step 3 on one candidate: its `kind` and `facts`, each read once. Also
 * `isAuthProviderFailure`'s test of a carried error (not exported by the
 * index).
 */
export function rebuildFrom(
  candidate: unknown,
): IAuthProviderError | undefined {
  const kind = readOwn(candidate, 'kind');
  if (!isAuthProviderErrorKind(kind)) return undefined;
  return rebuild(kind, readOwn(candidate, 'facts'));
}

/** `operation`, and `grant` when given: the facts every fallback carries. */
function where(
  operation: Operation,
  grant: OAuth2GrantType | undefined,
): { readonly operation: Operation; readonly grant?: OAuth2GrantType } {
  return grant === undefined ? { operation } : { operation, grant };
}

/** Steps 4–6 on the value itself. */
function fromThrown(
  thrown: unknown,
  operation: Operation,
  grant: OAuth2GrantType | undefined,
): IAuthProviderError {
  const code = readOwn(thrown, 'code');
  // 4. A TLS failure.
  if (isTlsFailureCode(code)) {
    return authError.tls({ ...where(operation, grant), code });
  }
  // 5. Status, registered OAuth error, allowlisted system code.
  const response = readOwn(thrown, 'response');
  const status =
    httpStatus(readOwn(thrown, 'status')) ??
    httpStatus(readOwn(response, 'status'));
  const ownOAuthError = readOwn(thrown, 'oauthError');
  const oauthError = isOAuthErrorCode(ownOAuthError)
    ? ownOAuthError
    : readOwn(readOwn(response, 'data'), 'error');
  // 6. With none of them: `unknown` with the operation.
  return authError.unknown({
    ...where(operation, grant),
    ...(status === undefined ? {} : { status }),
    ...(isOAuthErrorCode(oauthError) ? { oauthError } : {}),
    ...(isSystemCode(code) ? { code } : {}),
  });
}

/**
 * What `thrown` is, as an error of this contract (spec §5.4). `operation`
 * and `grant` say where it was caught; they are the facts of the `tls` and
 * `unknown` answers. Total: anything that throws while the value is read
 * answers `unknown` with the operation.
 */
export function classify(
  thrown: unknown,
  operation: Operation,
  grant?: OAuth2GrantType,
): IAuthProviderError {
  try {
    // 1. Minted by this copy: a refusal handed back whole.
    if (isMinted(thrown)) return thrown;
    // 2. Carrier extraction: `error` read once; every later step reads the local.
    const carried = readOwn(thrown, 'error');
    if (isMinted(carried)) return carried;
    // 3. Structural rebuild: the carried value first, then the value itself.
    const rebuilt = rebuildFrom(carried) ?? rebuildFrom(thrown);
    if (rebuilt !== undefined) return rebuilt;
    // 4–6.
    return fromThrown(thrown, operation, grant);
  } catch {
    return authError.unknown(where(operation, grant));
  }
}

/**
 * An `AuthOutcome` that came from a collaborator (a logon target, a
 * consumer's provider), as this copy answers it (spec §5.4): `{ ok: true }`
 * answers the frozen `OK`; `{ ok: false, refusal }` whose refusal (read
 * once) this copy minted answers a fresh outcome with that object as it is,
 * one that rebuilds structurally a fresh outcome with the rebuild (no
 * diagnostics); anything else `{ ok: false, refusal: fallback }`. Total.
 */
export function classifyOutcome(
  value: unknown,
  fallback: IAuthProviderError,
): AuthOutcome {
  try {
    const ok = readOwn(value, 'ok');
    if (ok === true) return OK;
    if (ok === false) {
      const refusal = readOwn(value, 'refusal');
      if (isMinted(refusal)) return freeze({ ok: false, refusal });
      const rebuilt = rebuildFrom(refusal);
      if (rebuilt !== undefined) return freeze({ ok: false, refusal: rebuilt });
    }
  } catch {
    // Falls through to the fallback.
  }
  return freeze({ ok: false, refusal: fallback });
}
