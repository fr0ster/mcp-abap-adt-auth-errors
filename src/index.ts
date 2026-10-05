import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';

/**
 * The one success outcome, `{ ok: true }`, frozen: every provider and every
 * relay answers this object, so no caller can change what "Ok" means.
 */
export const OK: Extract<AuthOutcome, { ok: true }> = Object.freeze({
  ok: true,
});

export {
  isAllowedValueSet,
  isAssertionCheck,
  isAssertionRule,
  isAuthProviderErrorKind,
  isBasicEncoding,
  isBearerCandidateReason,
  isClientAuthenticationProblem,
  isClientCertificateProblem,
  isConfigCase,
  isConfigField,
  isConnectionMoment,
  isConnectionProblem,
  isCredentialKind,
  isInteractiveLoginStrategy,
  isInteractiveOutcome,
  isLogonTargetRefusal,
  isLogonTargetWire,
  isNotPreparedProvider,
  isOAuthErrorCode,
  isOperation,
  isRejectionMoment,
  isRenewalUnchangedSource,
  isRequestProblem,
  isRfcKey,
  isSamlStatusCode,
  isSncArch,
  isSncCandidateSource,
  isSncProblem,
  isSncQop,
  isSncUnusableReason,
  isSystemCode,
  isSystemRefusedVerdict,
  isTlsFailureCode,
  isTokenBindingProblem,
} from './allowlists';
export {
  type AuthErrorBuilders,
  authError,
  type DiagnosticsInputOf,
  type One,
  type PlainBuilders,
  type VariantBuilders,
} from './builders';
export { type LogFields, logFields, renderDiagnostics } from './diagnostics';
export { isMinted } from './mint';
export { count, httpStatus, port } from './numbers';
export { blamesCredential, render, type Words } from './words';
