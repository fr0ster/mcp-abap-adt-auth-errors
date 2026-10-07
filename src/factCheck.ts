/**
 * The facts check: one validator per kind, shared by the builders and by
 * `render` (and, later, by classification). It reads each fact of the kind —
 * and only those — as an own data property (`readOwn`: a getter is never
 * invoked, a Proxy trap that throws reads as absent), checks it against its
 * allowlist guard or branded-integer maker (never coercing: no `toString`,
 * no `Symbol.toPrimitive`), and builds a fresh object in a fixed key order.
 *
 * - A required fact that is absent or fails its check makes the facts
 *   invalid (`undefined`): the builder mints the unfamiliar error instead,
 *   `render` answers the unfamiliar words.
 * - An optional fact that fails its check is dropped.
 * - A discriminant inside an array element (a bearer candidate's `reason`,
 *   an SNC candidate's `source` and `reason`) is required: an element this
 *   build does not know makes the facts invalid. An element of `fields` or
 *   of an architecture list that fails its guard is dropped, as are holes.
 * - `fields`: deduplicated in the order given, at most 8. SNC `candidates`:
 *   at most 8. Bearer `candidates`: at most 5, every other one the caller
 *   handed over (counted from its own `length`, up to 1 000 000) added to
 *   `moreCandidates`.
 * - A `count` of a "carries N" rule, and of a candidate with several
 *   SubjectConfirmationData, must be at least 2; otherwise it is dropped.
 *
 * `interfaces-auth` 6.0.0 exports no allowlist array of grant types, so the
 * grant guard is built here from its seven `AUTH_TYPE_*` constants, checked
 * against `OAuth2GrantType` by a mapped type.
 */
import {
  type AssertionRule,
  AUTH_TYPE_AUTHORIZATION_CODE,
  AUTH_TYPE_AUTHORIZATION_CODE_PKCE,
  AUTH_TYPE_CLIENT_CREDENTIALS,
  AUTH_TYPE_CLIENT_X509,
  AUTH_TYPE_PASSWORD,
  AUTH_TYPE_SAML2_BEARER,
  AUTH_TYPE_USER_TOKEN,
  type AuthProviderErrorFacts,
  type AuthProviderErrorKind,
  type CountedAssertionRule,
  type OAuth2GrantType,
} from '@mcp-abap-adt/interfaces-auth';
import { readOwn } from './admission';
import {
  isAssertionRule,
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
  isRenewalTrigger,
  isRenewalUnchangedSource,
  isRequestProblem,
  isRfcKey,
  isSamlStatusCode,
  isSncArch,
  isSncCandidateSource,
  isSncProblem,
  isSncUnusableReason,
  isSystemCode,
  isSystemRefusedVerdict,
  isTlsFailureCode,
  isTokenBindingProblem,
} from './allowlists';
import { count, httpStatus, port } from './numbers';

const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const isInteger = Number.isInteger;

/** `configuration` `fields`: at most eight. */
const FIELDS_MAX = 8;
/** `saml-assertion` `candidates` (`no-bearer-qualifies`): at most five. */
const BEARER_CANDIDATES_MAX = 5;
/** `snc` `candidates` (`library-not-found`): at most eight. */
const SNC_CANDIDATES_MAX = 8;
/** At most this many elements of any array a caller hands over are read. */
const READ_MAX = 1024;
/** A tally of the caller's elements stops here (the `Count` range). */
const TALLY_MAX = 1_000_000;

/**
 * Every grant type, keyed: exhaustive by the mapped type; its key set equals
 * `OAuth2GrantType` exactly (`__typechecks__/factCheck.ts`). Frozen.
 */
export const GRANT_TYPES = Object.freeze({
  [AUTH_TYPE_AUTHORIZATION_CODE]: true,
  [AUTH_TYPE_AUTHORIZATION_CODE_PKCE]: true,
  [AUTH_TYPE_PASSWORD]: true,
  [AUTH_TYPE_CLIENT_CREDENTIALS]: true,
  [AUTH_TYPE_USER_TOKEN]: true,
  [AUTH_TYPE_CLIENT_X509]: true,
  [AUTH_TYPE_SAML2_BEARER]: true,
}) satisfies { readonly [G in OAuth2GrantType]: true };

export function isGrantType(value: unknown): value is OAuth2GrantType {
  return typeof value === 'string' && hasOwn(GRANT_TYPES, value);
}

/**
 * The rules that say "carries N": they may carry `count`. Its key set equals
 * `CountedAssertionRule` exactly (`__typechecks__/factCheck.ts`). Frozen.
 */
export const COUNTED_RULES = Object.freeze({
  'several-references': true,
  'several-direct-assertions': true,
  'several-status': true,
  'several-status-codes': true,
  'several-issuers': true,
  'several-conditions': true,
  'several-subjects': true,
  'several-assertions': true,
}) satisfies { readonly [R in CountedAssertionRule]: true };

/** The check each rule belongs to (words.ts' table, passed in to avoid a cycle). */
type RuleChecks = { readonly [R in AssertionRule]: string };

type Out = Record<string, unknown>;
type Check = (value: unknown) => unknown;

/** A guard as a check: the value itself when it passes, else `undefined`. */
function by(guard: (value: unknown) => boolean): Check {
  return (value) => (guard(value) ? value : undefined);
}

const operation = by(isOperation);
const grant = by(isGrantType);
const oauthError = by(isOAuthErrorCode);
const systemCode = by(isSystemCode);
const rejectionMoment = by(isRejectionMoment);
const sncArch = by(isSncArch);
const isTrue: Check = (value) => (value === true ? true : undefined);
const isBoolean: Check = (value) =>
  typeof value === 'boolean' ? value : undefined;
/** A `Count` of at least two (a "carries N" count), else `undefined`. */
const severalCount: Check = (value) => {
  const made = count(value);
  return made !== undefined && made >= 2 ? made : undefined;
};

/** Thrown when a required fact fails; caught by `checkFacts`. */
class Invalid extends Error {}

/** Reads `key` of `input` and keeps it when it passes; required: else invalid. */
function need(out: Out, input: object, key: string, check: Check): unknown {
  const value = check(readOwn(input, key));
  if (value === undefined) throw new Invalid();
  out[key] = value;
  return value;
}

/** Reads `key` of `input` and keeps it only when it passes. */
function may(out: Out, input: object, key: string, check: Check): unknown {
  const value = check(readOwn(input, key));
  if (value !== undefined) out[key] = value;
  return value;
}

interface ReadArray {
  /** The elements read, holes and absent ones included as `undefined`. */
  readonly elements: readonly unknown[];
  /** How many the caller's own `length` claims, at most TALLY_MAX. */
  readonly length: number;
}

/** An own array at `key`: its elements (at most READ_MAX), and its length. */
function readArray(input: object, key: string): ReadArray | undefined {
  const value = readOwn(input, key);
  if (value === null || typeof value !== 'object') return undefined;
  try {
    if (!isArray(value)) return undefined;
  } catch {
    return undefined;
  }
  const claimed = readOwn(value, 'length');
  const length =
    typeof claimed === 'number' && isInteger(claimed) && claimed > 0
      ? Math.min(claimed, TALLY_MAX)
      : 0;
  const elements: unknown[] = [];
  for (let index = 0; index < Math.min(length, READ_MAX); index += 1) {
    elements.push(readOwn(value, `${index}`));
  }
  return { elements, length };
}

/** The elements that pass `check`, deduplicated when asked, at most `max`. */
function listOf(
  read: ReadArray,
  check: Check,
  max: number,
  deduplicate: boolean,
): unknown[] {
  const kept: unknown[] = [];
  for (const element of read.elements) {
    if (kept.length >= max) break;
    const value = check(element);
    if (value === undefined) continue;
    if (deduplicate && kept.includes(value)) continue;
    kept.push(value);
  }
  return kept;
}

/** An optional list of guarded strings (architectures): bad elements dropped. */
function mayList(out: Out, input: object, key: string, check: Check): void {
  const read = readArray(input, key);
  if (read !== undefined) out[key] = listOf(read, check, READ_MAX, false);
}

function configuration(input: object, out: Out): void {
  const configCase = need(out, input, 'case', by(isConfigCase));
  const fields = readArray(input, 'fields');
  if (fields === undefined) throw new Invalid();
  out.fields = listOf(fields, by(isConfigField), FIELDS_MAX, true);
  const allowed = readOwn(input, 'allowed');
  if (configCase === 'snc-qop-invalid' && allowed === 'snc-qop') {
    out.allowed = allowed;
  }
  if (configCase === 'basic-encoding-missing' && allowed === 'basic-encoding') {
    out.allowed = allowed;
  }
}

function interactiveLogin(input: object, out: Out): void {
  const outcome = need(out, input, 'outcome', by(isInteractiveOutcome));
  switch (outcome) {
    case 'port-in-use':
      need(out, input, 'port', port);
      return;
    case 'aborted':
      may(out, input, 'strategy', by(isInteractiveLoginStrategy));
      may(out, input, 'ignoredCallbacks', count);
      return;
    case 'disposed':
      need(out, input, 'strategy', by(isInteractiveLoginStrategy));
      return;
    case 'identity-provider-refused':
      may(out, input, 'oauthError', oauthError);
      return;
    case 'failed':
      may(out, input, 'code', systemCode);
      may(out, input, 'status', httpStatus);
      may(out, input, 'oauthError', oauthError);
      return;
    default:
      return;
  }
}

/** One bearer candidate; an unknown `reason` makes the facts invalid. */
function bearerCandidate(element: unknown): Out {
  if (element === null || typeof element !== 'object') throw new Invalid();
  const out: Out = {};
  const reason = need(out, element, 'reason', by(isBearerCandidateReason));
  if (reason === 'several-confirmation-data') {
    may(out, element, 'count', severalCount);
  }
  return out;
}

function samlAssertion(input: object, out: Out, checks: RuleChecks): void {
  const rule = need(out, input, 'rule', by(isAssertionRule));
  if (!isAssertionRule(rule)) throw new Invalid();
  const check = checks[rule];
  if (readOwn(input, 'check') !== check) throw new Invalid();
  out.check = check;
  if (hasOwn(COUNTED_RULES, rule)) {
    may(out, input, 'count', severalCount);
  } else if (rule === 'declined') {
    may(out, input, 'statusCode', by(isSamlStatusCode));
  } else if (rule === 'no-bearer-qualifies') {
    const read = readArray(input, 'candidates');
    const given = count(readOwn(input, 'moreCandidates')) ?? 0;
    let hidden = given;
    if (read !== undefined) {
      const candidates: Out[] = [];
      for (const element of read.elements) {
        if (element === undefined) continue;
        const candidate = bearerCandidate(element);
        if (candidates.length < BEARER_CANDIDATES_MAX) {
          candidates.push(candidate);
        }
      }
      out.candidates = candidates;
      // Every candidate the caller handed over and the error does not list
      // is counted — those past READ_MAX too, from the array's own length.
      const holes = read.elements.filter((e) => e === undefined).length;
      hidden += Math.max(0, read.length - holes - candidates.length);
    }
    const more = count(Math.min(hidden, TALLY_MAX));
    if (more !== undefined && more > 0) out.moreCandidates = more;
  }
}

/** One SNC candidate; an unknown `source` or `reason` makes the facts invalid. */
function sncCandidate(element: unknown): Out {
  if (element === null || typeof element !== 'object') throw new Invalid();
  const out: Out = {};
  need(out, element, 'source', by(isSncCandidateSource));
  const reason = need(out, element, 'reason', by(isSncUnusableReason));
  if (reason === 'wrong architecture') mayList(out, element, 'archs', sncArch);
  return out;
}

function snc(input: object, out: Out): void {
  const problem = need(out, input, 'problem', by(isSncProblem));
  switch (problem) {
    case 'no-credential':
      may(out, input, 'secureLoginClient', isBoolean);
      mayList(out, input, 'libraryArchs', sncArch);
      return;
    case 'library-init-failed':
      mayList(out, input, 'libraryArchs', sncArch);
      return;
    case 'logon-refused':
      may(out, input, 'rfcKey', by(isRfcKey));
      return;
    case 'library-not-found': {
      may(out, input, 'searched', isTrue);
      const read = readArray(input, 'candidates');
      if (read !== undefined) {
        const candidates: Out[] = [];
        for (const element of read.elements) {
          if (element === undefined) continue;
          if (candidates.length >= SNC_CANDIDATES_MAX) break;
          candidates.push(sncCandidate(element));
        }
        out.candidates = candidates;
      }
      may(out, input, 'processArch', sncArch);
      return;
    }
    default:
      return;
  }
}

function systemRefused(input: object, out: Out): void {
  const verdict = need(out, input, 'verdict', by(isSystemRefusedVerdict));
  if (verdict === 'rfc-failure') {
    need(out, input, 'rfcKey', by(isRfcKey));
  } else if (verdict !== 'unknown') {
    need(out, input, 'status', httpStatus);
  }
  need(out, input, 'at', rejectionMoment);
}

/** One validator per kind: fills `out`, throws `Invalid` for a required fact. */
const CHECKERS = Object.freeze({
  configuration,
  'client-certificate': (input: object, out: Out) => {
    need(out, input, 'problem', by(isClientCertificateProblem));
  },
  'client-authentication': (input: object, out: Out) => {
    need(out, input, 'problem', by(isClientAuthenticationProblem));
  },
  'request-failed': (input: object, out: Out) => {
    need(out, input, 'operation', operation);
    may(out, input, 'grant', grant);
    need(out, input, 'problem', by(isRequestProblem));
    may(out, input, 'status', httpStatus);
    may(out, input, 'oauthError', oauthError);
    may(out, input, 'code', systemCode);
  },
  tls: (input: object, out: Out) => {
    need(out, input, 'operation', operation);
    may(out, input, 'grant', grant);
    need(out, input, 'code', by(isTlsFailureCode));
  },
  'interactive-login': interactiveLogin,
  'saml-assertion': (input: object, out: Out, checks: RuleChecks) =>
    samlAssertion(input, out, checks),
  snc,
  'credential-refused': (input: object, out: Out) => {
    need(out, input, 'credential', by(isCredentialKind));
    may(out, input, 'at', rejectionMoment);
  },
  'system-refused': systemRefused,
  'renewal-unchanged': (input: object, out: Out) => {
    need(out, input, 'source', by(isRenewalUnchangedSource));
  },
  'renewal-declined': (input: object, out: Out) => {
    need(out, input, 'trigger', by(isRenewalTrigger));
  },
  'token-binding': (input: object, out: Out) => {
    need(out, input, 'problem', by(isTokenBindingProblem));
  },
  'not-prepared': (input: object, out: Out) => {
    need(out, input, 'provider', by(isNotPreparedProvider));
  },
  'logon-target': (input: object, out: Out) => {
    need(out, input, 'wire', by(isLogonTargetWire));
    need(out, input, 'refused', by(isLogonTargetRefusal));
  },
  connection: (input: object, out: Out) => {
    need(out, input, 'problem', by(isConnectionProblem));
    may(out, input, 'at', by(isConnectionMoment));
  },
  unknown: (input: object, out: Out) => {
    need(out, input, 'operation', operation);
    may(out, input, 'grant', grant);
    may(out, input, 'status', httpStatus);
    may(out, input, 'oauthError', oauthError);
    may(out, input, 'code', systemCode);
  },
}) satisfies {
  readonly [K in AuthProviderErrorKind]: (
    input: object,
    out: Out,
    checks: RuleChecks,
  ) => void;
};

/**
 * The facts of `kind` read from `facts` and checked, as a fresh object, or
 * `undefined` when a required fact is absent or invalid. Never throws, never
 * invokes a getter or a conversion. `checks` is the rule → check table.
 */
export function checkFacts<K extends AuthProviderErrorKind>(
  kind: K,
  facts: unknown,
  checks: RuleChecks,
): AuthProviderErrorFacts[K] | undefined;
export function checkFacts(
  kind: AuthProviderErrorKind,
  facts: unknown,
  checks: RuleChecks,
): object | undefined {
  if (facts === null || typeof facts !== 'object') return undefined;
  if (!hasOwn(CHECKERS, kind)) return undefined;
  const out: Out = {};
  try {
    CHECKERS[kind](facts, out, checks);
  } catch {
    return undefined;
  }
  return out;
}
