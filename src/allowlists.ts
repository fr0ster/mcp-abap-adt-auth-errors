import {
  ALLOWED_VALUE_SETS,
  type AllowedValueSet,
  ASSERTION_CHECKS,
  ASSERTION_RULES,
  type AssertionCheck,
  type AssertionRule,
  AUTH_PROVIDER_ERROR_KINDS,
  type AuthProviderErrorKind,
  BASIC_ENCODINGS,
  type BasicEncoding,
  BEARER_CANDIDATE_REASONS,
  type BearerCandidateReason,
  CLIENT_AUTHENTICATION_PROBLEMS,
  CLIENT_CERTIFICATE_PROBLEMS,
  type ClientAuthenticationProblem,
  type ClientCertificateProblem,
  CONFIG_CASES,
  CONFIG_FIELDS,
  CONNECTION_MOMENTS,
  CONNECTION_PROBLEMS,
  type ConfigCase,
  type ConfigField,
  type ConnectionMoment,
  type ConnectionProblem,
  CREDENTIAL_KINDS,
  type CredentialKind,
  INTERACTIVE_LOGIN_STRATEGIES,
  INTERACTIVE_OUTCOMES,
  type InteractiveLoginStrategy,
  type InteractiveOutcome,
  LOGON_TARGET_REFUSALS,
  LOGON_TARGET_WIRES,
  type LogonTargetRefusal,
  type LogonTargetWire,
  NOT_PREPARED_PROVIDERS,
  type NotPreparedProvider,
  OAUTH_ERROR_CODES,
  type OAuthErrorCode,
  OPERATIONS,
  type Operation,
  REJECTION_MOMENTS,
  RENEWAL_TRIGGERS,
  RENEWAL_UNCHANGED_SOURCES,
  REQUEST_PROBLEMS,
  type RejectionMoment,
  type RenewalTrigger,
  type RenewalUnchangedSource,
  type RequestProblem,
  RFC_KEYS,
  type RfcKey,
  SAML_STATUS_CODES,
  type SamlStatusCode,
  SNC_ARCHS,
  SNC_CANDIDATE_SOURCES,
  SNC_PROBLEMS,
  SNC_QOP_VALUES,
  SNC_UNUSABLE_REASONS,
  type SncArch,
  type SncCandidateSource,
  type SncProblem,
  type SncQop,
  type SncUnusableReason,
  SYSTEM_CODES,
  SYSTEM_REFUSED_VERDICTS,
  type SystemCode,
  type SystemRefusedVerdict,
  TLS_FAILURE_CODES,
  type TlsFailureCode,
  TOKEN_BINDING_PROBLEMS,
  type TokenBindingProblem,
} from '@mcp-abap-adt/interfaces-auth';

/**
 * Allowlist runtime sets and their membership guards.
 *
 * One `Set` per allowlist array of interfaces-auth, copied at module load
 * and held in a module-private constant: never exported, never returned,
 * never passed to a callback, so no code can widen an allowlist. What is
 * exported is one membership guard per array.
 *
 * Every guard calls the `Set.prototype.has` captured here, at load, bound to
 * the `Function.prototype.call` of that moment: patching either later does
 * not change an answer.
 */
const has: (set: ReadonlySet<string>, value: string) => boolean =
  Function.prototype.call.bind(Set.prototype.has);

function member(set: ReadonlySet<string>, value: unknown): boolean {
  return typeof value === 'string' && has(set, value);
}

const AUTH_PROVIDER_ERROR_KIND_SET: ReadonlySet<string> = new Set<string>(
  AUTH_PROVIDER_ERROR_KINDS,
);
const CONFIG_FIELD_SET: ReadonlySet<string> = new Set<string>(CONFIG_FIELDS);
const CONFIG_CASE_SET: ReadonlySet<string> = new Set<string>(CONFIG_CASES);
const ALLOWED_VALUE_SET_SET: ReadonlySet<string> = new Set<string>(
  ALLOWED_VALUE_SETS,
);
const SNC_QOP_SET: ReadonlySet<string> = new Set<string>(SNC_QOP_VALUES);
const BASIC_ENCODING_SET: ReadonlySet<string> = new Set<string>(
  BASIC_ENCODINGS,
);
const OPERATION_SET: ReadonlySet<string> = new Set<string>(OPERATIONS);
const REQUEST_PROBLEM_SET: ReadonlySet<string> = new Set<string>(
  REQUEST_PROBLEMS,
);
const SYSTEM_CODE_SET: ReadonlySet<string> = new Set<string>(SYSTEM_CODES);
const TLS_FAILURE_CODE_SET: ReadonlySet<string> = new Set<string>(
  TLS_FAILURE_CODES,
);
const OAUTH_ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(
  OAUTH_ERROR_CODES,
);
const RFC_KEY_SET: ReadonlySet<string> = new Set<string>(RFC_KEYS);
const ASSERTION_CHECK_SET: ReadonlySet<string> = new Set<string>(
  ASSERTION_CHECKS,
);
const ASSERTION_RULE_SET: ReadonlySet<string> = new Set<string>(
  ASSERTION_RULES,
);
const BEARER_CANDIDATE_REASON_SET: ReadonlySet<string> = new Set<string>(
  BEARER_CANDIDATE_REASONS,
);
const SAML_STATUS_CODE_SET: ReadonlySet<string> = new Set<string>(
  SAML_STATUS_CODES,
);
const SNC_PROBLEM_SET: ReadonlySet<string> = new Set<string>(SNC_PROBLEMS);
const SNC_CANDIDATE_SOURCE_SET: ReadonlySet<string> = new Set<string>(
  SNC_CANDIDATE_SOURCES,
);
const SNC_UNUSABLE_REASON_SET: ReadonlySet<string> = new Set<string>(
  SNC_UNUSABLE_REASONS,
);
const SNC_ARCH_SET: ReadonlySet<string> = new Set<string>(SNC_ARCHS);
const INTERACTIVE_OUTCOME_SET: ReadonlySet<string> = new Set<string>(
  INTERACTIVE_OUTCOMES,
);
const INTERACTIVE_LOGIN_STRATEGY_SET: ReadonlySet<string> = new Set<string>(
  INTERACTIVE_LOGIN_STRATEGIES,
);
const CREDENTIAL_KIND_SET: ReadonlySet<string> = new Set<string>(
  CREDENTIAL_KINDS,
);
const CLIENT_CERTIFICATE_PROBLEM_SET: ReadonlySet<string> = new Set<string>(
  CLIENT_CERTIFICATE_PROBLEMS,
);
const CLIENT_AUTHENTICATION_PROBLEM_SET: ReadonlySet<string> = new Set<string>(
  CLIENT_AUTHENTICATION_PROBLEMS,
);
const REJECTION_MOMENT_SET: ReadonlySet<string> = new Set<string>(
  REJECTION_MOMENTS,
);
const SYSTEM_REFUSED_VERDICT_SET: ReadonlySet<string> = new Set<string>(
  SYSTEM_REFUSED_VERDICTS,
);
const RENEWAL_TRIGGER_SET: ReadonlySet<string> = new Set<string>(
  RENEWAL_TRIGGERS,
);
const RENEWAL_UNCHANGED_SOURCE_SET: ReadonlySet<string> = new Set<string>(
  RENEWAL_UNCHANGED_SOURCES,
);
const TOKEN_BINDING_PROBLEM_SET: ReadonlySet<string> = new Set<string>(
  TOKEN_BINDING_PROBLEMS,
);
const NOT_PREPARED_PROVIDER_SET: ReadonlySet<string> = new Set<string>(
  NOT_PREPARED_PROVIDERS,
);
const LOGON_TARGET_WIRE_SET: ReadonlySet<string> = new Set<string>(
  LOGON_TARGET_WIRES,
);
const LOGON_TARGET_REFUSAL_SET: ReadonlySet<string> = new Set<string>(
  LOGON_TARGET_REFUSALS,
);
const CONNECTION_PROBLEM_SET: ReadonlySet<string> = new Set<string>(
  CONNECTION_PROBLEMS,
);
const CONNECTION_MOMENT_SET: ReadonlySet<string> = new Set<string>(
  CONNECTION_MOMENTS,
);

/** Whether `value` is a member of `AUTH_PROVIDER_ERROR_KINDS`. */
export function isAuthProviderErrorKind(
  value: unknown,
): value is AuthProviderErrorKind {
  return member(AUTH_PROVIDER_ERROR_KIND_SET, value);
}

/** Whether `value` is a member of `CONFIG_FIELDS`. */
export function isConfigField(value: unknown): value is ConfigField {
  return member(CONFIG_FIELD_SET, value);
}

/** Whether `value` is a member of `CONFIG_CASES`. */
export function isConfigCase(value: unknown): value is ConfigCase {
  return member(CONFIG_CASE_SET, value);
}

/** Whether `value` is a member of `ALLOWED_VALUE_SETS`. */
export function isAllowedValueSet(value: unknown): value is AllowedValueSet {
  return member(ALLOWED_VALUE_SET_SET, value);
}

/** Whether `value` is a member of `SNC_QOP_VALUES`. */
export function isSncQop(value: unknown): value is SncQop {
  return member(SNC_QOP_SET, value);
}

/** Whether `value` is a member of `BASIC_ENCODINGS`. */
export function isBasicEncoding(value: unknown): value is BasicEncoding {
  return member(BASIC_ENCODING_SET, value);
}

/** Whether `value` is a member of `OPERATIONS`. */
export function isOperation(value: unknown): value is Operation {
  return member(OPERATION_SET, value);
}

/** Whether `value` is a member of `REQUEST_PROBLEMS`. */
export function isRequestProblem(value: unknown): value is RequestProblem {
  return member(REQUEST_PROBLEM_SET, value);
}

/** Whether `value` is a member of `SYSTEM_CODES`. */
export function isSystemCode(value: unknown): value is SystemCode {
  return member(SYSTEM_CODE_SET, value);
}

/** Whether `value` is a member of `TLS_FAILURE_CODES`. */
export function isTlsFailureCode(value: unknown): value is TlsFailureCode {
  return member(TLS_FAILURE_CODE_SET, value);
}

/** Whether `value` is a member of `OAUTH_ERROR_CODES`. */
export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return member(OAUTH_ERROR_CODE_SET, value);
}

/** Whether `value` is a member of `RFC_KEYS`. */
export function isRfcKey(value: unknown): value is RfcKey {
  return member(RFC_KEY_SET, value);
}

/** Whether `value` is a member of `ASSERTION_CHECKS`. */
export function isAssertionCheck(value: unknown): value is AssertionCheck {
  return member(ASSERTION_CHECK_SET, value);
}

/** Whether `value` is a member of `ASSERTION_RULES`. */
export function isAssertionRule(value: unknown): value is AssertionRule {
  return member(ASSERTION_RULE_SET, value);
}

/** Whether `value` is a member of `BEARER_CANDIDATE_REASONS`. */
export function isBearerCandidateReason(
  value: unknown,
): value is BearerCandidateReason {
  return member(BEARER_CANDIDATE_REASON_SET, value);
}

/** Whether `value` is a member of `SAML_STATUS_CODES`. */
export function isSamlStatusCode(value: unknown): value is SamlStatusCode {
  return member(SAML_STATUS_CODE_SET, value);
}

/** Whether `value` is a member of `SNC_PROBLEMS`. */
export function isSncProblem(value: unknown): value is SncProblem {
  return member(SNC_PROBLEM_SET, value);
}

/** Whether `value` is a member of `SNC_CANDIDATE_SOURCES`. */
export function isSncCandidateSource(
  value: unknown,
): value is SncCandidateSource {
  return member(SNC_CANDIDATE_SOURCE_SET, value);
}

/** Whether `value` is a member of `SNC_UNUSABLE_REASONS`. */
export function isSncUnusableReason(
  value: unknown,
): value is SncUnusableReason {
  return member(SNC_UNUSABLE_REASON_SET, value);
}

/** Whether `value` is a member of `SNC_ARCHS`. */
export function isSncArch(value: unknown): value is SncArch {
  return member(SNC_ARCH_SET, value);
}

/** Whether `value` is a member of `INTERACTIVE_OUTCOMES`. */
export function isInteractiveOutcome(
  value: unknown,
): value is InteractiveOutcome {
  return member(INTERACTIVE_OUTCOME_SET, value);
}

/** Whether `value` is a member of `INTERACTIVE_LOGIN_STRATEGIES`. */
export function isInteractiveLoginStrategy(
  value: unknown,
): value is InteractiveLoginStrategy {
  return member(INTERACTIVE_LOGIN_STRATEGY_SET, value);
}

/** Whether `value` is a member of `CREDENTIAL_KINDS`. */
export function isCredentialKind(value: unknown): value is CredentialKind {
  return member(CREDENTIAL_KIND_SET, value);
}

/** Whether `value` is a member of `CLIENT_CERTIFICATE_PROBLEMS`. */
export function isClientCertificateProblem(
  value: unknown,
): value is ClientCertificateProblem {
  return member(CLIENT_CERTIFICATE_PROBLEM_SET, value);
}

/** Whether `value` is a member of `CLIENT_AUTHENTICATION_PROBLEMS`. */
export function isClientAuthenticationProblem(
  value: unknown,
): value is ClientAuthenticationProblem {
  return member(CLIENT_AUTHENTICATION_PROBLEM_SET, value);
}

/** Whether `value` is a member of `REJECTION_MOMENTS`. */
export function isRejectionMoment(value: unknown): value is RejectionMoment {
  return member(REJECTION_MOMENT_SET, value);
}

/** Whether `value` is a member of `SYSTEM_REFUSED_VERDICTS`. */
export function isSystemRefusedVerdict(
  value: unknown,
): value is SystemRefusedVerdict {
  return member(SYSTEM_REFUSED_VERDICT_SET, value);
}

/** Whether `value` is a member of `RENEWAL_TRIGGERS`. */
export function isRenewalTrigger(value: unknown): value is RenewalTrigger {
  return member(RENEWAL_TRIGGER_SET, value);
}

/** Whether `value` is a member of `RENEWAL_UNCHANGED_SOURCES`. */
export function isRenewalUnchangedSource(
  value: unknown,
): value is RenewalUnchangedSource {
  return member(RENEWAL_UNCHANGED_SOURCE_SET, value);
}

/** Whether `value` is a member of `TOKEN_BINDING_PROBLEMS`. */
export function isTokenBindingProblem(
  value: unknown,
): value is TokenBindingProblem {
  return member(TOKEN_BINDING_PROBLEM_SET, value);
}

/** Whether `value` is a member of `NOT_PREPARED_PROVIDERS`. */
export function isNotPreparedProvider(
  value: unknown,
): value is NotPreparedProvider {
  return member(NOT_PREPARED_PROVIDER_SET, value);
}

/** Whether `value` is a member of `LOGON_TARGET_WIRES`. */
export function isLogonTargetWire(value: unknown): value is LogonTargetWire {
  return member(LOGON_TARGET_WIRE_SET, value);
}

/** Whether `value` is a member of `LOGON_TARGET_REFUSALS`. */
export function isLogonTargetRefusal(
  value: unknown,
): value is LogonTargetRefusal {
  return member(LOGON_TARGET_REFUSAL_SET, value);
}

/** Whether `value` is a member of `CONNECTION_PROBLEMS`. */
export function isConnectionProblem(
  value: unknown,
): value is ConnectionProblem {
  return member(CONNECTION_PROBLEM_SET, value);
}

/** Whether `value` is a member of `CONNECTION_MOMENTS`. */
export function isConnectionMoment(value: unknown): value is ConnectionMoment {
  return member(CONNECTION_MOMENT_SET, value);
}
