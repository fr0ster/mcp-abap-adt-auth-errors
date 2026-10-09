/**
 * The default words: `reason` and `hint` rendered from `kind`
 * and `facts` only — never from a diagnostic, never from anything a thrown
 * value said. A builder renders them once, at minting; `render` gives any
 * consumer the same words from the same facts.
 *
 * Exhaustive by construction: `WORDS` satisfies a mapped type over every
 * kind, and every discriminant within a kind is a `switch` ending in
 * `unreachable(x: never)` — a kind, `case`, `rule`, `outcome`, `problem` or
 * other discriminant member without words does not compile. Every table here
 * is module-private or frozen; none is a `Set` or a `Map`.
 *
 * No word mentions a timeout: there is no built-in login timeout.
 */
import {
  type AssertionRuleCheck,
  type AuthProviderErrorFacts,
  type AuthProviderErrorKind,
  BASIC_ENCODINGS,
  type BearerCandidate,
  type Count,
  type HttpStatus,
  type IAuthProviderError,
  type OAuth2GrantType,
  type OAuthErrorCode,
  type Operation,
  type RejectionMoment,
  SNC_QOP_VALUES,
  type SncArch,
  type SncCandidate,
  type SystemCode,
  type TlsFailureCode,
} from '@mcp-abap-adt/interfaces-auth';
import { readOwn } from './admission';
import {
  isAuthProviderErrorKind,
  isSncCandidateSource,
  isSncUnusableReason,
} from './allowlists';
import { checkFacts } from './factCheck';

/** What a kind's words are: a reason, and a hint when there is one. */
export type Words = { readonly reason: string; readonly hint?: string };

/** The words table: one renderer per kind, taking that kind's facts. */
export type WordsTable = {
  readonly [K in AuthProviderErrorKind]: (
    facts: AuthProviderErrorFacts[K],
  ) => Words;
};

/** Words with a hint only when one is given — never an `undefined` hint. */
function say(reason: string, hint?: string): Words {
  return hint === undefined ? { reason } : { reason, hint };
}

/** What a value of a kind or discriminant this build does not know says. */
const UNFAMILIAR_REASON =
  'an authentication error of a kind this version does not know';

/**
 * Thrown inside the renderers when the facts hold something this build does
 * not know — a discriminant, a table key, a missing required fact — and
 * caught by `render`, which then answers the unfamiliar words for the whole
 * error. Module-private: nothing outside this module ever sees it.
 */
class Unfamiliar extends Error {}

/**
 * The end of every discriminant `switch`: compiles only when every member was
 * handled. At run time (a value this build does not know, from a caller that
 * bypassed the types) the whole rendering answers the unfamiliar words —
 * never a sentence with a piece of them spliced in.
 */
export function unreachable(_value: never): never {
  throw new Unfamiliar();
}

const hasOwn = Object.hasOwn;

/**
 * The entry of `table` under `key`, read as an own property only — so
 * `constructor`, `toString` or `__proto__` never reach `Object.prototype` —
 * else the whole rendering is unfamiliar.
 */
function own<V>(table: { readonly [key: string]: V }, key: unknown): V {
  if (typeof key === 'string' && hasOwn(table, key)) {
    const value = table[key];
    if (value !== undefined) return value;
  }
  throw new Unfamiliar();
}

/** A fact the words need: absent, the whole rendering is unfamiliar. */
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Unfamiliar();
  return value;
}

/** `values` joined by `separator`, read by index (never the array's own methods). */
function joined(values: readonly string[], separator: string): string {
  let text = '';
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) continue;
    text = text === '' ? value : `${text}${separator}${value}`;
  }
  return text;
}

// ---------------------------------------------------------------- operations

/**
 * Each operation's phrase, the subject of "<phrase> failed (…)" — today's
 * `what` where one exists, so A1 and A13–A16 stay verbatim.
 */
const OPERATION_PHRASE = Object.freeze({
  'token-request': 'the token request',
  refresh: 'the refresh',
  'persisting-tokens': 'persisting the tokens',
  'renewal-strategy': 'the renewal strategy',
  'presenting-token': 'presenting the token',
  'presenting-certificate': 'presenting the certificate',
  'loading-certificate': 'loading the certificate',
  'writing-authorization-header': 'writing the Authorization header',
  'offering-logon-parameters': 'offering the logon parameters',
  'writing-session-cookies': 'writing the session cookies',
  'reading-rejection': 'reading the rejection',
  'token-source': 'the token source',
  'resolving-snc-library': 'resolving the SNC library',
  'handing-over-snc-parameters': 'handing over the SNC logon parameters',
  'authorizing-snc-request': 'authorizing a request',
  'explaining-snc-refusal': 'explaining the SNC refusal',
  'probing-snc-product': 'the probe',
  'presenting-device-code': 'the presenter',
  'saml-token-exchange': 'the SAML token exchange',
  'saml-token-refresh': 'the SAML token refresh',
  'browser-login': 'the browser login',
  'opening-browser': 'opening the browser',
  'presenting-authorization-url': 'presenting the authorization URL',
  'judging-answer': 'judging an answer',
  'passcode-exchange': 'the passcode exchange',
  'device-authorization': 'the OIDC device authorization',
  'password-grant': 'the OIDC password grant',
  'client-credentials': 'the client credentials request',
  'token-refresh': 'the token refresh',
  'oidc-discovery': 'OIDC discovery',
  'code-exchange': 'the code exchange',
  'device-poll': 'the device poll',
  'oidc-token-request': 'the OIDC token request',
  'validating-assertion': 'validating the SAML assertion',
  'client-authentication-strategy': 'the clientAuthentication strategy',
  // Never rendered as a phrase: `subject` refuses it (the whole words are
  // the unfamiliar sentence).
  'unfamiliar-error': UNFAMILIAR_REASON,
  preparing: 'preparing',
  establishing: 'establishing the logon',
  authorizing: 'authorizing the request',
}) satisfies { readonly [O in Operation]: string };

/** What was being done: `<grant> token request` for a token request. */
function subject(operation: Operation, grant?: OAuth2GrantType): string {
  // An unfamiliar error is not something that was being done: its words are
  // its own sentence, never "<phrase> failed" or "<phrase> returned".
  if (operation === 'unfamiliar-error') throw new Unfamiliar();
  if (operation === 'token-request' && grant !== undefined) {
    return `${grant} token request`;
  }
  return own(OPERATION_PHRASE, operation);
}

/**
 * "<phrase> failed" — and, for the four SNC moments, today's
 * "the SNC provider failed while <moment>" (G10).
 */
function failed(operation: Operation, grant?: OAuth2GrantType): string {
  switch (operation) {
    case 'resolving-snc-library':
    case 'handing-over-snc-parameters':
    case 'authorizing-snc-request':
    case 'explaining-snc-refusal':
      return `the SNC provider failed while ${own(OPERATION_PHRASE, operation)}`;
    default:
      return `${subject(operation, grant)} failed`;
  }
}

/** The safe facts of a failure, in today's order: status, OAuth error, code. */
function safeFacts(
  status: HttpStatus | undefined,
  oauthError: OAuthErrorCode | undefined,
  code: SystemCode | undefined,
): string[] {
  const facts: string[] = [];
  if (status !== undefined) facts.push(`HTTP ${status}`);
  if (oauthError !== undefined) facts.push(oauthError);
  if (code !== undefined) facts.push(code);
  return facts;
}

/**
 * Today's parenthesis for a failure that is not a token endpoint's: a status
 * says what happened; without one, "unknown error" leads (A1, A16, K11).
 */
function unknownClause(
  status: HttpStatus | undefined,
  oauthError: OAuthErrorCode | undefined,
  code: SystemCode | undefined,
): string {
  const facts = safeFacts(status, oauthError, code);
  return status !== undefined
    ? joined(facts, ', ')
    : joined(['unknown error', ...facts], ', ');
}

// ----------------------------------------------------------------------- tls

interface TlsWords {
  readonly says: string;
  readonly hint: string;
}

const UNTRUSTED_SERVER: TlsWords = Object.freeze({
  says: "the server's certificate is not trusted",
  hint: 'if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS',
});

const REFUSED_CLIENT_CERTIFICATE: TlsWords = Object.freeze({
  says: 'the server refused the client certificate',
  hint: "check that the server trusts the certificate's issuer and that the certificate is valid and not revoked",
});

/** Today's words per TLS code (auth-providers `knownCodes.ts` `TLS_CODES`). */
const TLS_WORDS = Object.freeze({
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: UNTRUSTED_SERVER,
  SELF_SIGNED_CERT_IN_CHAIN: UNTRUSTED_SERVER,
  DEPTH_ZERO_SELF_SIGNED_CERT: UNTRUSTED_SERVER,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: UNTRUSTED_SERVER,
  CERT_HAS_EXPIRED: Object.freeze({
    says: "the server's certificate has expired",
    hint: "the server must renew its certificate; check also this machine's clock",
  }),
  ERR_TLS_CERT_ALTNAME_INVALID: Object.freeze({
    says: "the host name is not in the server's certificate",
    hint: "use the host name the server's certificate is issued for",
  }),
  ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED: REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_TLSV1_ALERT_UNKNOWN_CA: REFUSED_CLIENT_CERTIFICATE,
  'ERR_SSL_SSL/TLS_ALERT_BAD_CERTIFICATE': REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE: REFUSED_CLIENT_CERTIFICATE,
  'ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN': REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN: REFUSED_CLIENT_CERTIFICATE,
  'ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_EXPIRED': REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED: REFUSED_CLIENT_CERTIFICATE,
  'ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_REVOKED': REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED: REFUSED_CLIENT_CERTIFICATE,
  'ERR_SSL_SSL/TLS_ALERT_UNSUPPORTED_CERTIFICATE': REFUSED_CLIENT_CERTIFICATE,
  ERR_SSL_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE: REFUSED_CLIENT_CERTIFICATE,
}) satisfies { readonly [C in TlsFailureCode]: TlsWords };

// ------------------------------------------------------------- configuration

const CHECK_CONFIGURATION = 'check the provider configuration';

/** `'raw' or 'form'`: each value quoted, the last joined by "or". */
function quotedAlternatives(values: readonly string[]): string {
  const quoted: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    quoted.push(`'${values[index]}'`);
  }
  const last = quoted.pop();
  if (last === undefined) return '';
  return quoted.length === 0 ? last : `${joined(quoted, ', ')} or ${last}`;
}

function configurationWords(
  facts: AuthProviderErrorFacts['configuration'],
): Words {
  switch (facts.case) {
    case 'required-fields-missing': {
      const fields = joined(facts.fields, ', ');
      return say(
        fields === ''
          ? 'required configuration is missing'
          : `required configuration is missing: ${fields}`,
        CHECK_CONFIGURATION,
      );
    }
    case 'invalid-value': {
      const fields = joined(facts.fields, ', ');
      return say(
        fields === ''
          ? 'a configured value cannot be used'
          : `a configured value cannot be used: ${fields}`,
      );
    }
    case 'client-secret-beside-client-authentication':
      return say(
        'clientSecret cannot be given beside clientAuthentication',
        'give the secret to the clientAuthentication strategy, or drop the strategy',
      );
    case 'saml-acs-required-with-authorization-url':
      return say(
        'acsUrl is required when authorizationUrl is set: the ACS inside a pre-built SAML request cannot be read, so it must be declared',
        CHECK_CONFIGURATION,
      );
    case 'saml-idp-initiated-with-request-id':
      return say(
        'SAML idpInitiated is true, but a request ID was also configured or minted: an IdP-initiated login sends no request',
        'remove one of them',
      );
    case 'saml-shipped-validator-without-issuer':
      return say(
        'the supplied assertionValidator is a shipped one, which refuses every assertion without an expected issuer: idpEntityId is missing',
        CHECK_CONFIGURATION,
      );
    case 'saml-token-endpoint-missing':
      return say(
        'the SAML bearer exchange needs tokenUrl or uaaUrl',
        CHECK_CONFIGURATION,
      );
    case 'saml-idp-initiated-without-authorization-url':
      return say(
        'SAML idpInitiated is true and no authorizationUrl is configured, but the authorization strategy asked for an authorization URL',
        'configure the IdP-initiated SSO URL as authorizationUrl, or use a strategy that does not call buildAuthorizationUrl',
      );
    case 'saml-acs-mismatch':
      return say(
        'SAML acsUrl and the address the authorization strategy used do not match',
        'they must match',
      );
    case 'saml-in-response-to-undeclared':
      return say(
        'cannot validate InResponseTo: this login did not build its own AuthnRequest',
        'configure authnRequestId, or idpInitiated: true if the identity provider starts this login itself',
      );
    case 'client-id-required-with-client-authentication':
      return say(
        'clientId is required with a client authentication',
        CHECK_CONFIGURATION,
      );
    case 'redirect-mismatch':
      return say(
        'the pre-built authorizationUrl declares a redirect_uri the authorization strategy did not use',
        'an ephemeral port cannot be used with a pre-built URL',
      );
    case 'oidc-discovery-needs-issuer':
      return say(
        'OIDC issuerUrl is required when discovery is used',
        CHECK_CONFIGURATION,
      );
    case 'oidc-endpoint-missing': {
      const fields = joined(facts.fields, ', ');
      const several = facts.fields.length > 1;
      return say(
        fields === ''
          ? 'OIDC endpoint is required (configure it, or use discovery)'
          : several
            ? `OIDC ${fields} are required (configure them, or use discovery)`
            : `OIDC ${fields} is required (configure it, or use discovery)`,
        CHECK_CONFIGURATION,
      );
    }
    case 'certificate-pem-and-pfx':
      return say(
        'certificate auth: provide either PEM (certPath + certKeyPath) or certPfxPath, not both',
        CHECK_CONFIGURATION,
      );
    case 'certificate-files-missing':
      return say(
        'certificate auth requires certPfxPath, or certPath and certKeyPath',
        CHECK_CONFIGURATION,
      );
    case 'basic-encoding-missing':
      return say(
        `clientSecretBasic needs encoding: ${quotedAlternatives(BASIC_ENCODINGS)}`,
        CHECK_CONFIGURATION,
      );
    case 'snc-partner-name-missing':
      return say(
        "SncLogonProvider needs partnerName — the system's SNC name",
        CHECK_CONFIGURATION,
      );
    case 'snc-qop-invalid':
      return say(
        `SncLogonProvider: qop must be one of ${joined(SNC_QOP_VALUES, ', ')}`,
        CHECK_CONFIGURATION,
      );
    case 'unsupported-sso-flow':
      return say(
        'unsupported SSO provider config: no provider for this protocol and flow',
        CHECK_CONFIGURATION,
      );
    case 'validator-clock-skew-invalid':
      return say(
        'clockSkewMs must be a finite non-negative integer',
        CHECK_CONFIGURATION,
      );
    case 'validator-no-certificates':
      return say(
        'idpCertificates must not be empty: nothing could be verified',
        CHECK_CONFIGURATION,
      );
    case 'idp-certificate-invalid':
      return say(
        'a configured IdP certificate is not a valid X.509 certificate in PEM or base64 DER',
        CHECK_CONFIGURATION,
      );
    case 'static-code-without-payload':
      return say('staticCodeStrategy requires a payload', CHECK_CONFIGURATION);
    case 'callback-port-invalid':
      return say(
        'invalid callback server port: it must be an integer in 0..65535',
        CHECK_CONFIGURATION,
      );
    default:
      return unreachable(facts);
  }
}

// ------------------------------------------------- the small closed kinds

function clientCertificateWords(
  facts: AuthProviderErrorFacts['client-certificate'],
): Words {
  switch (facts.problem) {
    case 'incomplete':
      return say(
        'the client certificate is incomplete',
        'give a PFX, or a certificate together with its key',
      );
    case 'unusable':
      return say(
        'the client certificate could not be used',
        'check the certificate, the key and the passphrase, and that a PFX uses current encryption (not legacy RC2)',
      );
    case 'expired':
      return say(
        'the client certificate has expired',
        'renew the certificate; a token provider pins its certificate for life, so give the renewed one to a new provider',
      );
    default:
      return unreachable(facts.problem);
  }
}

function clientAuthenticationWords(
  facts: AuthProviderErrorFacts['client-authentication'],
): Words {
  switch (facts.problem) {
    case 'signing-key-unusable':
      return say(
        'the client signing key could not be used',
        'check the private key and that it matches the algorithm',
      );
    case 'result-unsendable':
      return say(
        'the client authentication returned a request that cannot be sent',
        'check the client authentication strategy',
      );
    case 'basic-client-id-colon':
      return say(
        "the client id contains ':', which raw Basic cannot carry",
        "use encoding: 'form' or clientSecretPost",
      );
    default:
      return unreachable(facts.problem);
  }
}

function requestFailedWords(
  facts: AuthProviderErrorFacts['request-failed'],
): Words {
  switch (facts.problem) {
    case 'refused':
    case 'no-response': {
      const known = safeFacts(facts.status, facts.oauthError, facts.code);
      return say(
        `${failed(facts.operation, facts.grant)} (${
          known.length > 0
            ? joined(known, ', ')
            : 'the token endpoint gave no reason'
        })`,
      );
    }
    case 'no-access-token':
      return say(
        `${subject(facts.operation, facts.grant)} returned no access_token`,
      );
    case 'incomplete-response':
      return say(
        `${subject(facts.operation, facts.grant)} returned an incomplete response`,
      );
    default:
      return unreachable(facts.problem);
  }
}

function tlsWords(facts: AuthProviderErrorFacts['tls']): Words {
  const words: TlsWords = own(TLS_WORDS, facts.code);
  return say(
    `${failed(facts.operation, facts.grant)}: ${words.says} (${facts.code})`,
    words.hint,
  );
}

// --------------------------------------------------------- interactive login

const IDENTITY_PROVIDER_HINT =
  'check the identity provider: the user, the client and the scopes it allows';

/**
 * `; <k> request(s) to the callback server were refused and ignored`, k > 0:
 * every request the transport refused while the login waited — no payload, a
 * foreign `state`, a foreign `Host`, a forged paste.
 */
function ignoredClause(ignored: Count | undefined): string {
  return ignored !== undefined && ignored > 0
    ? `; ${ignored} request(s) to the callback server were refused and ignored`
    : '';
}

function interactiveLoginWords(
  facts: AuthProviderErrorFacts['interactive-login'],
): Words {
  switch (facts.outcome) {
    case 'port-in-use':
      return say(
        `Port ${required(facts.port)} is already in use. Please specify a different port or free the port.`,
      );
    case 'aborted': {
      const strategy = facts.strategy;
      switch (strategy) {
        case undefined:
          return say(
            `the authorization was aborted${ignoredClause(facts.ignoredCallbacks)}`,
          );
        case 'browser':
          return say(
            `the browser login was aborted${ignoredClause(facts.ignoredCallbacks)}`,
          );
        case 'manual':
          return say('the manual login was aborted');
        case 'consumer':
          return say('the login was aborted');
        default:
          return unreachable(strategy);
      }
    }
    case 'disposed': {
      const strategy = facts.strategy;
      switch (strategy) {
        case 'browser':
          return say('the browser authorization strategy was disposed');
        case 'manual':
          return say('the manual strategy was disposed');
        case 'consumer':
          return say('the authorization strategy was disposed');
        default:
          return unreachable(strategy);
      }
    }
    case 'busy':
      return say('an authorization is already in progress with this strategy');
    case 'callback-closed':
      return say('the callback server closed before a result arrived');
    case 'identity-provider-refused':
      return say(
        `the identity provider refused the login (${
          facts.oauthError ?? 'an unregistered error code'
        })`,
        IDENTITY_PROVIDER_HINT,
      );
    case 'input-abandoned':
      return say('the manual input was abandoned before it began');
    case 'no-input':
      return say('no input was received');
    case 'unreadable-input':
      return say('Could not read an authorization code from that input');
    case 'no-terminal':
      return say(
        'Manual input needs an interactive terminal. Supply `read` to source the value elsewhere.',
      );
    case 'device-code-not-shown':
      return say('showing the device code failed');
    case 'failed':
      return say(
        `the browser login failed (${unknownClause(facts.status, facts.oauthError, facts.code)})`,
        'complete the login, or abort it',
      );
    default:
      return unreachable(facts);
  }
}

// -------------------------------------------------------------------- SAML

/**
 * The check each rule belongs to — fixed by the rule, frozen. It satisfies
 * interfaces-auth's `AssertionRuleCheck`, so a rule without a
 * check, or with another one, does not compile.
 */
export const ASSERTION_RULE_CHECK = Object.freeze({
  doctype: 'document',
  'not-xml': 'document',
  'root-not-response-or-assertion': 'document',
  'root-not-response': 'document',
  'duplicate-id': 'duplicateId',
  'no-signature': 'signature',
  'signature-malformed': 'signature',
  'signature-not-verified': 'signature',
  'no-reference': 'signature',
  'several-references': 'signature',
  'reference-not-same-document': 'signature',
  'reference-not-found': 'signature',
  'signature-not-enveloped': 'signature',
  'no-direct-assertion': 'signedNode',
  'several-direct-assertions': 'signedNode',
  'response-not-signed': 'signedNode',
  'assertion-not-signed': 'signedNode',
  'assertion-outside-signed': 'signedNode',
  'assertion-inside-signature': 'signedNode',
  'no-status': 'status',
  'several-status': 'status',
  'no-status-code': 'status',
  'several-status-codes': 'status',
  'status-code-no-value': 'status',
  declined: 'status',
  'no-assertion-id': 'assertionId',
  'no-issuer': 'issuer',
  'several-issuers': 'issuer',
  'empty-issuer': 'issuer',
  'no-expected-issuer': 'issuer',
  'untrusted-issuer': 'issuer',
  'several-response-issuers': 'issuer',
  'issuers-differ': 'issuer',
  'no-conditions': 'conditions',
  'several-conditions': 'conditions',
  'not-before-invalid': 'notBefore',
  'not-yet-valid': 'notBefore',
  'no-not-on-or-after': 'notOnOrAfter',
  'not-on-or-after-invalid': 'notOnOrAfter',
  expired: 'notOnOrAfter',
  'no-audience-restriction': 'audience',
  'audience-restriction-empty': 'audience',
  'audience-not-us': 'audience',
  'no-subject': 'bearerConfirmation',
  'several-subjects': 'bearerConfirmation',
  'no-subject-confirmation': 'bearerConfirmation',
  'no-bearer-qualifies': 'bearerConfirmation',
  'no-destination': 'destination',
  'destination-not-us': 'destination',
  replayed: 'replay',
  'payload-not-base64-xml': 'document',
  'payload-not-well-formed': 'document',
  'payload-not-saml': 'document',
  'only-encrypted-assertion': 'document',
  'no-assertion': 'document',
  'several-assertions': 'document',
}) satisfies AssertionRuleCheck;

/** "carries <n> <what>; exactly one is allowed", the count a fact. */
function carriesSeveral(
  holder: string,
  count: Count | undefined,
  what: string,
): string {
  return `${holder} carries ${count ?? 'more than one'} ${what}; exactly one is allowed`;
}

/** One bearer candidate's first failed sub-rule — today's words. */
function candidateWords(candidate: BearerCandidate): string {
  switch (candidate.reason) {
    case 'method-not-bearer':
      return 'Method is not bearer';
    case 'no-confirmation-data':
      return 'carries no SubjectConfirmationData';
    case 'several-confirmation-data':
      return `carries ${candidate.count ?? 'more than one'} SubjectConfirmationData; exactly one is allowed`;
    case 'in-response-to-unexpected':
      return 'InResponseTo is present, but this login sent no request';
    case 'in-response-to-mismatch':
      return 'InResponseTo does not answer our request';
    case 'recipient-not-acs':
      return 'Recipient is not the ACS';
    case 'no-not-on-or-after':
      return 'SubjectConfirmationData has no NotOnOrAfter';
    case 'not-on-or-after-invalid':
      return 'SubjectConfirmationData NotOnOrAfter is not a valid xsd:dateTime';
    case 'not-before-invalid':
      return 'SubjectConfirmationData NotBefore is not a valid xsd:dateTime';
    case 'not-on-or-after-passed':
      return 'NotOnOrAfter has passed';
    case 'not-before-not-arrived':
      return 'NotBefore has not arrived';
    default:
      return unreachable(candidate);
  }
}

/** `#1 <reason> | #2 <reason>[ | and N more]` (today's `describeRefusals`). */
function noBearerQualifies(
  candidates: readonly BearerCandidate[] | undefined,
  more: Count | undefined,
): string {
  const parts: string[] = [];
  if (candidates !== undefined) {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (candidate !== undefined) {
        parts.push(`#${index + 1} ${candidateWords(candidate)}`);
      }
    }
  }
  const hidden = more !== undefined && more > 0 ? more : 0;
  if (parts.length === 0) {
    return hidden === 0
      ? 'no bearer confirmation qualifies'
      : `no bearer confirmation qualifies (${hidden} ${hidden === 1 ? 'candidate' : 'candidates'} not shown)`;
  }
  if (hidden > 0) parts.push(`and ${hidden} more`);
  return `no bearer confirmation qualifies: ${joined(parts, ' | ')}`;
}

/**
 * Each rule's words: today's message (README "Refusal messages",
 * `samlBearerAssertion.ts`) with each quoted document value removed — the
 * value is a diagnostic, rendered apart, never here.
 */
function ruleWords(facts: AuthProviderErrorFacts['saml-assertion']): string {
  switch (facts.rule) {
    case 'doctype':
      return 'the SAMLResponse carries a DOCTYPE declaration, which is never accepted';
    case 'not-xml':
      return 'the SAMLResponse did not parse as XML';
    case 'root-not-response-or-assertion':
      return 'expected a samlp:Response or a saml:Assertion';
    case 'root-not-response':
      return 'expected the document element to be a samlp:Response';
    case 'duplicate-id':
      return 'the document uses an ID more than once, so which element is signed is ambiguous';
    case 'no-signature':
      return 'the document carries no signature';
    case 'signature-malformed':
      return 'the signature element is malformed';
    case 'signature-not-verified':
      return 'the signature does not verify against any configured certificate';
    case 'no-reference':
      return 'the signature carries no ds:Reference';
    case 'several-references':
      return carriesSeveral('the signature', facts.count, 'ds:Reference');
    case 'reference-not-same-document':
      return 'the signature reference is not a same-document URI';
    case 'reference-not-found':
      return 'the signature references an element that is not in the document';
    case 'signature-not-enveloped':
      return 'the signature is not inside the element it references, so it does not envelope it';
    case 'no-direct-assertion':
      return 'the response carries no direct-child saml:Assertion';
    case 'several-direct-assertions':
      return carriesSeveral(
        'the response',
        facts.count,
        'direct-child saml:Assertion',
      );
    case 'response-not-signed':
      return 'the signature does not cover the samlp:Response this validator requires';
    case 'assertion-not-signed':
      return 'the signature does not cover the saml:Assertion this validator requires';
    case 'assertion-outside-signed':
      return 'the document carries an Assertion or EncryptedAssertion, SAML 2.0 or 1.x, outside the one the signature covers';
    case 'assertion-inside-signature':
      return 'the document carries an Assertion or EncryptedAssertion inside a ds:Signature, which is never accepted';
    case 'no-status':
      return 'the response carries no samlp:Status';
    case 'several-status':
      return carriesSeveral('the response', facts.count, 'samlp:Status');
    case 'no-status-code':
      return 'the samlp:Status carries no samlp:StatusCode';
    case 'several-status-codes':
      return carriesSeveral(
        'the samlp:Status',
        facts.count,
        'samlp:StatusCode',
      );
    case 'status-code-no-value':
      return 'the samlp:StatusCode carries no Value';
    case 'declined':
      return facts.statusCode === undefined
        ? 'the identity provider declined the login'
        : `the identity provider declined the login (${facts.statusCode})`;
    case 'no-assertion-id':
      return 'the assertion carries no ID';
    case 'no-issuer':
      return 'the assertion carries no saml:Issuer';
    case 'several-issuers':
      return carriesSeveral('the assertion', facts.count, 'saml:Issuer');
    case 'empty-issuer':
      return "the assertion's saml:Issuer is empty";
    case 'no-expected-issuer':
      return 'no expectedIssuer was configured, so the assertion issuer cannot be trusted';
    case 'untrusted-issuer':
      return 'the assertion was not issued by the trusted issuer';
    case 'several-response-issuers':
      return 'the response must carry at most one saml:Issuer';
    case 'issuers-differ':
      return 'the response and the assertion name different issuers';
    case 'no-conditions':
      return 'the assertion carries no saml:Conditions';
    case 'several-conditions':
      return carriesSeveral('the assertion', facts.count, 'saml:Conditions');
    case 'not-before-invalid':
      return 'Conditions NotBefore is not a valid xsd:dateTime';
    case 'not-yet-valid':
      return 'the assertion is not valid yet';
    case 'no-not-on-or-after':
      return 'Conditions carries no NotOnOrAfter, so the assertion states no lifetime';
    case 'not-on-or-after-invalid':
      return 'Conditions NotOnOrAfter is not a valid xsd:dateTime';
    case 'expired':
      return 'the assertion has expired';
    case 'no-audience-restriction':
      return 'the assertion restricts no audience';
    case 'audience-restriction-empty':
      return 'an AudienceRestriction names no audience';
    case 'audience-not-us':
      return 'an AudienceRestriction on this assertion does not name us';
    case 'no-subject':
      return 'the assertion carries no saml:Subject';
    case 'several-subjects':
      return carriesSeveral('the assertion', facts.count, 'saml:Subject');
    case 'no-subject-confirmation':
      return 'the saml:Subject holds no SubjectConfirmation';
    case 'no-bearer-qualifies':
      return noBearerQualifies(facts.candidates, facts.moreCandidates);
    case 'no-destination':
      return 'the response carries no Destination';
    case 'destination-not-us':
      return 'the response is not addressed to us';
    case 'replayed':
      return 'this assertion has been presented before';
    case 'payload-not-base64-xml':
      return 'SAML bearer payload is not base64-encoded XML';
    case 'payload-not-well-formed':
      return 'SAML bearer payload is not well-formed XML';
    case 'payload-not-saml':
      return 'SAML bearer payload is neither a SAML Response nor an Assertion';
    case 'only-encrypted-assertion':
      return 'SAML Response carries only an EncryptedAssertion; encrypted Assertions are not supported';
    case 'no-assertion':
      return 'SAML Response carries no Assertion';
    case 'several-assertions':
      return facts.count === undefined
        ? 'SAML Response carries more than one Assertion; a bearer grant takes one'
        : `SAML Response carries ${facts.count} Assertions; a bearer grant takes one`;
    default:
      return unreachable(facts);
  }
}

/** A3: `the SAML assertion was refused (<check>): <rule words>`. */
function samlAssertionWords(
  facts: AuthProviderErrorFacts['saml-assertion'],
): Words {
  // The check is the rule's own; facts naming another one are not this
  // build's to word.
  const check = own(ASSERTION_RULE_CHECK, facts.rule);
  if (facts.check !== check) throw new Unfamiliar();
  return say(`the SAML assertion was refused (${check}): ${ruleWords(facts)}`);
}

// --------------------------------------------------------------------- SNC

const LOCATE_HINT = 'set sncLib to the SNC (GSS) library of your SNC product';

/** The architectures, joined by `/` as today; empty when none is known. */
function archs(values: readonly SncArch[] | undefined): string {
  return values === undefined ? '' : joined(values, '/');
}

/** `<source> (<reason>); …` — never a path (G5). */
function candidateList(candidates: readonly SncCandidate[]): string {
  const parts: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined) {
      if (
        !isSncCandidateSource(candidate.source) ||
        !isSncUnusableReason(candidate.reason)
      ) {
        throw new Unfamiliar();
      }
      parts.push(`${candidate.source} (${candidate.reason})`);
    }
  }
  return joined(parts, '; ');
}

function sncWords(facts: AuthProviderErrorFacts['snc']): Words {
  switch (facts.problem) {
    case 'no-credential':
      return say(
        'the SNC library has no credential to present (A2200019)',
        facts.secureLoginClient === true
          ? 'log on in the Secure Login Client, to the profile used for SAP applications'
          : 'make sure the SNC product behind the SNC library is logged on',
      );
    case 'library-init-failed': {
      const known = archs(facts.libraryArchs);
      return say(
        `the RFC SDK could not initialise the SNC library${
          known === '' ? '' : ` (${known})`
        } as its SNC library (SNCERR_INIT)`,
      );
    }
    case 'logon-refused':
      return say(
        facts.rfcKey === undefined
          ? 'SNC logon refused'
          : `SNC logon refused (${facts.rfcKey})`,
      );
    case 'library-not-found': {
      const listed =
        facts.candidates === undefined ? '' : candidateList(facts.candidates);
      if (listed !== '') {
        return say(`no usable SNC library was found: ${listed}`, LOCATE_HINT);
      }
      if (facts.searched === true) {
        return say(
          'no usable SNC library was found: no candidate (SNC_LIB_64 and SNC_LIB are unset and no Secure Login Client installation was found)',
          LOCATE_HINT,
        );
      }
      return say('no usable SNC library was found', LOCATE_HINT);
    }
    case 'locator-returned-no-path':
      return say(
        'no usable SNC library was found: the locator returned no path',
        LOCATE_HINT,
      );
    default:
      return unreachable(facts);
  }
}

// ------------------------------------------------- credentials and rejection

function credentialRefusedWords(
  facts: AuthProviderErrorFacts['credential-refused'],
): Words {
  switch (facts.credential) {
    case 'user-password':
      return say(
        'the user or password was refused',
        'check the user and password',
      );
    case 'client-certificate':
      return say(
        'the client certificate was refused',
        'check that it is mapped to a user (CERTRULE / USREXTID)',
      );
    case 'saml-session':
      return say(
        'the SAML session was refused or has expired',
        'obtain a new SAML session',
      );
    case 'token':
      return say('the token was refused', 'obtain a new token');
    case 'refresh-token':
      return say('the refresh token was refused', 'log in again');
    default:
      return unreachable(facts.credential);
  }
}

/** `call` for a request, `logon` for a logon (B5); anything else is unfamiliar. */
function rfcMoment(at: RejectionMoment): 'call' | 'logon' {
  switch (at) {
    case 'request':
      return 'call';
    case 'logon':
      return 'logon';
    default:
      return unreachable(at);
  }
}

function systemRefusedWords(
  facts: AuthProviderErrorFacts['system-refused'],
): Words {
  switch (facts.verdict) {
    case 'not-authorized':
      return say(
        `the credential was accepted, but the user is not authorized (${required(facts.status)})`,
        "check the user's authorizations in the system",
      );
    case 'redirected':
      return say(
        `the system redirected instead of accepting the credential (${required(facts.status)})`,
        'the service may require another logon procedure (single sign-on, an identity provider)',
      );
    case 'system-failed':
      return say(
        `the system failed (${required(facts.status)}), not the credential`,
        'try again later',
      );
    case 'other-status':
      return say(
        `the system answered ${required(facts.status)}, which is not a credential refusal`,
      );
    case 'rfc-failure':
      return say(
        `the RFC ${rfcMoment(facts.at)} failed (${required(facts.rfcKey)}), not as a credential refusal`,
      );
    case 'unknown':
      return say(
        rfcMoment(facts.at) === 'call'
          ? 'the request was refused (unknown error)'
          : 'the logon failed (unknown error)',
      );
    default:
      return unreachable(facts);
  }
}

function renewalUnchangedWords(
  facts: AuthProviderErrorFacts['renewal-unchanged'],
): Words {
  switch (facts.source) {
    case 'token-source':
      return say(
        'the renewal returned the credential that was refused',
        'the token source must issue a new token',
      );
    case 'token-provider':
      return say(
        'the renewal returned the credential that was refused',
        'the token source must issue a new token; log in again',
      );
    default:
      return unreachable(facts.source);
  }
}

/** The trigger is checked against its allowlist and named in no word. */
function renewalDeclinedWords(): Words {
  return say('the renewal strategy declined to renew the credential');
}

function tokenBindingWords(
  facts: AuthProviderErrorFacts['token-binding'],
): Words {
  switch (facts.problem) {
    case 'bound-to-unpinned':
      return say(
        'the token is bound to a client certificate this provider does not present',
        'give the provider a clientAuthentication that presents the certificate the token was issued for',
      );
    case 'renewed-bound-elsewhere':
      return say(
        'the new token is bound to a client certificate this provider does not present',
        'the authorization server bound the new token to another certificate: check the certificate registered for this client',
      );
    default:
      return unreachable(facts.problem);
  }
}

function notPreparedWords(
  facts: AuthProviderErrorFacts['not-prepared'],
): Words {
  switch (facts.provider) {
    case 'certificate':
      return say(
        'the certificate is not loaded',
        'connect() prepares it first',
      );
    case 'snc':
      return say(
        'the SNC provider is not prepared',
        'connect() prepares it first',
      );
    default:
      return unreachable(facts.provider);
  }
}

// ---------------------------------------------- logon target and connection

function refusedThing(facts: AuthProviderErrorFacts['logon-target']): string {
  switch (facts.refused) {
    case 'tls-material':
      return 'the TLS material';
    case 'logon-parameters':
      return 'the logon parameters';
    default:
      return unreachable(facts.refused);
  }
}

function logonTargetWords(
  facts: AuthProviderErrorFacts['logon-target'],
): Words {
  switch (facts.wire) {
    case 'rfc':
      return say(
        facts.refused === 'tls-material'
          ? 'this wire carries no TLS material (RFC)'
          : `the logon target did not take ${refusedThing(facts)} (RFC)`,
      );
    case 'http':
      return say(
        facts.refused === 'logon-parameters'
          ? 'this wire takes no logon parameters (HTTP)'
          : `the logon target did not take ${refusedThing(facts)} (HTTP)`,
      );
    case 'unknown':
      return say(`the logon target did not take ${refusedThing(facts)}`);
    default:
      return unreachable(facts.wire);
  }
}

function connectionWords(facts: AuthProviderErrorFacts['connection']): Words {
  switch (facts.problem) {
    case 'provider-threw':
      return say('the credential provider failed');
    case 'refused-after-renewal':
      return say(
        'the credential was refused again after the provider renewed it',
      );
    case 'no-credential':
      return say('this connection has no credential to renew');
    default:
      return unreachable(facts.problem);
  }
}

function unknownWords(facts: AuthProviderErrorFacts['unknown']): Words {
  if (facts.operation === 'unfamiliar-error') return say(UNFAMILIAR_REASON);
  return say(
    `${failed(facts.operation, facts.grant)} (${unknownClause(
      facts.status,
      facts.oauthError,
      facts.code,
    )})`,
  );
}

// ------------------------------------------------------------------ the table

const WORDS_BY_KIND = {
  configuration: configurationWords,
  'client-certificate': clientCertificateWords,
  'client-authentication': clientAuthenticationWords,
  'request-failed': requestFailedWords,
  tls: tlsWords,
  'interactive-login': interactiveLoginWords,
  'saml-assertion': samlAssertionWords,
  snc: sncWords,
  'credential-refused': credentialRefusedWords,
  'system-refused': systemRefusedWords,
  'renewal-unchanged': renewalUnchangedWords,
  'renewal-declined': renewalDeclinedWords,
  'token-binding': tokenBindingWords,
  'not-prepared': notPreparedWords,
  'logon-target': logonTargetWords,
  connection: connectionWords,
  unknown: unknownWords,
} satisfies WordsTable;

/**
 * The default words of every kind. Module-private and frozen: no caller can
 * replace what a kind says. Typed by the mapped type itself, so `render` can
 * look up one kind's renderer for that kind's facts.
 */
const WORDS: WordsTable = Object.freeze(WORDS_BY_KIND);

/**
 * The default `{ reason, hint }` of `kind` with `facts` — the words a builder
 * stores, for a consumer that renders its own. Total: a kind or a
 * discriminant this build does not know, or facts it cannot read, answer the
 * unfamiliar words.
 */
export function render<K extends AuthProviderErrorKind>(
  kind: K,
  facts: AuthProviderErrorFacts[K],
): Words {
  if (!isAuthProviderErrorKind(kind)) return { reason: UNFAMILIAR_REASON };
  try {
    // Every fact read as an own data property and checked against its
    // allowlist or maker first: nothing unchecked reaches a word.
    const checked = checkFacts(kind, facts, ASSERTION_RULE_CHECK);
    if (checked === undefined) return { reason: UNFAMILIAR_REASON };
    const words: (facts: AuthProviderErrorFacts[K]) => Words = WORDS[kind];
    return words(checked);
  } catch {
    return { reason: UNFAMILIAR_REASON };
  }
}

// ------------------------------------------------------------------- blame

/**
 * Whether each kind blames the credential: a provider renews
 * only on a credential rejection. Module-private and frozen.
 */
const BLAME = Object.freeze({
  configuration: () => false,
  'client-certificate': () => false,
  'client-authentication': () => false,
  'request-failed': () => false,
  tls: () => false,
  'interactive-login': () => false,
  'saml-assertion': () => false,
  snc: (facts: AuthProviderErrorFacts['snc']) =>
    facts.problem === 'no-credential' ||
    (facts.problem === 'logon-refused' && facts.rfcKey === 'RFC_LOGON_FAILURE'),
  'credential-refused': () => true,
  'system-refused': () => false,
  'renewal-unchanged': () => true,
  'renewal-declined': () => false,
  'token-binding': () => false,
  'not-prepared': () => false,
  'logon-target': () => false,
  connection: (facts: AuthProviderErrorFacts['connection']) =>
    facts.problem === 'refused-after-renewal',
  unknown: () => false,
}) satisfies {
  readonly [K in AuthProviderErrorKind]: (
    facts: AuthProviderErrorFacts[K],
  ) => boolean;
};

const BLAME_BY_KIND: {
  readonly [K in AuthProviderErrorKind]: (
    facts: AuthProviderErrorFacts[K],
  ) => boolean;
} = BLAME;

function blameOf<K extends AuthProviderErrorKind>(
  kind: K,
  facts: AuthProviderErrorFacts[K],
): boolean {
  const blames: (facts: AuthProviderErrorFacts[K]) => boolean =
    BLAME_BY_KIND[kind];
  return blames(facts);
}

/**
 * Whether `error` blames the credential: `credential-refused`
 * and `renewal-unchanged` always; `snc` for `no-credential`, and for
 * `logon-refused` with `RFC_LOGON_FAILURE`; `connection` for
 * `refused-after-renewal`; nothing else. Total: a value that is not an
 * error, whose facts fail their check, or whose reads throw, does not blame
 * it.
 */
export function blamesCredential(error: IAuthProviderError): boolean {
  try {
    // Read as own data properties, once each, and the facts checked by the
    // same per-kind validator the builders use: the answer is the one the
    // error a builder would mint from them gives. No getter is invoked.
    const kind = readOwn(error, 'kind');
    if (!isAuthProviderErrorKind(kind)) return false;
    const facts = checkFacts(
      kind,
      readOwn(error, 'facts'),
      ASSERTION_RULE_CHECK,
    );
    if (facts === undefined) return false;
    return blameOf(kind, facts);
  } catch {
    return false;
  }
}
