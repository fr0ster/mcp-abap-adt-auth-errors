/**
 * Compiled by `npm run test:check` only (never built, never run): each
 * membership guard's predicate type is exactly its array's union (§5.5).
 */
import type * as Contract from '@mcp-abap-adt/interfaces-auth';
import * as Guards from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

/** The guard takes `unknown` and narrows it to exactly `U`. */
type GuardOf<G, U> = Equal<G, (value: unknown) => value is U>;

export type isAuthProviderErrorKindGuard = Expect<
  GuardOf<typeof Guards.isAuthProviderErrorKind, Contract.AuthProviderErrorKind>
>;
export type isAuthProviderErrorKindUnion = Expect<
  Equal<
    Contract.AuthProviderErrorKind,
    (typeof Contract.AUTH_PROVIDER_ERROR_KINDS)[number]
  >
>;
export type isConfigFieldGuard = Expect<
  GuardOf<typeof Guards.isConfigField, Contract.ConfigField>
>;
export type isConfigFieldUnion = Expect<
  Equal<Contract.ConfigField, (typeof Contract.CONFIG_FIELDS)[number]>
>;
export type isConfigCaseGuard = Expect<
  GuardOf<typeof Guards.isConfigCase, Contract.ConfigCase>
>;
export type isConfigCaseUnion = Expect<
  Equal<Contract.ConfigCase, (typeof Contract.CONFIG_CASES)[number]>
>;
export type isAllowedValueSetGuard = Expect<
  GuardOf<typeof Guards.isAllowedValueSet, Contract.AllowedValueSet>
>;
export type isAllowedValueSetUnion = Expect<
  Equal<Contract.AllowedValueSet, (typeof Contract.ALLOWED_VALUE_SETS)[number]>
>;
export type isSncQopGuard = Expect<
  GuardOf<typeof Guards.isSncQop, Contract.SncQop>
>;
export type isSncQopUnion = Expect<
  Equal<Contract.SncQop, (typeof Contract.SNC_QOP_VALUES)[number]>
>;
export type isBasicEncodingGuard = Expect<
  GuardOf<typeof Guards.isBasicEncoding, Contract.BasicEncoding>
>;
export type isBasicEncodingUnion = Expect<
  Equal<Contract.BasicEncoding, (typeof Contract.BASIC_ENCODINGS)[number]>
>;
export type isOperationGuard = Expect<
  GuardOf<typeof Guards.isOperation, Contract.Operation>
>;
export type isOperationUnion = Expect<
  Equal<Contract.Operation, (typeof Contract.OPERATIONS)[number]>
>;
export type isRequestProblemGuard = Expect<
  GuardOf<typeof Guards.isRequestProblem, Contract.RequestProblem>
>;
export type isRequestProblemUnion = Expect<
  Equal<Contract.RequestProblem, (typeof Contract.REQUEST_PROBLEMS)[number]>
>;
export type isSystemCodeGuard = Expect<
  GuardOf<typeof Guards.isSystemCode, Contract.SystemCode>
>;
export type isSystemCodeUnion = Expect<
  Equal<Contract.SystemCode, (typeof Contract.SYSTEM_CODES)[number]>
>;
export type isTlsFailureCodeGuard = Expect<
  GuardOf<typeof Guards.isTlsFailureCode, Contract.TlsFailureCode>
>;
export type isTlsFailureCodeUnion = Expect<
  Equal<Contract.TlsFailureCode, (typeof Contract.TLS_FAILURE_CODES)[number]>
>;
export type isOAuthErrorCodeGuard = Expect<
  GuardOf<typeof Guards.isOAuthErrorCode, Contract.OAuthErrorCode>
>;
export type isOAuthErrorCodeUnion = Expect<
  Equal<Contract.OAuthErrorCode, (typeof Contract.OAUTH_ERROR_CODES)[number]>
>;
export type isRfcKeyGuard = Expect<
  GuardOf<typeof Guards.isRfcKey, Contract.RfcKey>
>;
export type isRfcKeyUnion = Expect<
  Equal<Contract.RfcKey, (typeof Contract.RFC_KEYS)[number]>
>;
export type isAssertionCheckGuard = Expect<
  GuardOf<typeof Guards.isAssertionCheck, Contract.AssertionCheck>
>;
export type isAssertionCheckUnion = Expect<
  Equal<Contract.AssertionCheck, (typeof Contract.ASSERTION_CHECKS)[number]>
>;
export type isAssertionRuleGuard = Expect<
  GuardOf<typeof Guards.isAssertionRule, Contract.AssertionRule>
>;
export type isAssertionRuleUnion = Expect<
  Equal<Contract.AssertionRule, (typeof Contract.ASSERTION_RULES)[number]>
>;
export type isBearerCandidateReasonGuard = Expect<
  GuardOf<typeof Guards.isBearerCandidateReason, Contract.BearerCandidateReason>
>;
export type isBearerCandidateReasonUnion = Expect<
  Equal<
    Contract.BearerCandidateReason,
    (typeof Contract.BEARER_CANDIDATE_REASONS)[number]
  >
>;
export type isSamlStatusCodeGuard = Expect<
  GuardOf<typeof Guards.isSamlStatusCode, Contract.SamlStatusCode>
>;
export type isSamlStatusCodeUnion = Expect<
  Equal<Contract.SamlStatusCode, (typeof Contract.SAML_STATUS_CODES)[number]>
>;
export type isSncProblemGuard = Expect<
  GuardOf<typeof Guards.isSncProblem, Contract.SncProblem>
>;
export type isSncProblemUnion = Expect<
  Equal<Contract.SncProblem, (typeof Contract.SNC_PROBLEMS)[number]>
>;
export type isSncCandidateSourceGuard = Expect<
  GuardOf<typeof Guards.isSncCandidateSource, Contract.SncCandidateSource>
>;
export type isSncCandidateSourceUnion = Expect<
  Equal<
    Contract.SncCandidateSource,
    (typeof Contract.SNC_CANDIDATE_SOURCES)[number]
  >
>;
export type isSncUnusableReasonGuard = Expect<
  GuardOf<typeof Guards.isSncUnusableReason, Contract.SncUnusableReason>
>;
export type isSncUnusableReasonUnion = Expect<
  Equal<
    Contract.SncUnusableReason,
    (typeof Contract.SNC_UNUSABLE_REASONS)[number]
  >
>;
export type isSncArchGuard = Expect<
  GuardOf<typeof Guards.isSncArch, Contract.SncArch>
>;
export type isSncArchUnion = Expect<
  Equal<Contract.SncArch, (typeof Contract.SNC_ARCHS)[number]>
>;
export type isInteractiveOutcomeGuard = Expect<
  GuardOf<typeof Guards.isInteractiveOutcome, Contract.InteractiveOutcome>
>;
export type isInteractiveOutcomeUnion = Expect<
  Equal<
    Contract.InteractiveOutcome,
    (typeof Contract.INTERACTIVE_OUTCOMES)[number]
  >
>;
export type isInteractiveLoginStrategyGuard = Expect<
  GuardOf<
    typeof Guards.isInteractiveLoginStrategy,
    Contract.InteractiveLoginStrategy
  >
>;
export type isInteractiveLoginStrategyUnion = Expect<
  Equal<
    Contract.InteractiveLoginStrategy,
    (typeof Contract.INTERACTIVE_LOGIN_STRATEGIES)[number]
  >
>;
export type isCredentialKindGuard = Expect<
  GuardOf<typeof Guards.isCredentialKind, Contract.CredentialKind>
>;
export type isCredentialKindUnion = Expect<
  Equal<Contract.CredentialKind, (typeof Contract.CREDENTIAL_KINDS)[number]>
>;
export type isClientCertificateProblemGuard = Expect<
  GuardOf<
    typeof Guards.isClientCertificateProblem,
    Contract.ClientCertificateProblem
  >
>;
export type isClientCertificateProblemUnion = Expect<
  Equal<
    Contract.ClientCertificateProblem,
    (typeof Contract.CLIENT_CERTIFICATE_PROBLEMS)[number]
  >
>;
export type isClientAuthenticationProblemGuard = Expect<
  GuardOf<
    typeof Guards.isClientAuthenticationProblem,
    Contract.ClientAuthenticationProblem
  >
>;
export type isClientAuthenticationProblemUnion = Expect<
  Equal<
    Contract.ClientAuthenticationProblem,
    (typeof Contract.CLIENT_AUTHENTICATION_PROBLEMS)[number]
  >
>;
export type isRejectionMomentGuard = Expect<
  GuardOf<typeof Guards.isRejectionMoment, Contract.RejectionMoment>
>;
export type isRejectionMomentUnion = Expect<
  Equal<Contract.RejectionMoment, (typeof Contract.REJECTION_MOMENTS)[number]>
>;
export type isSystemRefusedVerdictGuard = Expect<
  GuardOf<typeof Guards.isSystemRefusedVerdict, Contract.SystemRefusedVerdict>
>;
export type isSystemRefusedVerdictUnion = Expect<
  Equal<
    Contract.SystemRefusedVerdict,
    (typeof Contract.SYSTEM_REFUSED_VERDICTS)[number]
  >
>;
export type isRenewalUnchangedSourceGuard = Expect<
  GuardOf<
    typeof Guards.isRenewalUnchangedSource,
    Contract.RenewalUnchangedSource
  >
>;
export type isRenewalUnchangedSourceUnion = Expect<
  Equal<
    Contract.RenewalUnchangedSource,
    (typeof Contract.RENEWAL_UNCHANGED_SOURCES)[number]
  >
>;
export type isTokenBindingProblemGuard = Expect<
  GuardOf<typeof Guards.isTokenBindingProblem, Contract.TokenBindingProblem>
>;
export type isTokenBindingProblemUnion = Expect<
  Equal<
    Contract.TokenBindingProblem,
    (typeof Contract.TOKEN_BINDING_PROBLEMS)[number]
  >
>;
export type isNotPreparedProviderGuard = Expect<
  GuardOf<typeof Guards.isNotPreparedProvider, Contract.NotPreparedProvider>
>;
export type isNotPreparedProviderUnion = Expect<
  Equal<
    Contract.NotPreparedProvider,
    (typeof Contract.NOT_PREPARED_PROVIDERS)[number]
  >
>;
export type isLogonTargetWireGuard = Expect<
  GuardOf<typeof Guards.isLogonTargetWire, Contract.LogonTargetWire>
>;
export type isLogonTargetWireUnion = Expect<
  Equal<Contract.LogonTargetWire, (typeof Contract.LOGON_TARGET_WIRES)[number]>
>;
export type isLogonTargetRefusalGuard = Expect<
  GuardOf<typeof Guards.isLogonTargetRefusal, Contract.LogonTargetRefusal>
>;
export type isLogonTargetRefusalUnion = Expect<
  Equal<
    Contract.LogonTargetRefusal,
    (typeof Contract.LOGON_TARGET_REFUSALS)[number]
  >
>;
export type isConnectionProblemGuard = Expect<
  GuardOf<typeof Guards.isConnectionProblem, Contract.ConnectionProblem>
>;
export type isConnectionProblemUnion = Expect<
  Equal<
    Contract.ConnectionProblem,
    (typeof Contract.CONNECTION_PROBLEMS)[number]
  >
>;
export type isConnectionMomentGuard = Expect<
  GuardOf<typeof Guards.isConnectionMoment, Contract.ConnectionMoment>
>;
export type isConnectionMomentUnion = Expect<
  Equal<Contract.ConnectionMoment, (typeof Contract.CONNECTION_MOMENTS)[number]>
>;

/** Narrowing works at a call site: a guarded `unknown` is the union. */
export function narrows(value: unknown): Contract.SystemCode | undefined {
  if (Guards.isSystemCode(value)) {
    const code: Contract.SystemCode = value;
    return code;
  }
  // @ts-expect-error without the guard, unknown is no SystemCode
  const code: Contract.SystemCode = value;
  void code;
  return undefined;
}
