/**
 * Compiled by `npm run test:check` only (never built, never run): the builder
 * half of the correlation probe, verbatim, on the full types,
 * and the builders' result types. Each `@ts-expect-error` line is a rule; an
 * unused directive fails the check, so each line is load-bearing.
 */
import type {
  AssertionRule,
  AuthProviderErrorOf,
  HttpStatus,
  IAuthProviderError,
  SamlAssertionError,
  SncError,
} from '@mcp-abap-adt/interfaces-auth';
import { authError, httpStatus, isMinted } from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

declare const v: string;

// builders — exact public signatures
authError['saml-assertion'](
  { rule: 'untrusted-issuer', check: 'issuer' },
  { issuer: v },
); // ok
authError['saml-assertion'](
  { rule: 'duplicate-id', check: 'duplicateId' },
  { id: v },
); // ok
authError.snc({ problem: 'no-credential' }, { library: v }); // ok
authError.configuration(
  { case: 'saml-acs-mismatch', fields: ['acsUrl'] },
  { configuredUri: v, strategyUri: v },
); // ok
const a = authError['saml-assertion'](
  { rule: 'untrusted-issuer', check: 'issuer' },
  { issuer: v },
);
export const i: string | undefined = a.diagnostics?.issuer; // ok: the result keeps its variant
authError['saml-assertion'](
  { rule: 'duplicate-id', check: 'duplicateId' },
  // @ts-expect-error duplicate-id carries no issuer
  { issuer: v },
);
// @ts-expect-error logon-refused carries no library
authError.snc({ problem: 'logon-refused' }, { library: v });
authError.configuration(
  { case: 'required-fields-missing', fields: ['clientId'] },
  // @ts-expect-error a non-mismatch case carries no configuredUri
  { configuredUri: v },
);
// facts narrowed per variant (SncFactsOf<P>, ConfigFactsOf<C>)
authError.snc({ problem: 'logon-refused', rfcKey: 'RFC_LOGON_FAILURE' }); // ok
authError.configuration({
  case: 'snc-qop-invalid',
  fields: ['qop'],
  allowed: 'snc-qop',
}); // ok
// @ts-expect-error logon-refused carries no candidates
authError.snc({ problem: 'logon-refused', candidates: [] });
// @ts-expect-error logon-refused carries no libraryArchs
authError.snc({ problem: 'logon-refused', libraryArchs: [] });
// @ts-expect-error library-not-found carries no rfcKey
authError.snc({ problem: 'library-not-found', rfcKey: 'RFC_LOGON_FAILURE' });
authError.configuration({
  case: 'snc-qop-invalid',
  fields: ['qop'],
  // @ts-expect-error snc-qop-invalid's allowed set is snc-qop
  allowed: 'basic-encoding',
});
authError.configuration({
  case: 'required-fields-missing',
  fields: ['clientId'],
  // @ts-expect-error required-fields-missing carries no allowed set
  allowed: 'snc-qop',
});
// @ts-expect-error the rule's check is fixed
authError['saml-assertion']({ rule: 'duplicate-id', check: 'issuer' });
declare const anyRule: AssertionRule;
authError['saml-assertion'](
  // @ts-expect-error a discriminant typed as the whole union
  { rule: anyRule, check: 'issuer' },
  { issuer: v },
);
// @ts-expect-error no diagnostics parameter on a kind without diagnostics
authError['client-certificate']({ problem: 'expired' }, { library: v });

// facts of another kind, facts of the wrong type
// @ts-expect-error a client-certificate fact on tls
authError.tls({ problem: 'expired' });
authError.tls({ operation: 'refresh', code: 'CERT_HAS_EXPIRED' }); // ok
authError['request-failed']({
  operation: 'refresh',
  problem: 'refused',
  // @ts-expect-error a bare number is no HttpStatus
  status: 500,
});
export function brandedStatus(): void {
  const status = httpStatus(500);
  if (status === undefined) return;
  authError['request-failed']({
    operation: 'refresh',
    problem: 'refused',
    status,
  }); // ok
}
authError.unknown({
  operation: 'refresh',
  // @ts-expect-error a code outside SYSTEM_CODES
  code: 'EWHATEVER',
});
// @ts-expect-error audience-not-us belongs to the audience check
authError['saml-assertion']({ rule: 'audience-not-us', check: 'issuer' });
authError['saml-assertion']({ rule: 'audience-not-us', check: 'audience' }); // ok

// the results: one variant for the three kinds, the kind's error otherwise
export type SncResult = Expect<
  Equal<
    ReturnType<typeof authError.snc<'no-credential'>>,
    Extract<SncError, { variant: 'no-credential' }>
  >
>;
const samlBuilder = authError['saml-assertion'];
// Not exported: declaration emit cannot name the brand's carrier.
type SamlResult = Expect<
  Equal<
    ReturnType<typeof samlBuilder<'duplicate-id'>>,
    Extract<SamlAssertionError, { variant: 'duplicate-id' }>
  >
>;
export type SamlResultHolds = SamlResult;
export type PlainResult = Expect<
  Equal<
    ReturnType<(typeof authError)['client-certificate']>,
    AuthProviderErrorOf<'client-certificate'>
  >
>;
export function inferredVariant(): void {
  const snc = authError.snc({ problem: 'no-credential' });
  const variant: 'no-credential' = snc.variant;
  const certificate = authError['client-certificate']({ problem: 'expired' });
  const anyError: IAuthProviderError = certificate; // ok
  void [variant, anyError];
}

// isMinted narrows to the error
export function minted(value: unknown): IAuthProviderError | undefined {
  if (isMinted(value)) {
    const error: IAuthProviderError = value;
    return error;
  }
  // @ts-expect-error unknown is no error until narrowed
  const error: IAuthProviderError = value;
  return error;
}

// interactive-login, interfaces-auth 6.0.0: aborted's strategy, failed's oauthError
declare const status400: HttpStatus;
authError['interactive-login']({ outcome: 'aborted', strategy: 'manual' }); // ok
authError['interactive-login']({
  outcome: 'failed',
  status: status400,
  oauthError: 'invalid_grant',
}); // ok
authError['interactive-login']({
  outcome: 'aborted',
  // @ts-expect-error the strategy set is browser | manual
  strategy: 'device',
});
authError['interactive-login']({
  outcome: 'aborted',
  // @ts-expect-error aborted carries no oauthError
  oauthError: 'access_denied',
});
authError['interactive-login']({
  outcome: 'failed',
  // @ts-expect-error a registered OAuth error code only
  oauthError: 'made_up_code',
});
