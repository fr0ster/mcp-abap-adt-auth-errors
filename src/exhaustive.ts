/**
 * Exhaustiveness for consumers (spec §9): `matchKind`, a handler map typed
 * over every kind, and `unreachableKind`, the check in a `switch`'s
 * `default`. Both compile only when every kind is handled.
 *
 * At run time a handler only ever receives an error this copy minted: the
 * argument is normalised first through `classify(error, 'unfamiliar-error')`.
 * This copy's error passes as it is; a known kind with valid facts from
 * another copy or a newer contract is rebuilt (without diagnostics);
 * anything else — an unknown `kind`, a fact this build does not know — is a
 * minted `unknown` with `operation: 'unfamiliar-error'`.
 */
import type {
  AuthProviderErrorKind,
  AuthProviderErrorOf,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { classify } from './classify';

/** One handler per kind, each taking the error of its kind. */
export type KindHandlers<R> = {
  readonly [K in AuthProviderErrorKind]: (error: AuthProviderErrorOf<K>) => R;
};

/**
 * Hands `error`, normalised, to the handler of its kind. A missing handler
 * does not compile; a foreign or newer value reaches a handler only as an
 * error this copy minted, so the handler's required facts are there.
 */
export function matchKind<R>(
  error: IAuthProviderError,
  handlers: KindHandlers<R>,
): R {
  const known = classify(error, 'unfamiliar-error');
  switch (known.kind) {
    case 'configuration':
      return handlers.configuration(known);
    case 'client-certificate':
      return handlers['client-certificate'](known);
    case 'client-authentication':
      return handlers['client-authentication'](known);
    case 'request-failed':
      return handlers['request-failed'](known);
    case 'tls':
      return handlers.tls(known);
    case 'interactive-login':
      return handlers['interactive-login'](known);
    case 'saml-assertion':
      return handlers['saml-assertion'](known);
    case 'snc':
      return handlers.snc(known);
    case 'credential-refused':
      return handlers['credential-refused'](known);
    case 'system-refused':
      return handlers['system-refused'](known);
    case 'renewal-unchanged':
      return handlers['renewal-unchanged'](known);
    case 'renewal-declined':
      return handlers['renewal-declined'](known);
    case 'token-binding':
      return handlers['token-binding'](known);
    case 'not-prepared':
      return handlers['not-prepared'](known);
    case 'logon-target':
      return handlers['logon-target'](known);
    case 'connection':
      return handlers.connection(known);
    case 'unknown':
      return handlers.unknown(known);
  }
}

/**
 * The exhaustiveness check of a `switch` over `error.kind`: compiles only
 * when every kind was handled before `default`. At run time it answers the
 * same normalisation as `matchKind` — a minted error of a kind this build
 * knows, its facts complete — never the value as it came. Never throws.
 */
export function unreachableKind(error: never): IAuthProviderError {
  return classify(error, 'unfamiliar-error');
}
