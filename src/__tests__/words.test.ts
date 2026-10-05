import {
  ASSERTION_RULES,
  CLIENT_AUTHENTICATION_PROBLEMS,
  CLIENT_CERTIFICATE_PROBLEMS,
  CONFIG_CASES,
  CONNECTION_PROBLEMS,
  CREDENTIAL_KINDS,
  type IAuthProviderError,
  INTERACTIVE_OUTCOMES,
  LOGON_TARGET_REFUSALS,
  LOGON_TARGET_WIRES,
  NOT_PREPARED_PROVIDERS,
  OPERATIONS,
  RENEWAL_UNCHANGED_SOURCES,
  REQUEST_PROBLEMS,
  SNC_PROBLEMS,
  SYSTEM_REFUSED_VERDICTS,
  TLS_FAILURE_CODES,
  TOKEN_BINDING_PROBLEMS,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadBuiltModule } from './builtPackage';

/**
 * The default words (spec §5.6, §11.1 "Words"): every kind and every
 * discriminant renders; each row of Appendix A marked verbatim renders
 * today's string exactly; no diagnostic value reaches a word.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Words = { readonly reason: string; readonly hint?: string };

const built = loadBuilt();
const authError = built.authError as Record<string, Builder>;
const render = built.render as (kind: unknown, facts: unknown) => Words;
const blamesCredential = built.blamesCredential as (error: unknown) => boolean;
const httpStatus = built.httpStatus as (value: unknown) => number;
const count = built.count as (value: unknown) => number;
const port = built.port as (value: unknown) => number;
const ASSERTION_RULE_CHECK = loadBuiltModule('words')
  .ASSERTION_RULE_CHECK as Record<string, string>;

function build(kind: string, facts: unknown, diagnostics?: unknown) {
  const builder = authError[kind];
  if (builder === undefined) throw new Error(`no builder for ${kind}`);
  return builder(facts, diagnostics);
}

/** The words an error carries, `hint` only when it has one. */
function words(error: IAuthProviderError): Words {
  return error.hint === undefined
    ? { reason: error.reason }
    : { reason: error.reason, hint: error.hint };
}

function samlFacts(rule: string): Record<string, unknown> {
  const check = ASSERTION_RULE_CHECK[rule];
  if (check === undefined) throw new Error(`no check for ${rule}`);
  return { rule, check };
}

function interactiveFacts(outcome: string): Record<string, unknown> {
  if (outcome === 'port-in-use') return { outcome, port: port(61001) };
  if (outcome === 'disposed') return { outcome, strategy: 'browser' };
  return { outcome };
}

function verdictFacts(verdict: string): Record<string, unknown> {
  if (verdict === 'rfc-failure') {
    return { verdict, rfcKey: 'RFC_COMMUNICATION_FAILURE', at: 'logon' };
  }
  if (verdict === 'unknown') return { verdict, at: 'request' };
  return { verdict, status: httpStatus(418), at: 'request' };
}

/** One sample per kind × discriminant value: [label, kind, facts]. */
const SAMPLES: readonly (readonly [string, string, unknown])[] = [
  ...CONFIG_CASES.map(
    (c) =>
      [
        `configuration ${c}`,
        'configuration',
        { case: c, fields: ['clientId'] },
      ] as const,
  ),
  ...CLIENT_CERTIFICATE_PROBLEMS.map(
    (p) =>
      [
        `client-certificate ${p}`,
        'client-certificate',
        { problem: p },
      ] as const,
  ),
  ...CLIENT_AUTHENTICATION_PROBLEMS.map(
    (p) =>
      [
        `client-authentication ${p}`,
        'client-authentication',
        { problem: p },
      ] as const,
  ),
  ...REQUEST_PROBLEMS.map(
    (p) =>
      [
        `request-failed ${p}`,
        'request-failed',
        { operation: 'token-refresh', problem: p },
      ] as const,
  ),
  ...TLS_FAILURE_CODES.map(
    (code) =>
      [`tls ${code}`, 'tls', { operation: 'oidc-discovery', code }] as const,
  ),
  ...INTERACTIVE_OUTCOMES.map(
    (o) =>
      [
        `interactive-login ${o}`,
        'interactive-login',
        interactiveFacts(o),
      ] as const,
  ),
  ...ASSERTION_RULES.map(
    (r) => [`saml-assertion ${r}`, 'saml-assertion', samlFacts(r)] as const,
  ),
  ...SNC_PROBLEMS.map((p) => [`snc ${p}`, 'snc', { problem: p }] as const),
  ...CREDENTIAL_KINDS.map(
    (c) =>
      [
        `credential-refused ${c}`,
        'credential-refused',
        { credential: c },
      ] as const,
  ),
  ...SYSTEM_REFUSED_VERDICTS.map(
    (v) => [`system-refused ${v}`, 'system-refused', verdictFacts(v)] as const,
  ),
  ...RENEWAL_UNCHANGED_SOURCES.map(
    (s) =>
      [`renewal-unchanged ${s}`, 'renewal-unchanged', { source: s }] as const,
  ),
  ...TOKEN_BINDING_PROBLEMS.map(
    (p) => [`token-binding ${p}`, 'token-binding', { problem: p }] as const,
  ),
  ...NOT_PREPARED_PROVIDERS.map(
    (p) => [`not-prepared ${p}`, 'not-prepared', { provider: p }] as const,
  ),
  ...LOGON_TARGET_WIRES.flatMap((wire) =>
    LOGON_TARGET_REFUSALS.map(
      (refused) =>
        [
          `logon-target ${wire} ${refused}`,
          'logon-target',
          { wire, refused },
        ] as const,
    ),
  ),
  ...CONNECTION_PROBLEMS.map(
    (p) => [`connection ${p}`, 'connection', { problem: p }] as const,
  ),
  ...OPERATIONS.map(
    (operation) => [`unknown ${operation}`, 'unknown', { operation }] as const,
  ),
  ...OPERATIONS.map(
    (operation) =>
      [
        `request-failed ${operation}`,
        'request-failed',
        { operation, problem: 'refused', status: httpStatus(400) },
      ] as const,
  ),
  ...OPERATIONS.map(
    (operation) =>
      [
        `tls ${operation}`,
        'tls',
        { operation, code: 'CERT_HAS_EXPIRED' },
      ] as const,
  ),
];

describe('every kind × every discriminant renders', () => {
  it.each(SAMPLES)('%s', (_label, kind, facts) => {
    const error = build(kind, facts);
    expect(typeof error.reason).toBe('string');
    expect(error.reason.length).toBeGreaterThan(0);
    for (const text of [error.reason, error.hint ?? '']) {
      expect(text).not.toMatch(/undefined|null|\[object|NaN/);
    }
    if (error.hint !== undefined) expect(error.hint.length).toBeGreaterThan(0);
    expect(render(kind, error.facts)).toStrictEqual(words(error));
  });

  it.each([
    ['configuration', CONFIG_CASES.length],
    ['saml-assertion', ASSERTION_RULES.length],
    ['snc', SNC_PROBLEMS.length],
    ['interactive-login', INTERACTIVE_OUTCOMES.length],
    ['credential-refused', CREDENTIAL_KINDS.length],
    ['system-refused', SYSTEM_REFUSED_VERDICTS.length],
    ['client-certificate', CLIENT_CERTIFICATE_PROBLEMS.length],
    ['client-authentication', CLIENT_AUTHENTICATION_PROBLEMS.length],
    // refused and no-response without a fact share today's words (A14, D2):
    // `<operation> failed (the token endpoint gave no reason)`.
    ['request-failed', REQUEST_PROBLEMS.length - 1],
    ['connection', CONNECTION_PROBLEMS.length],
  ])('%s: each discriminant has its own reason', (kind, total) => {
    const reasons = new Set(
      SAMPLES.filter(([label, k]) =>
        kind === 'request-failed'
          ? REQUEST_PROBLEMS.some((p) => label === `request-failed ${p}`)
          : k === kind,
      ).map(([, k, facts]) => build(k, facts).reason),
    );
    expect(reasons.size).toBe(total);
  });

  it('distinct operations have distinct phrases', () => {
    const reasons = new Set(
      OPERATIONS.map((operation) => build('unknown', { operation }).reason),
    );
    expect(reasons.size).toBe(OPERATIONS.length);
  });
});

describe('ASSERTION_RULE_CHECK', () => {
  it('names a check for every rule, and is frozen', () => {
    expect(Object.keys(ASSERTION_RULE_CHECK).sort()).toEqual(
      [...ASSERTION_RULES].sort(),
    );
    expect(Object.isFrozen(ASSERTION_RULE_CHECK)).toBe(true);
  });
});

/** Appendix A rows marked verbatim: [row, kind, facts, reason, hint?]. */
const VERBATIM: readonly (readonly [
  string,
  string,
  unknown,
  string,
  string | undefined,
])[] = [
  [
    'A2',
    'interactive-login',
    { outcome: 'device-code-not-shown' },
    'showing the device code failed',
    undefined,
  ],
  [
    'K17',
    'interactive-login',
    { outcome: 'device-code-not-shown' },
    'showing the device code failed',
    undefined,
  ],
  [
    'A4 incomplete',
    'client-certificate',
    { problem: 'incomplete' },
    'the client certificate is incomplete',
    'give a PFX, or a certificate together with its key',
  ],
  [
    'A4 unusable',
    'client-certificate',
    { problem: 'unusable' },
    'the client certificate could not be used',
    'check the certificate, the key and the passphrase, and that a PFX uses current encryption (not legacy RC2)',
  ],
  [
    'A4 expired',
    'client-certificate',
    { problem: 'expired' },
    'the client certificate has expired',
    'renew the certificate; a token provider pins its certificate for life, so give the renewed one to a new provider',
  ],
  [
    'A5',
    'client-authentication',
    { problem: 'result-unsendable' },
    'the client authentication returned a request that cannot be sent',
    'check the client authentication strategy',
  ],
  [
    'A6',
    'client-authentication',
    { problem: 'signing-key-unusable' },
    'the client signing key could not be used',
    'check the private key and that it matches the algorithm',
  ],
  [
    'A7',
    'client-authentication',
    { problem: 'basic-client-id-colon' },
    "the client id contains ':', which raw Basic cannot carry",
    "use encoding: 'form' or clientSecretPost",
  ],
  [
    'A8',
    'interactive-login',
    { outcome: 'identity-provider-refused', oauthError: 'access_denied' },
    'the identity provider refused the login (access_denied)',
    'check the identity provider: the user, the client and the scopes it allows',
  ],
  [
    'K10',
    'interactive-login',
    { outcome: 'identity-provider-refused' },
    'the identity provider refused the login (an unregistered error code)',
    'check the identity provider: the user, the client and the scopes it allows',
  ],
  [
    'A10',
    'credential-refused',
    { credential: 'refresh-token' },
    'the refresh token was refused',
    'log in again',
  ],
  [
    'A14 status and code',
    'request-failed',
    {
      operation: 'token-request',
      grant: 'client_credentials',
      problem: 'refused',
      status: httpStatus(401),
      oauthError: 'invalid_client',
    },
    'client_credentials token request failed (HTTP 401, invalid_client)',
    undefined,
  ],
  [
    'A14 all facts',
    'request-failed',
    {
      operation: 'token-refresh',
      problem: 'refused',
      status: httpStatus(503),
      oauthError: 'temporarily_unavailable',
      code: 'ECONNRESET',
    },
    'the token refresh failed (HTTP 503, temporarily_unavailable, ECONNRESET)',
    undefined,
  ],
  [
    'A14 no reason',
    'request-failed',
    {
      operation: 'token-request',
      grant: 'client_credentials',
      problem: 'refused',
    },
    'client_credentials token request failed (the token endpoint gave no reason)',
    undefined,
  ],
  [
    'D2 code only',
    'request-failed',
    {
      operation: 'token-request',
      grant: 'password',
      problem: 'no-response',
      code: 'ECONNREFUSED',
    },
    'password token request failed (ECONNREFUSED)',
    undefined,
  ],
  [
    'A15 untrusted',
    'tls',
    { operation: 'code-exchange', code: 'SELF_SIGNED_CERT_IN_CHAIN' },
    "the code exchange failed: the server's certificate is not trusted (SELF_SIGNED_CERT_IN_CHAIN)",
    'if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS',
  ],
  [
    'A15 grant',
    'tls',
    { operation: 'token-request', grant: 'password', code: 'CERT_HAS_EXPIRED' },
    "password token request failed: the server's certificate has expired (CERT_HAS_EXPIRED)",
    "the server must renew its certificate; check also this machine's clock",
  ],
  [
    'A16 status',
    'unknown',
    { operation: 'refresh', status: httpStatus(500) },
    'the refresh failed (HTTP 500)',
    undefined,
  ],
  [
    'A16 all facts',
    'unknown',
    {
      operation: 'on-tokens-hook',
      status: httpStatus(400),
      oauthError: 'invalid_grant',
      code: 'EPROTO',
    },
    'onTokens failed (HTTP 400, invalid_grant, EPROTO)',
    undefined,
  ],
  [
    'A16 no status',
    'unknown',
    {
      operation: 'presenting-token',
      oauthError: 'invalid_grant',
      code: 'ECONNRESET',
    },
    'presenting the token failed (unknown error, invalid_grant, ECONNRESET)',
    undefined,
  ],
  [
    'A1',
    'unknown',
    { operation: 'loading-certificate' },
    'loading the certificate failed (unknown error)',
    undefined,
  ],
  [
    'A17',
    'token-binding',
    { problem: 'bound-to-unpinned' },
    'the token is bound to a client certificate this provider does not present',
    'give the provider a clientAuthentication that presents the certificate the token was issued for',
  ],
  [
    'A18',
    'token-binding',
    { problem: 'renewed-bound-elsewhere' },
    'the new token is bound to a client certificate this provider does not present',
    'the authorization server bound the new token to another certificate: check the certificate registered for this client',
  ],
  [
    'B1',
    'system-refused',
    { verdict: 'not-authorized', status: httpStatus(403), at: 'request' },
    'the credential was accepted, but the user is not authorized (403)',
    "check the user's authorizations in the system",
  ],
  [
    'B2',
    'system-refused',
    { verdict: 'redirected', status: httpStatus(302), at: 'logon' },
    'the system redirected instead of accepting the credential (302)',
    'the service may require another logon procedure (single sign-on, an identity provider)',
  ],
  [
    'B3',
    'system-refused',
    { verdict: 'system-failed', status: httpStatus(503), at: 'request' },
    'the system failed (503), not the credential',
    'try again later',
  ],
  [
    'B4',
    'system-refused',
    { verdict: 'other-status', status: httpStatus(404), at: 'request' },
    'the system answered 404, which is not a credential refusal',
    undefined,
  ],
  [
    'B5 call',
    'system-refused',
    {
      verdict: 'rfc-failure',
      rfcKey: 'RFC_COMMUNICATION_FAILURE',
      at: 'request',
    },
    'the RFC call failed (RFC_COMMUNICATION_FAILURE), not as a credential refusal',
    undefined,
  ],
  [
    'B5 logon',
    'system-refused',
    { verdict: 'rfc-failure', rfcKey: 'RFC_CLOSED', at: 'logon' },
    'the RFC logon failed (RFC_CLOSED), not as a credential refusal',
    undefined,
  ],
  [
    'B6 request',
    'system-refused',
    { verdict: 'unknown', at: 'request' },
    'the request was refused (unknown error)',
    undefined,
  ],
  [
    'B6 logon',
    'system-refused',
    { verdict: 'unknown', at: 'logon' },
    'the logon failed (unknown error)',
    undefined,
  ],
  [
    'B7',
    'credential-refused',
    { credential: 'user-password', at: 'logon' },
    'the user or password was refused',
    'check the user and password',
  ],
  [
    'B8',
    'not-prepared',
    { provider: 'certificate' },
    'the certificate is not loaded',
    'connect() prepares it first',
  ],
  [
    'B9',
    'credential-refused',
    { credential: 'client-certificate', at: 'logon' },
    'the client certificate was refused',
    'check that it is mapped to a user (CERTRULE / USREXTID)',
  ],
  [
    'B10',
    'credential-refused',
    { credential: 'saml-session', at: 'request' },
    'the SAML session was refused or has expired',
    'obtain a new SAML session',
  ],
  [
    'B11',
    'credential-refused',
    { credential: 'token', at: 'request' },
    'the token was refused',
    'obtain a new token',
  ],
  [
    'B12',
    'renewal-unchanged',
    { source: 'token-source' },
    'the renewal returned the credential that was refused',
    'the token source must issue a new token',
  ],
  [
    'B13',
    'renewal-unchanged',
    { source: 'token-provider' },
    'the renewal returned the credential that was refused',
    'the token source must issue a new token; log in again',
  ],
  [
    'B14',
    'client-certificate',
    { problem: 'incomplete' },
    'the client certificate is incomplete',
    'give a PFX, or a certificate together with its key',
  ],
  [
    'B15',
    'unknown',
    { operation: 'writing-session-cookies' },
    'writing the session cookies failed (unknown error)',
    undefined,
  ],
  [
    'K1',
    'interactive-login',
    { outcome: 'port-in-use', port: port(61001) },
    'Port 61001 is already in use. Please specify a different port or free the port.',
    undefined,
  ],
  [
    'K2',
    'interactive-login',
    { outcome: 'disposed', strategy: 'browser' },
    'BrowserCallbackStrategy has been disposed',
    undefined,
  ],
  [
    'K3',
    'interactive-login',
    { outcome: 'busy' },
    'BrowserCallbackStrategy is already authorizing; it holds a single port',
    undefined,
  ],
  [
    'K4',
    'interactive-login',
    { outcome: 'aborted' },
    'the authorization was aborted',
    undefined,
  ],
  [
    'K4 browser',
    'interactive-login',
    { outcome: 'aborted', strategy: 'browser' },
    'the browser login was aborted',
    undefined,
  ],
  [
    'K4 browser, ignored callbacks',
    'interactive-login',
    { outcome: 'aborted', strategy: 'browser', ignoredCallbacks: count(2) },
    'the browser login was aborted; 2 incomplete request(s) reached /callback and were ignored',
    undefined,
  ],
  [
    'K4 manual',
    'interactive-login',
    { outcome: 'aborted', strategy: 'manual' },
    'the manual login was aborted',
    undefined,
  ],
  [
    'K11',
    'interactive-login',
    { outcome: 'failed' },
    'the browser login failed (unknown error)',
    'complete the login, or abort it',
  ],
  [
    'K11 code',
    'interactive-login',
    { outcome: 'failed', code: 'ECONNRESET' },
    'the browser login failed (unknown error, ECONNRESET)',
    'complete the login, or abort it',
  ],
  [
    'K11 status',
    'interactive-login',
    { outcome: 'failed', status: httpStatus(502) },
    'the browser login failed (HTTP 502)',
    'complete the login, or abort it',
  ],
  [
    'K11 status and code',
    'interactive-login',
    { outcome: 'failed', status: httpStatus(502), code: 'EPROTO' },
    'the browser login failed (HTTP 502, EPROTO)',
    'complete the login, or abort it',
  ],
  [
    'K11 oauthError',
    'interactive-login',
    { outcome: 'failed', oauthError: 'access_denied' },
    'the browser login failed (unknown error, access_denied)',
    'complete the login, or abort it',
  ],
  [
    'K11 oauthError and code',
    'interactive-login',
    { outcome: 'failed', oauthError: 'access_denied', code: 'ECONNRESET' },
    'the browser login failed (unknown error, access_denied, ECONNRESET)',
    'complete the login, or abort it',
  ],
  [
    'K11 status and oauthError',
    'interactive-login',
    { outcome: 'failed', status: httpStatus(400), oauthError: 'invalid_grant' },
    'the browser login failed (HTTP 400, invalid_grant)',
    'complete the login, or abort it',
  ],
  [
    'K11 status, oauthError and code',
    'interactive-login',
    {
      outcome: 'failed',
      status: httpStatus(400),
      oauthError: 'invalid_grant',
      code: 'EPROTO',
    },
    'the browser login failed (HTTP 400, invalid_grant, EPROTO)',
    'complete the login, or abort it',
  ],
  [
    'K12',
    'interactive-login',
    { outcome: 'input-abandoned' },
    'the manual input was abandoned before it began',
    undefined,
  ],
  [
    'K13',
    'interactive-login',
    { outcome: 'no-terminal' },
    'Manual input needs an interactive terminal. Supply `read` to source the value elsewhere.',
    undefined,
  ],
  [
    'K15',
    'interactive-login',
    { outcome: 'disposed', strategy: 'manual' },
    'the manual strategy was disposed',
    undefined,
  ],
  [
    'K16',
    'interactive-login',
    { outcome: 'unreadable-input' },
    'Could not read an authorization code from that input',
    undefined,
  ],
  [
    'G1 Secure Login Client',
    'snc',
    { problem: 'no-credential', secureLoginClient: true },
    'the SNC library has no credential to present (A2200019)',
    'log on in the Secure Login Client, to the profile used for SAP applications',
  ],
  [
    'G1 other product',
    'snc',
    {
      problem: 'no-credential',
      secureLoginClient: false,
      libraryArchs: ['x64'],
    },
    'the SNC library has no credential to present (A2200019)',
    'make sure the SNC product behind the SNC library is logged on',
  ],
  [
    'G3',
    'snc',
    { problem: 'logon-refused', rfcKey: 'RFC_LOGON_FAILURE' },
    'SNC logon refused (RFC_LOGON_FAILURE)',
    undefined,
  ],
  [
    'G3 no key',
    'snc',
    { problem: 'logon-refused' },
    'SNC logon refused',
    undefined,
  ],
  [
    'G4',
    'snc',
    { problem: 'library-not-found' },
    'no usable SNC library was found',
    'set sncLib to the SNC (GSS) library of your SNC product',
  ],
  [
    'G6',
    'snc',
    { problem: 'library-not-found', searched: true, candidates: [] },
    'no usable SNC library was found: no candidate (SNC_LIB_64 and SNC_LIB are unset and no Secure Login Client installation was found)',
    'set sncLib to the SNC (GSS) library of your SNC product',
  ],
  [
    'G8',
    'snc',
    { problem: 'locator-returned-no-path' },
    'no usable SNC library was found: the locator returned no path',
    'set sncLib to the SNC (GSS) library of your SNC product',
  ],
  [
    'G9',
    'not-prepared',
    { provider: 'snc' },
    'the SNC provider is not prepared',
    'connect() prepares it first',
  ],
  [
    'G10 resolving',
    'unknown',
    { operation: 'resolving-snc-library' },
    'the SNC provider failed while resolving the SNC library (unknown error)',
    undefined,
  ],
  [
    'G10 handing over',
    'unknown',
    { operation: 'handing-over-snc-parameters' },
    'the SNC provider failed while handing over the SNC logon parameters (unknown error)',
    undefined,
  ],
  [
    'G10 authorizing',
    'unknown',
    { operation: 'authorizing-snc-request' },
    'the SNC provider failed while authorizing a request (unknown error)',
    undefined,
  ],
  [
    'G10 explaining',
    'unknown',
    { operation: 'explaining-snc-refusal' },
    'the SNC provider failed while explaining the SNC refusal (unknown error)',
    undefined,
  ],
  [
    'I1',
    'logon-target',
    { wire: 'rfc', refused: 'tls-material' },
    'this wire carries no TLS material (RFC)',
    undefined,
  ],
  [
    'I2',
    'logon-target',
    { wire: 'http', refused: 'logon-parameters' },
    'this wire takes no logon parameters (HTTP)',
    undefined,
  ],
  [
    'I3',
    'connection',
    { problem: 'provider-threw', at: 'logon' },
    'the credential provider failed',
    undefined,
  ],
  [
    'I4',
    'connection',
    { problem: 'refused-after-renewal', at: 'request' },
    'the credential was refused again after the provider renewed it',
    undefined,
  ],
  [
    'I5',
    'connection',
    { problem: 'no-credential' },
    'this connection has no credential to renew',
    undefined,
  ],
];

describe('verbatim rows of Appendix A', () => {
  it.each(VERBATIM)('%s', (_row, kind, facts, reason, hint) => {
    const error = build(kind, facts);
    expect(error.reason).toBe(reason);
    expect(error.hint).toBe(hint);
    if (hint === undefined) expect(Object.keys(error)).not.toContain('hint');
  });
});

/** Today's TLS words (auth-providers 5.4.2, `knownCodes.ts` `TLS_CODES`). */
const UNTRUSTED = [
  "the server's certificate is not trusted",
  'if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS',
] as const;
const REFUSED_CLIENT = [
  'the server refused the client certificate',
  "check that the server trusts the certificate's issuer and that the certificate is valid and not revoked",
] as const;
const TLS_WORDS: Record<string, readonly [string, string]> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: UNTRUSTED,
  SELF_SIGNED_CERT_IN_CHAIN: UNTRUSTED,
  DEPTH_ZERO_SELF_SIGNED_CERT: UNTRUSTED,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: UNTRUSTED,
  CERT_HAS_EXPIRED: [
    "the server's certificate has expired",
    "the server must renew its certificate; check also this machine's clock",
  ],
  ERR_TLS_CERT_ALTNAME_INVALID: [
    "the host name is not in the server's certificate",
    "use the host name the server's certificate is issued for",
  ],
  ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED: REFUSED_CLIENT,
  ERR_SSL_TLSV1_ALERT_UNKNOWN_CA: REFUSED_CLIENT,
  ...Object.fromEntries(
    [
      'BAD_CERTIFICATE',
      'CERTIFICATE_UNKNOWN',
      'CERTIFICATE_EXPIRED',
      'CERTIFICATE_REVOKED',
      'UNSUPPORTED_CERTIFICATE',
    ].flatMap((alert) => [
      [`ERR_SSL_SSL/TLS_ALERT_${alert}`, REFUSED_CLIENT],
      [`ERR_SSL_SSLV3_ALERT_${alert}`, REFUSED_CLIENT],
    ]),
  ),
};

describe('A15: every TLS code has today’s words', () => {
  it('covers every code of TLS_FAILURE_CODES', () => {
    expect(Object.keys(TLS_WORDS).sort()).toEqual(
      [...TLS_FAILURE_CODES].sort(),
    );
  });

  it.each(TLS_FAILURE_CODES)('%s', (code) => {
    const expected = TLS_WORDS[code];
    if (expected === undefined) throw new Error(`no words for ${code}`);
    const error = build('tls', { operation: 'refresh', code });
    expect(error.reason).toBe(`the refresh failed: ${expected[0]} (${code})`);
    expect(error.hint).toBe(expected[1]);
  });
});

/** The configuration words ("Words for review", plan). */
const CONFIGURATION: readonly (readonly [
  string,
  readonly string[],
  string,
  string,
])[] = [
  [
    'required-fields-missing',
    ['uaaUrl', 'clientId'],
    'required configuration is missing: uaaUrl, clientId',
    'check the provider configuration',
  ],
  [
    'client-secret-beside-client-authentication',
    ['clientSecret'],
    'clientSecret cannot be given beside clientAuthentication',
    'give the secret to the clientAuthentication strategy, or drop the strategy',
  ],
  [
    'saml-acs-required-with-authorization-url',
    ['acsUrl'],
    'acsUrl is required when authorizationUrl is set: the ACS inside a pre-built SAML request cannot be read, so it must be declared',
    'check the provider configuration',
  ],
  [
    'saml-idp-initiated-with-request-id',
    ['idpInitiated', 'authnRequestId'],
    'SAML idpInitiated is true, but a request ID was also configured or minted: an IdP-initiated login sends no request',
    'remove one of them',
  ],
  [
    'saml-shipped-validator-without-issuer',
    ['idpEntityId'],
    'the supplied assertionValidator is a shipped one, which refuses every assertion without an expected issuer: idpEntityId is missing',
    'check the provider configuration',
  ],
  [
    'saml-token-endpoint-missing',
    ['tokenUrl', 'uaaUrl'],
    'the SAML bearer exchange needs tokenUrl or uaaUrl',
    'check the provider configuration',
  ],
  [
    'saml-idp-initiated-without-authorization-url',
    ['idpInitiated', 'authorizationUrl'],
    'SAML idpInitiated is true and no authorizationUrl is configured, but the authorization strategy asked for an authorization URL',
    'configure the IdP-initiated SSO URL as authorizationUrl, or use a strategy that does not call buildAuthorizationUrl',
  ],
  [
    'saml-acs-mismatch',
    ['acsUrl'],
    'SAML acsUrl and the address the authorization strategy used do not match',
    'they must match',
  ],
  [
    'saml-in-response-to-undeclared',
    ['authnRequestId', 'idpInitiated'],
    'cannot validate InResponseTo: this login did not build its own AuthnRequest',
    'configure authnRequestId, or idpInitiated: true if the identity provider starts this login itself',
  ],
  [
    'client-id-required-with-client-authentication',
    ['clientId'],
    'clientId is required with a client authentication',
    'check the provider configuration',
  ],
  [
    'redirect-mismatch',
    ['authorizationUrl'],
    'the pre-built authorizationUrl declares a redirect_uri the authorization strategy did not use',
    'an ephemeral port cannot be used with a pre-built URL',
  ],
  [
    'oidc-discovery-needs-issuer',
    ['issuerUrl'],
    'OIDC issuerUrl is required when discovery is used',
    'check the provider configuration',
  ],
  [
    'oidc-endpoint-missing',
    ['tokenEndpoint'],
    'OIDC tokenEndpoint is required (configure it, or use discovery)',
    'check the provider configuration',
  ],
  [
    'certificate-pem-and-pfx',
    ['certPath', 'certPfxPath'],
    'certificate auth: provide either PEM (certPath + certKeyPath) or certPfxPath, not both',
    'check the provider configuration',
  ],
  [
    'certificate-files-missing',
    ['certPfxPath', 'certPath', 'certKeyPath'],
    'certificate auth requires certPfxPath, or certPath and certKeyPath',
    'check the provider configuration',
  ],
  [
    'basic-encoding-missing',
    ['encoding'],
    "clientSecretBasic needs encoding: 'raw' or 'form'",
    'check the provider configuration',
  ],
  [
    'snc-partner-name-missing',
    ['partnerName'],
    "SncLogonProvider needs partnerName — the system's SNC name",
    'check the provider configuration',
  ],
  [
    'snc-qop-invalid',
    ['qop'],
    'SncLogonProvider: qop must be one of 1, 2, 3, 8, 9',
    'check the provider configuration',
  ],
  [
    'unsupported-sso-flow',
    [],
    'unsupported SSO provider config: no provider for this protocol and flow',
    'check the provider configuration',
  ],
  [
    'validator-clock-skew-invalid',
    ['clockSkewMs'],
    'clockSkewMs must be a finite non-negative integer',
    'check the provider configuration',
  ],
  [
    'validator-no-certificates',
    ['idpCertificates'],
    'idpCertificates must not be empty: nothing could be verified',
    'check the provider configuration',
  ],
  [
    'idp-certificate-invalid',
    ['idpCertificates'],
    'a configured IdP certificate is not a valid X.509 certificate in PEM or base64 DER',
    'check the provider configuration',
  ],
  [
    'static-code-without-payload',
    ['payload'],
    'staticCodeStrategy requires a payload',
    'check the provider configuration',
  ],
  [
    'callback-port-invalid',
    ['port'],
    'invalid callback server port: it must be an integer in 0..65535',
    'check the provider configuration',
  ],
];

describe('configuration words', () => {
  it('covers every case', () => {
    expect(CONFIGURATION.map(([c]) => c).sort()).toEqual(
      [...CONFIG_CASES].sort(),
    );
  });

  it.each(CONFIGURATION)('%s', (configCase, fields, reason, hint) => {
    const error = build('configuration', { case: configCase, fields });
    expect(error.reason).toBe(reason);
    expect(error.hint).toBe(hint);
  });

  it('the allowed set renders the same words given or not', () => {
    expect(
      build('configuration', {
        case: 'snc-qop-invalid',
        fields: ['qop'],
        allowed: 'snc-qop',
      }).reason,
    ).toBe('SncLogonProvider: qop must be one of 1, 2, 3, 8, 9');
    expect(
      build('configuration', {
        case: 'basic-encoding-missing',
        fields: ['encoding'],
        allowed: 'basic-encoding',
      }).reason,
    ).toBe("clientSecretBasic needs encoding: 'raw' or 'form'");
  });

  it('names several missing OIDC endpoints', () => {
    expect(
      build('configuration', {
        case: 'oidc-endpoint-missing',
        fields: ['authorizationEndpoint', 'tokenEndpoint'],
      }).reason,
    ).toBe(
      'OIDC authorizationEndpoint, tokenEndpoint are required (configure them, or use discovery)',
    );
  });
});

describe('interactive-login words', () => {
  it('aborted, no strategy: the neutral sentence, and the tally with ignoredCallbacks', () => {
    expect(build('interactive-login', { outcome: 'aborted' }).reason).toBe(
      'the authorization was aborted',
    );
    expect(
      build('interactive-login', {
        outcome: 'aborted',
        ignoredCallbacks: count(3),
      }).reason,
    ).toBe(
      'the authorization was aborted; 3 incomplete request(s) reached /callback and were ignored',
    );
    expect(
      build('interactive-login', {
        outcome: 'aborted',
        ignoredCallbacks: count(0),
      }).reason,
    ).toBe('the authorization was aborted');
  });

  it('aborted, browser: the browser sentence, and the tally with ignoredCallbacks', () => {
    expect(
      build('interactive-login', { outcome: 'aborted', strategy: 'browser' })
        .reason,
    ).toBe('the browser login was aborted');
    expect(
      build('interactive-login', {
        outcome: 'aborted',
        strategy: 'browser',
        ignoredCallbacks: count(3),
      }).reason,
    ).toBe(
      'the browser login was aborted; 3 incomplete request(s) reached /callback and were ignored',
    );
    expect(
      build('interactive-login', {
        outcome: 'aborted',
        strategy: 'browser',
        ignoredCallbacks: count(0),
      }).reason,
    ).toBe('the browser login was aborted');
  });

  it('aborted, manual: its own sentence, never the callback tally', () => {
    expect(
      build('interactive-login', {
        outcome: 'aborted',
        strategy: 'manual',
        ignoredCallbacks: count(3),
      }).reason,
    ).toBe('the manual login was aborted');
  });

  it('aborted: a strategy out of its set is dropped, the words are those without it', () => {
    for (const strategy of ['device', 'Manual', 7, null]) {
      const error = build('interactive-login', {
        outcome: 'aborted',
        strategy,
        ignoredCallbacks: count(3),
      });
      expect(error.facts).toStrictEqual({
        outcome: 'aborted',
        ignoredCallbacks: 3,
      });
      expect(error.reason).toBe(
        'the authorization was aborted; 3 incomplete request(s) reached /callback and were ignored',
      );
    }
  });

  it('failed: an unregistered oauthError is dropped, the words are those without it', () => {
    for (const oauthError of ['sk-made-up', 'ACCESS_DENIED', 401, null]) {
      const error = build('interactive-login', {
        outcome: 'failed',
        status: httpStatus(400),
        oauthError,
      });
      expect(error.facts).toStrictEqual({ outcome: 'failed', status: 400 });
      expect(error.reason).toBe('the browser login failed (HTTP 400)');
    }
  });

  it('browser-launch-failed, with and without a code', () => {
    const plain = build('interactive-login', {
      outcome: 'browser-launch-failed',
    });
    expect(words(plain)).toStrictEqual({
      reason: 'the browser could not be opened',
      hint: 'open the authorization URL from the log by hand',
    });
    expect(
      build('interactive-login', {
        outcome: 'browser-launch-failed',
        code: 'ENOENT',
      }).reason,
    ).toBe('the browser could not be opened (ENOENT)');
  });

  it('callback-closed and no-input', () => {
    expect(
      build('interactive-login', { outcome: 'callback-closed' }).reason,
    ).toBe('the callback server closed before a result arrived');
    expect(build('interactive-login', { outcome: 'no-input' }).reason).toBe(
      'no input was received',
    );
  });

  it('no word mentions a timeout or a number of seconds', () => {
    const rendered: string[] = [];
    for (const outcome of INTERACTIVE_OUTCOMES) {
      const variants: Record<string, unknown>[] = [interactiveFacts(outcome)];
      if (outcome === 'disposed') {
        variants.push({ outcome, strategy: 'manual' });
      }
      if (outcome === 'aborted') {
        variants.push({ outcome, ignoredCallbacks: count(4) });
        variants.push({ outcome, strategy: 'manual' });
      }
      if (outcome === 'failed') {
        variants.push({ outcome, status: httpStatus(504), code: 'EPROTO' });
        variants.push({ outcome, oauthError: 'access_denied' });
      }
      for (const facts of variants) {
        const error = build('interactive-login', facts);
        rendered.push(error.reason, error.hint ?? '');
      }
    }
    expect(rendered.length).toBeGreaterThan(INTERACTIVE_OUTCOMES.length);
    for (const text of rendered) {
      expect(text).not.toMatch(/time|second|\bin time\b|\d+\s*s\b/i);
    }
  });
});

describe('snc words', () => {
  it('library-init-failed: the architectures, never the path', () => {
    expect(
      build('snc', {
        problem: 'library-init-failed',
        libraryArchs: ['x64', 'arm64'],
      }).reason,
    ).toBe(
      'the RFC SDK could not initialise the SNC library (x64/arm64) as its SNC library (SNCERR_INIT)',
    );
    expect(build('snc', { problem: 'library-init-failed' }).reason).toBe(
      'the RFC SDK could not initialise the SNC library as its SNC library (SNCERR_INIT)',
    );
  });

  it('library-not-found: each candidate’s source and reason, no path', () => {
    const error = build(
      'snc',
      {
        problem: 'library-not-found',
        searched: true,
        candidates: [
          { source: 'SNC_LIB_64', reason: 'missing' },
          { source: 'registry', reason: 'wrong architecture', archs: ['ia32'] },
        ],
        processArch: 'x64',
      },
      { candidatePaths: ['/opt/a.so', 'C:\\SLC\\sapcrypto.dll'] },
    );
    expect(error.reason).toBe(
      'no usable SNC library was found: SNC_LIB_64 (missing); registry (wrong architecture)',
    );
    expect(error.hint).toBe(
      'set sncLib to the SNC (GSS) library of your SNC product',
    );
  });
});

describe('saml-assertion words', () => {
  it('names the check, then the rule', () => {
    expect(
      build('saml-assertion', { rule: 'expired', check: 'notOnOrAfter' })
        .reason,
    ).toBe(
      'the SAML assertion was refused (notOnOrAfter): the assertion has expired',
    );
  });

  it('a counted rule names the count', () => {
    expect(
      build('saml-assertion', {
        rule: 'several-references',
        check: 'signature',
        count: count(3),
      }).reason,
    ).toBe(
      'the SAML assertion was refused (signature): the signature carries 3 ds:Reference; exactly one is allowed',
    );
  });

  it('no-bearer-qualifies lists each candidate, and how many more', () => {
    expect(
      build('saml-assertion', {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: [
          { reason: 'method-not-bearer' },
          { reason: 'several-confirmation-data', count: count(2) },
          { reason: 'not-before-not-arrived' },
        ],
        moreCandidates: count(4),
      }).reason,
    ).toBe(
      'the SAML assertion was refused (bearerConfirmation): no bearer confirmation qualifies: #1 Method is not bearer | #2 carries 2 SubjectConfirmationData; exactly one is allowed | #3 NotBefore has not arrived | and 4 more',
    );
  });

  it('declined names a registered status code', () => {
    expect(
      build('saml-assertion', {
        rule: 'declined',
        check: 'status',
        statusCode: 'urn:oasis:names:tc:SAML:2.0:status:Responder',
      }).reason,
    ).toBe(
      'the SAML assertion was refused (status): the identity provider declined the login (urn:oasis:names:tc:SAML:2.0:status:Responder)',
    );
  });
});

describe('no rendered word contains a diagnostic value', () => {
  const MARKER = 'MARKER7f3a';
  const CASES: readonly (readonly [string, string, unknown, unknown])[] = [
    [
      'snc no-credential',
      'snc',
      { problem: 'no-credential', libraryArchs: ['x64'] },
      { library: `/opt/${MARKER}/libsapcrypto.so` },
    ],
    [
      'snc library-init-failed',
      'snc',
      { problem: 'library-init-failed', libraryArchs: ['x64'] },
      { library: `/opt/${MARKER}.so` },
    ],
    [
      'snc library-not-found',
      'snc',
      {
        problem: 'library-not-found',
        searched: true,
        candidates: [{ source: 'sncLib', reason: 'not a library' }],
      },
      { candidatePaths: [`/opt/${MARKER}.so`] },
    ],
    [
      'configuration saml-acs-mismatch',
      'configuration',
      { case: 'saml-acs-mismatch', fields: ['acsUrl'] },
      {
        configuredUri: `https://${MARKER}.example/acs`,
        strategyUri: `http://localhost:61001/${MARKER}`,
      },
    ],
    [
      'configuration redirect-mismatch',
      'configuration',
      { case: 'redirect-mismatch', fields: ['authorizationUrl'] },
      {
        configuredUri: `https://${MARKER}.example/cb`,
        strategyUri: `http://localhost:0/${MARKER}`,
      },
    ],
    [
      'saml root-not-response-or-assertion',
      'saml-assertion',
      samlFacts('root-not-response-or-assertion'),
      { rootElement: MARKER },
    ],
    [
      'saml root-not-response',
      'saml-assertion',
      samlFacts('root-not-response'),
      { rootElement: MARKER },
    ],
    [
      'saml duplicate-id',
      'saml-assertion',
      samlFacts('duplicate-id'),
      { id: `_${MARKER}` },
    ],
    [
      'saml reference-not-same-document',
      'saml-assertion',
      samlFacts('reference-not-same-document'),
      { referenceUri: `http://${MARKER}` },
    ],
    [
      'saml reference-not-found',
      'saml-assertion',
      samlFacts('reference-not-found'),
      { referenceUri: `#${MARKER}` },
    ],
    [
      'saml declined',
      'saml-assertion',
      samlFacts('declined'),
      { statusCode: `urn:${MARKER}` },
    ],
    [
      'saml untrusted-issuer',
      'saml-assertion',
      samlFacts('untrusted-issuer'),
      { issuer: `https://${MARKER}/` },
    ],
    [
      'saml not-before-invalid',
      'saml-assertion',
      samlFacts('not-before-invalid'),
      { notBefore: `2026-${MARKER}` },
    ],
    [
      'saml not-on-or-after-invalid',
      'saml-assertion',
      samlFacts('not-on-or-after-invalid'),
      { notOnOrAfter: `2026-${MARKER}` },
    ],
    [
      'saml destination-not-us',
      'saml-assertion',
      samlFacts('destination-not-us'),
      { destination: `https://${MARKER}/acs` },
    ],
  ];

  it.each(CASES)('%s', (_label, kind, facts, diagnostics) => {
    const error = build(kind, facts, diagnostics);
    expect(error.diagnostics).toBeDefined();
    expect(JSON.stringify(error.diagnostics)).toContain(MARKER);
    expect(error.reason).not.toContain(MARKER);
    expect(error.hint ?? '').not.toContain(MARKER);
  });
});

const UNFAMILIAR = {
  reason: 'an authentication error of a kind this version does not know',
};

describe('anything this build does not know renders the unfamiliar words whole', () => {
  const CASES: readonly (readonly [string, string, unknown])[] = [
    ['operation constructor', 'unknown', { operation: 'constructor' }],
    ['operation toString', 'unknown', { operation: 'toString' }],
    ['operation hasOwnProperty', 'unknown', { operation: 'hasOwnProperty' }],
    ['operation __proto__', 'unknown', { operation: '__proto__' }],
    ['an unknown operation', 'unknown', { operation: 'future-operation' }],
    [
      'an unknown operation, returned',
      'request-failed',
      { operation: 'future-operation', problem: 'no-access-token' },
    ],
    [
      'an unknown operation, failed',
      'request-failed',
      { operation: 'toString', problem: 'refused' },
    ],
    [
      'tls code constructor',
      'tls',
      { operation: 'refresh', code: 'constructor' },
    ],
    ['tls code __proto__', 'tls', { operation: 'refresh', code: '__proto__' }],
    [
      'an unknown rule',
      'saml-assertion',
      { rule: 'future-rule', check: 'document' },
    ],
    [
      'a rule with another check',
      'saml-assertion',
      { rule: 'expired', check: 'issuer' },
    ],
    [
      'a rule named constructor',
      'saml-assertion',
      { rule: 'constructor', check: 'document' },
    ],
    [
      'an unknown bearer candidate reason',
      'saml-assertion',
      {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: [
          { reason: 'method-not-bearer' },
          { reason: 'future-reason' },
        ],
      },
    ],
    [
      'an unknown SNC candidate reason',
      'snc',
      {
        problem: 'library-not-found',
        candidates: [{ source: 'SNC_LIB', reason: 'constructor' }],
      },
    ],
    [
      'an unknown logon-target refusal',
      'logon-target',
      { wire: 'unknown', refused: 'future-thing' },
    ],
    [
      'an unknown logon-target refusal on rfc',
      'logon-target',
      { wire: 'rfc', refused: 'toString' },
    ],
    [
      'an unknown disposed strategy',
      'interactive-login',
      { outcome: 'disposed', strategy: 'future' },
    ],
    [
      'port-in-use without a port',
      'interactive-login',
      { outcome: 'port-in-use' },
    ],
    [
      'a status verdict without a status',
      'system-refused',
      { verdict: 'system-failed', at: 'request' },
    ],
    [
      'an rfc verdict without a key',
      'system-refused',
      { verdict: 'rfc-failure', at: 'logon' },
    ],
    [
      'a verdict at an unknown moment',
      'system-refused',
      { verdict: 'unknown', at: 'future' },
    ],
    ...[
      'configuration',
      'client-certificate',
      'client-authentication',
      'request-failed',
      'tls',
      'interactive-login',
      'saml-assertion',
      'snc',
      'credential-refused',
      'system-refused',
      'renewal-unchanged',
      'token-binding',
      'not-prepared',
      'logon-target',
      'connection',
      'unknown',
    ].map((kind) => [`${kind} with empty facts`, kind, {}] as const),
  ];

  it.each(CASES)('%s, through render', (_label, kind, facts) => {
    expect(render(kind, facts)).toStrictEqual(UNFAMILIAR);
  });

  it.each(CASES)('%s, through the builder', (_label, kind, facts) => {
    expect(words(build(kind, facts))).toStrictEqual(UNFAMILIAR);
  });
});

describe('F2: unfamiliar-error as an operation', () => {
  it.each([
    [
      'request-failed',
      {
        operation: 'unfamiliar-error',
        problem: 'refused',
        status: httpStatus(500),
      },
    ],
    [
      'request-failed',
      { operation: 'unfamiliar-error', problem: 'no-access-token' },
    ],
    [
      'request-failed',
      { operation: 'unfamiliar-error', problem: 'incomplete-response' },
    ],
    ['tls', { operation: 'unfamiliar-error', code: 'CERT_HAS_EXPIRED' }],
    ['unknown', { operation: 'unfamiliar-error', status: httpStatus(500) }],
  ])('%s renders the unfamiliar sentence alone', (kind, facts) => {
    expect(words(build(kind, facts))).toStrictEqual(UNFAMILIAR);
  });
});

describe('F4: counts', () => {
  it('a counted rule with a count below two uses the generic wording', () => {
    expect(
      build('saml-assertion', {
        rule: 'several-issuers',
        check: 'issuer',
        count: count(1),
      }).reason,
    ).toBe(
      'the SAML assertion was refused (issuer): the assertion carries more than one saml:Issuer; exactly one is allowed',
    );
  });

  it('one candidate not shown is singular', () => {
    expect(
      build('saml-assertion', {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        moreCandidates: count(1),
      }).reason,
    ).toBe(
      'the SAML assertion was refused (bearerConfirmation): no bearer confirmation qualifies (1 candidate not shown)',
    );
  });
});

describe('no-bearer-qualifies with no candidate listed', () => {
  it('says how many were not shown, with no dangling "and"', () => {
    expect(
      build('saml-assertion', {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        moreCandidates: count(4),
      }).reason,
    ).toBe(
      'the SAML assertion was refused (bearerConfirmation): no bearer confirmation qualifies (4 candidates not shown)',
    );
  });
});

describe('render', () => {
  it('answers the words a builder stores', () => {
    const error = build('request-failed', {
      operation: 'device-poll',
      problem: 'no-access-token',
    });
    expect(render('request-failed', error.facts)).toStrictEqual(words(error));
    expect(error.reason).toBe('the device poll returned no access_token');
  });

  it('answers the unfamiliar words for a kind this build does not know', () => {
    expect(render('future-kind', {})).toStrictEqual({
      reason: 'an authentication error of a kind this version does not know',
    });
    expect(render('constructor', {})).toStrictEqual({
      reason: 'an authentication error of a kind this version does not know',
    });
  });

  it('answers the unfamiliar words for a discriminant this build does not know', () => {
    expect(render('snc', { problem: 'future-problem' })).toStrictEqual({
      reason: 'an authentication error of a kind this version does not know',
    });
  });
});

describe('blamesCredential (spec §3.1)', () => {
  const ROWS: readonly (readonly [string, string, unknown, boolean])[] = [
    [
      'configuration',
      'configuration',
      { case: 'required-fields-missing', fields: ['clientId'] },
      false,
    ],
    ['client-certificate', 'client-certificate', { problem: 'expired' }, false],
    [
      'client-authentication',
      'client-authentication',
      { problem: 'result-unsendable' },
      false,
    ],
    [
      'request-failed',
      'request-failed',
      { operation: 'refresh', problem: 'refused', status: httpStatus(401) },
      false,
    ],
    ['tls', 'tls', { operation: 'refresh', code: 'CERT_HAS_EXPIRED' }, false],
    [
      'interactive-login',
      'interactive-login',
      { outcome: 'identity-provider-refused' },
      false,
    ],
    ['saml-assertion', 'saml-assertion', samlFacts('expired'), false],
    ['snc no-credential', 'snc', { problem: 'no-credential' }, true],
    [
      'snc logon-refused RFC_LOGON_FAILURE',
      'snc',
      { problem: 'logon-refused', rfcKey: 'RFC_LOGON_FAILURE' },
      true,
    ],
    [
      'snc logon-refused other key',
      'snc',
      { problem: 'logon-refused', rfcKey: 'RFC_COMMUNICATION_FAILURE' },
      false,
    ],
    ['snc logon-refused no key', 'snc', { problem: 'logon-refused' }, false],
    [
      'snc library-init-failed',
      'snc',
      { problem: 'library-init-failed' },
      false,
    ],
    ['snc library-not-found', 'snc', { problem: 'library-not-found' }, false],
    [
      'snc locator-returned-no-path',
      'snc',
      { problem: 'locator-returned-no-path' },
      false,
    ],
    ...CREDENTIAL_KINDS.map(
      (credential) =>
        [
          `credential-refused ${credential}`,
          'credential-refused',
          { credential },
          true,
        ] as const,
    ),
    [
      'system-refused',
      'system-refused',
      { verdict: 'not-authorized', status: httpStatus(403), at: 'request' },
      false,
    ],
    ...RENEWAL_UNCHANGED_SOURCES.map(
      (source) =>
        [
          `renewal-unchanged ${source}`,
          'renewal-unchanged',
          { source },
          true,
        ] as const,
    ),
    ['token-binding', 'token-binding', { problem: 'bound-to-unpinned' }, false],
    ['not-prepared', 'not-prepared', { provider: 'snc' }, false],
    [
      'logon-target',
      'logon-target',
      { wire: 'rfc', refused: 'tls-material' },
      false,
    ],
    [
      'connection refused-after-renewal',
      'connection',
      { problem: 'refused-after-renewal', at: 'request' },
      true,
    ],
    [
      'connection provider-threw',
      'connection',
      { problem: 'provider-threw' },
      false,
    ],
    [
      'connection no-credential',
      'connection',
      { problem: 'no-credential' },
      false,
    ],
    [
      'unknown',
      'unknown',
      { operation: 'refresh', status: httpStatus(401) },
      false,
    ],
  ];

  it.each(ROWS)('%s', (_label, kind, facts, blames) => {
    expect(blamesCredential(build(kind, facts))).toBe(blames);
  });

  it.each([null, undefined, 'credential-refused', {}, { kind: 'future-kind' }])(
    'is false for %p',
    (value) => {
      expect(blamesCredential(value)).toBe(false);
    },
  );

  it('reads own, once, through the facts check: no getter is invoked', () => {
    const calls: string[] = [];
    const facts = {
      get credential() {
        calls.push('credential');
        return 'token';
      },
    };
    const error = {
      get kind() {
        calls.push('kind');
        return 'credential-refused';
      },
      facts,
    };
    expect(blamesCredential(error)).toBe(false);
    expect(blamesCredential({ kind: 'credential-refused', facts })).toBe(false);
    expect(
      blamesCredential({
        kind: 'snc',
        facts: {
          problem: 'logon-refused',
          get rfcKey() {
            calls.push('rfcKey');
            return 'RFC_LOGON_FAILURE';
          },
        },
      }),
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it.each([
    ['facts null', { kind: 'credential-refused', facts: null }],
    [
      'a bad credential',
      { kind: 'credential-refused', facts: { credential: 'MARKER' } },
    ],
    [
      'a bad rfcKey',
      { kind: 'snc', facts: { problem: 'logon-refused', rfcKey: 'MARKER' } },
    ],
    [
      'a bad connection problem',
      { kind: 'connection', facts: { problem: 'MARKER' } },
    ],
  ])('is false for %s', (_label, value) => {
    expect(blamesCredential(value)).toBe(false);
  });

  it('answers as for a minted error, given the same facts as a plain object', () => {
    expect(
      blamesCredential({
        kind: 'credential-refused',
        facts: { credential: 'token' },
      }),
    ).toBe(true);
    expect(
      blamesCredential({
        kind: 'snc',
        facts: { problem: 'logon-refused', rfcKey: 'RFC_LOGON_FAILURE' },
      }),
    ).toBe(true);
  });

  it('is false, and does not throw, for a value whose reads throw', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('secret');
        },
        getOwnPropertyDescriptor() {
          throw new Error('secret');
        },
      },
    );
    expect(blamesCredential(hostile)).toBe(false);
  });
});
