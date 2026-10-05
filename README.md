# @mcp-abap-adt/auth-errors
[![Stand With Ukraine](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/badges/StandWithUkraine.svg)](https://stand-with-ukraine.pp.ua)

The runtime half of the `@mcp-abap-adt` authentication error contract.

`@mcp-abap-adt/interfaces-auth` (6.0.0 and later) declares the types and holds
no logic. This package holds the code: every producer — the providers of
`@mcp-abap-adt/auth-providers`, the logon targets of `@mcp-abap-adt/connection`,
the broker — obtains its errors here, and every reader classifies what it
caught here.

No error built here carries a secret or foreign text: `classify` and the
builders never read a thrown value's `message`, `cause`, `stack`, `name`,
body or string form. `isAuthProviderFailure` reads an own data `name` and an
own data `error` of the value, and nothing else.

- [Install](#install)
- [What an error is](#what-an-error-is)
- [The sixteen kinds](#the-sixteen-kinds) and [their words](#the-words)
- [Building an error](#building-an-error)
- [Diagnostics and their admission](#diagnostics-and-their-admission)
- [Catching: `classify` and `readFailure`, never `instanceof`](#catching-classify-and-readfailure-never-instanceof)
- [Exhaustiveness: two patterns](#exhaustiveness-two-patterns)
- [Producing: `guard`, `relayOutcome`, `AuthProviderBase`](#producing-guard-relayoutcome-authproviderbase)
- [Shared attempts: `sharedAttempt` and `createParties`](#shared-attempts-sharedattempt-and-createparties)
- [Allowlist guards and branded integers](#allowlist-guards-and-branded-integers)
- [The brand and its limit](#the-brand-and-its-limit)
- [The shape check](#the-shape-check)
- [Exported types](#exported-types)
- [Versioning](#versioning)

## Install

```bash
npm install @mcp-abap-adt/auth-errors
```

It depends on `@mcp-abap-adt/interfaces-auth` `^6.0.0` and nothing else.
Node.js 22, 24 or 26.

The package's `exports` map exposes three paths by name: the entry
(`@mcp-abap-adt/auth-errors`), `@mcp-abap-adt/auth-errors/package.json` and
`@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs`. A deep path such as
`@mcp-abap-adt/auth-errors/dist/allowlists` fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`: the internal modules are not an API.

## What an error is

Every failure of authentication is an `IAuthProviderError`, a frozen object:

| Property | What it is |
|---|---|
| `kind` | one of sixteen, from the closed list `AUTH_PROVIDER_ERROR_KINDS` |
| `variant` | for `saml-assertion`, `snc` and `configuration` only: the rule, problem or case — the same value as in `facts`, lifted so that `e.kind === 'snc' && e.variant === 'library-not-found'` narrows the whole object, `diagnostics` included |
| `facts` | what happened, drawn only from allowlists (the `as const` arrays of interfaces-auth) and branded integer ranges — nothing free-form |
| `reason`, `hint?` | the default words, rendered from `kind` and `facts` at minting — never from a diagnostic, never from anything a thrown value said |
| `diagnostics?` | for the three variant kinds only, and only the fields that variant permits, each admitted on its own (see [below](#diagnostics-and-their-admission)) |

An error is also the refusal: `AuthOutcome` is `{ ok: true }` or
`{ ok: false, refusal: IAuthProviderError }`. What a token provider throws is
an `AuthProviderFailure`, an `Error` holding one error.

The type carries a brand no code can write, so an error can only be
**minted** — and this package is the only place that mints one.

## The sixteen kinds

Each kind's facts, as `interfaces-auth` declares them (`?` optional; every
other fact key is `?: never`, so the fact types are closed):

| Kind | Facts |
|---|---|
| `configuration` | `case` (`CONFIG_CASES`), `fields` (`CONFIG_FIELDS`, at most 8, deduplicated), `allowed?` (`ALLOWED_VALUE_SETS`, for `snc-qop-invalid` and `basic-encoding-missing`) |
| `client-certificate` | `problem`: `incomplete`, `unusable`, `expired` |
| `client-authentication` | `problem`: `signing-key-unusable`, `result-unsendable`, `basic-client-id-colon` |
| `request-failed` | `operation` (`OPERATIONS`), `grant?` (an `OAuth2GrantType`), `problem` (`REQUEST_PROBLEMS`), `status?` (`HttpStatus`), `oauthError?` (`OAUTH_ERROR_CODES`), `code?` (`SYSTEM_CODES`) |
| `tls` | `operation`, `grant?`, `code` (`TLS_FAILURE_CODES`) |
| `interactive-login` | `outcome` (`INTERACTIVE_OUTCOMES`), and by outcome: `port-in-use` `port` (`Port`); `aborted` `strategy?` (`browser` / `manual`), `ignoredCallbacks?` (`Count`); `disposed` `strategy`; `identity-provider-refused` `oauthError?`; `browser-launch-failed` `code?`; `failed` `status?`, `oauthError?`, `code?` |
| `saml-assertion` | `rule` (`ASSERTION_RULES`, 56), `check` (the rule's `AssertionCheck`), and by rule: a "several …" rule `count?` (at least 2); `declined` `statusCode?` (`SAML_STATUS_CODES`); `no-bearer-qualifies` `candidates?` (each a `BEARER_CANDIDATE_REASONS` reason, with `count?` — at least 2 — only for `several-confirmation-data`; at most 5), `moreCandidates?` |
| `snc` | `problem` (`SNC_PROBLEMS`), and by problem: `no-credential` `secureLoginClient?`, `libraryArchs?`; `library-init-failed` `libraryArchs?`; `logon-refused` `rfcKey?` (`RFC_KEYS`); `library-not-found` `searched?`, `candidates?` (`source`, `reason`, `archs?`; at most 8), `processArch?` |
| `credential-refused` | `credential` (`CREDENTIAL_KINDS`), `at?` (`logon` / `request`) |
| `system-refused` | `verdict` (`SYSTEM_REFUSED_VERDICTS`), `at`; a status verdict `status`; `rfc-failure` `rfcKey` |
| `renewal-unchanged` | `source`: `token-source`, `token-provider` |
| `token-binding` | `problem`: `bound-to-unpinned`, `renewed-bound-elsewhere` |
| `not-prepared` | `provider`: `certificate`, `snc` |
| `logon-target` | `wire` (`http`, `rfc`, `unknown`), `refused` (`tls-material`, `logon-parameters`) |
| `connection` | `problem` (`CONNECTION_PROBLEMS`), `at?` (`prepare`, `logon`, `request`) |
| `unknown` | `operation`, `grant?`, `status?`, `oauthError?`, `code?` |

`blamesCredential(error)` answers whether an error blames the credential
(the reason to renew it): `credential-refused`, `renewal-unchanged`, `snc`
`no-credential`, `snc` `logon-refused` with `RFC_LOGON_FAILURE`, and
`connection` `refused-after-renewal`. Total.

### The words

`render(kind, facts)` answers the default `{ reason, hint? }` a builder
stores, from `kind` and `facts` only, so a consumer can produce the same words
— or render its own from the same facts. A kind, discriminant, operation or
code this build does not know, or a required fact that is missing, renders as
a whole the words of the `unknown` row with operation `unfamiliar-error`
below — never a sentence with a piece of them spliced in. No word mentions a
login timeout: there is none built in.

The table is generated from the built package's builders by
`scripts/generate-kinds-table.mjs` (`npm run docs:kinds`), and a test fails
when it differs from what the builders render. Each row gives the facts the
builder was given (as the error holds them) and the words it rendered.

<!-- BEGIN GENERATED: kinds table (npm run docs:kinds) — do not edit by hand -->

#### `configuration`

| facts | reason | hint |
|---|---|---|
| `{"case":"required-fields-missing","fields":["clientId"]}` | `required configuration is missing: clientId` | `check the provider configuration` |
| `{"case":"client-secret-beside-client-authentication","fields":[]}` | `clientSecret cannot be given beside clientAuthentication` | `give the secret to the clientAuthentication strategy, or drop the strategy` |
| `{"case":"saml-acs-required-with-authorization-url","fields":[]}` | `acsUrl is required when authorizationUrl is set: the ACS inside a pre-built SAML request cannot be read, so it must be declared` | `check the provider configuration` |
| `{"case":"saml-idp-initiated-with-request-id","fields":[]}` | `SAML idpInitiated is true, but a request ID was also configured or minted: an IdP-initiated login sends no request` | `remove one of them` |
| `{"case":"saml-shipped-validator-without-issuer","fields":[]}` | `the supplied assertionValidator is a shipped one, which refuses every assertion without an expected issuer: idpEntityId is missing` | `check the provider configuration` |
| `{"case":"saml-token-endpoint-missing","fields":[]}` | `the SAML bearer exchange needs tokenUrl or uaaUrl` | `check the provider configuration` |
| `{"case":"saml-idp-initiated-without-authorization-url","fields":[]}` | `SAML idpInitiated is true and no authorizationUrl is configured, but the authorization strategy asked for an authorization URL` | `configure the IdP-initiated SSO URL as authorizationUrl, or use a strategy that does not call buildAuthorizationUrl` |
| `{"case":"saml-acs-mismatch","fields":[]}` | `SAML acsUrl and the address the authorization strategy used do not match` | `they must match` |
| `{"case":"saml-in-response-to-undeclared","fields":[]}` | `cannot validate InResponseTo: this login did not build its own AuthnRequest` | `configure authnRequestId, or idpInitiated: true if the identity provider starts this login itself` |
| `{"case":"client-id-required-with-client-authentication","fields":[]}` | `clientId is required with a client authentication` | `check the provider configuration` |
| `{"case":"redirect-mismatch","fields":[]}` | `the pre-built authorizationUrl declares a redirect_uri the authorization strategy did not use` | `an ephemeral port cannot be used with a pre-built URL` |
| `{"case":"oidc-discovery-needs-issuer","fields":[]}` | `OIDC issuerUrl is required when discovery is used` | `check the provider configuration` |
| `{"case":"oidc-endpoint-missing","fields":[]}` | `OIDC endpoint is required (configure it, or use discovery)` | `check the provider configuration` |
| `{"case":"certificate-pem-and-pfx","fields":[]}` | `certificate auth: provide either PEM (certPath + certKeyPath) or certPfxPath, not both` | `check the provider configuration` |
| `{"case":"certificate-files-missing","fields":[]}` | `certificate auth requires certPfxPath, or certPath and certKeyPath` | `check the provider configuration` |
| `{"case":"basic-encoding-missing","fields":[]}` | `clientSecretBasic needs encoding: 'raw' or 'form'` | `check the provider configuration` |
| `{"case":"snc-partner-name-missing","fields":[]}` | `SncLogonProvider needs partnerName — the system's SNC name` | `check the provider configuration` |
| `{"case":"snc-qop-invalid","fields":[]}` | `SncLogonProvider: qop must be one of 1, 2, 3, 8, 9` | `check the provider configuration` |
| `{"case":"unsupported-sso-flow","fields":[]}` | `unsupported SSO provider config: no provider for this protocol and flow` | `check the provider configuration` |
| `{"case":"validator-clock-skew-invalid","fields":[]}` | `clockSkewMs must be a finite non-negative integer` | `check the provider configuration` |
| `{"case":"validator-no-certificates","fields":[]}` | `idpCertificates must not be empty: nothing could be verified` | `check the provider configuration` |
| `{"case":"idp-certificate-invalid","fields":[]}` | `a configured IdP certificate is not a valid X.509 certificate in PEM or base64 DER` | `check the provider configuration` |
| `{"case":"static-code-without-payload","fields":[]}` | `staticCodeStrategy requires a payload` | `check the provider configuration` |
| `{"case":"callback-port-invalid","fields":[]}` | `invalid callback server port: it must be an integer in 0..65535` | `check the provider configuration` |
| `{"case":"required-fields-missing","fields":["clientId","clientSecret","uaaUrl"]}` | `required configuration is missing: clientId, clientSecret, uaaUrl` | `check the provider configuration` |

#### `client-certificate`

| facts | reason | hint |
|---|---|---|
| `{"problem":"incomplete"}` | `the client certificate is incomplete` | `give a PFX, or a certificate together with its key` |
| `{"problem":"unusable"}` | `the client certificate could not be used` | `check the certificate, the key and the passphrase, and that a PFX uses current encryption (not legacy RC2)` |
| `{"problem":"expired"}` | `the client certificate has expired` | `renew the certificate; a token provider pins its certificate for life, so give the renewed one to a new provider` |

#### `client-authentication`

| facts | reason | hint |
|---|---|---|
| `{"problem":"signing-key-unusable"}` | `the client signing key could not be used` | `check the private key and that it matches the algorithm` |
| `{"problem":"result-unsendable"}` | `the client authentication returned a request that cannot be sent` | `check the client authentication strategy` |
| `{"problem":"basic-client-id-colon"}` | `the client id contains ':', which raw Basic cannot carry` | `use encoding: 'form' or clientSecretPost` |

#### `request-failed`

| facts | reason | hint |
|---|---|---|
| `{"operation":"token-refresh","problem":"refused"}` | `the token refresh failed (the token endpoint gave no reason)` | — |
| `{"operation":"token-refresh","problem":"no-response"}` | `the token refresh failed (the token endpoint gave no reason)` | — |
| `{"operation":"token-refresh","problem":"no-access-token"}` | `the token refresh returned no access_token` | — |
| `{"operation":"token-refresh","problem":"incomplete-response"}` | `the token refresh returned an incomplete response` | — |
| `{"operation":"token-request","grant":"client_credentials","problem":"refused","status":401,"oauthError":"invalid_client"}` | `client_credentials token request failed (HTTP 401, invalid_client)` | — |
| `{"operation":"oidc-discovery","problem":"no-response","code":"ECONNREFUSED"}` | `OIDC discovery failed (ECONNREFUSED)` | — |

#### `tls`

| facts | reason | hint |
|---|---|---|
| `{"operation":"oidc-discovery","code":"UNABLE_TO_VERIFY_LEAF_SIGNATURE"}` | `OIDC discovery failed: the server's certificate is not trusted (UNABLE_TO_VERIFY_LEAF_SIGNATURE)` | `if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS` |
| `{"operation":"oidc-discovery","code":"SELF_SIGNED_CERT_IN_CHAIN"}` | `OIDC discovery failed: the server's certificate is not trusted (SELF_SIGNED_CERT_IN_CHAIN)` | `if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS` |
| `{"operation":"oidc-discovery","code":"DEPTH_ZERO_SELF_SIGNED_CERT"}` | `OIDC discovery failed: the server's certificate is not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)` | `if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS` |
| `{"operation":"oidc-discovery","code":"UNABLE_TO_GET_ISSUER_CERT_LOCALLY"}` | `OIDC discovery failed: the server's certificate is not trusted (UNABLE_TO_GET_ISSUER_CERT_LOCALLY)` | `if the server uses a private CA, name its certificate in NODE_EXTRA_CA_CERTS` |
| `{"operation":"oidc-discovery","code":"CERT_HAS_EXPIRED"}` | `OIDC discovery failed: the server's certificate has expired (CERT_HAS_EXPIRED)` | `the server must renew its certificate; check also this machine's clock` |
| `{"operation":"oidc-discovery","code":"ERR_TLS_CERT_ALTNAME_INVALID"}` | `OIDC discovery failed: the host name is not in the server's certificate (ERR_TLS_CERT_ALTNAME_INVALID)` | `use the host name the server's certificate is issued for` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_TLSV1_ALERT_UNKNOWN_CA"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_TLSV1_ALERT_UNKNOWN_CA)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSL/TLS_ALERT_BAD_CERTIFICATE"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSL/TLS_ALERT_BAD_CERTIFICATE)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_UNKNOWN)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_EXPIRED"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_EXPIRED)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSLV3_ALERT_CERTIFICATE_EXPIRED)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_REVOKED"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSL/TLS_ALERT_CERTIFICATE_REVOKED)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSLV3_ALERT_CERTIFICATE_REVOKED)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSL/TLS_ALERT_UNSUPPORTED_CERTIFICATE"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSL/TLS_ALERT_UNSUPPORTED_CERTIFICATE)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"oidc-discovery","code":"ERR_SSL_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE"}` | `OIDC discovery failed: the server refused the client certificate (ERR_SSL_SSLV3_ALERT_UNSUPPORTED_CERTIFICATE)` | `check that the server trusts the certificate's issuer and that the certificate is valid and not revoked` |
| `{"operation":"token-request","grant":"client_credentials","code":"CERT_HAS_EXPIRED"}` | `client_credentials token request failed: the server's certificate has expired (CERT_HAS_EXPIRED)` | `the server must renew its certificate; check also this machine's clock` |

#### `interactive-login`

| facts | reason | hint |
|---|---|---|
| `{"outcome":"port-in-use","port":61001}` | `Port 61001 is already in use. Please specify a different port or free the port.` | — |
| `{"outcome":"aborted"}` | `the authorization was aborted` | — |
| `{"outcome":"disposed","strategy":"browser"}` | `BrowserCallbackStrategy has been disposed` | — |
| `{"outcome":"busy"}` | `BrowserCallbackStrategy is already authorizing; it holds a single port` | — |
| `{"outcome":"browser-launch-failed"}` | `the browser could not be opened` | `open the authorization URL from the log by hand` |
| `{"outcome":"callback-closed"}` | `the callback server closed before a result arrived` | — |
| `{"outcome":"identity-provider-refused"}` | `the identity provider refused the login (an unregistered error code)` | `check the identity provider: the user, the client and the scopes it allows` |
| `{"outcome":"input-abandoned"}` | `the manual input was abandoned before it began` | — |
| `{"outcome":"no-input"}` | `no input was received` | — |
| `{"outcome":"unreadable-input"}` | `Could not read an authorization code from that input` | — |
| `{"outcome":"no-terminal"}` | `` Manual input needs an interactive terminal. Supply `read` to source the value elsewhere. `` | — |
| `{"outcome":"device-code-not-shown"}` | `showing the device code failed` | — |
| `{"outcome":"failed"}` | `the browser login failed (unknown error)` | `complete the login, or abort it` |
| `{"outcome":"aborted","strategy":"browser","ignoredCallbacks":2}` | `the browser login was aborted; 2 incomplete request(s) reached /callback and were ignored` | — |
| `{"outcome":"aborted","strategy":"manual"}` | `the manual login was aborted` | — |
| `{"outcome":"disposed","strategy":"manual"}` | `the manual strategy was disposed` | — |
| `{"outcome":"identity-provider-refused","oauthError":"access_denied"}` | `the identity provider refused the login (access_denied)` | `check the identity provider: the user, the client and the scopes it allows` |
| `{"outcome":"browser-launch-failed","code":"ENOENT"}` | `the browser could not be opened (ENOENT)` | `open the authorization URL from the log by hand` |
| `{"outcome":"failed","status":400,"oauthError":"invalid_grant"}` | `the browser login failed (HTTP 400, invalid_grant)` | `complete the login, or abort it` |

#### `saml-assertion`

| facts | reason | hint |
|---|---|---|
| `{"rule":"doctype","check":"document"}` | `the SAML assertion was refused (document): the SAMLResponse carries a DOCTYPE declaration, which is never accepted` | — |
| `{"rule":"not-xml","check":"document"}` | `the SAML assertion was refused (document): the SAMLResponse did not parse as XML` | — |
| `{"rule":"root-not-response-or-assertion","check":"document"}` | `the SAML assertion was refused (document): expected a samlp:Response or a saml:Assertion` | — |
| `{"rule":"root-not-response","check":"document"}` | `the SAML assertion was refused (document): expected the document element to be a samlp:Response` | — |
| `{"rule":"duplicate-id","check":"duplicateId"}` | `the SAML assertion was refused (duplicateId): the document uses an ID more than once, so which element is signed is ambiguous` | — |
| `{"rule":"no-signature","check":"signature"}` | `the SAML assertion was refused (signature): the document carries no signature` | — |
| `{"rule":"signature-malformed","check":"signature"}` | `the SAML assertion was refused (signature): the signature element is malformed` | — |
| `{"rule":"signature-not-verified","check":"signature"}` | `the SAML assertion was refused (signature): the signature does not verify against any configured certificate` | — |
| `{"rule":"no-reference","check":"signature"}` | `the SAML assertion was refused (signature): the signature carries no ds:Reference` | — |
| `{"rule":"several-references","check":"signature"}` | `the SAML assertion was refused (signature): the signature carries more than one ds:Reference; exactly one is allowed` | — |
| `{"rule":"reference-not-same-document","check":"signature"}` | `the SAML assertion was refused (signature): the signature reference is not a same-document URI` | — |
| `{"rule":"reference-not-found","check":"signature"}` | `the SAML assertion was refused (signature): the signature references an element that is not in the document` | — |
| `{"rule":"signature-not-enveloped","check":"signature"}` | `the SAML assertion was refused (signature): the signature is not inside the element it references, so it does not envelope it` | — |
| `{"rule":"no-direct-assertion","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the response carries no direct-child saml:Assertion` | — |
| `{"rule":"several-direct-assertions","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the response carries more than one direct-child saml:Assertion; exactly one is allowed` | — |
| `{"rule":"response-not-signed","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the signature does not cover the samlp:Response this validator requires` | — |
| `{"rule":"assertion-not-signed","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the signature does not cover the saml:Assertion this validator requires` | — |
| `{"rule":"assertion-outside-signed","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the document carries an Assertion or EncryptedAssertion, SAML 2.0 or 1.x, outside the one the signature covers` | — |
| `{"rule":"assertion-inside-signature","check":"signedNode"}` | `the SAML assertion was refused (signedNode): the document carries an Assertion or EncryptedAssertion inside a ds:Signature, which is never accepted` | — |
| `{"rule":"no-status","check":"status"}` | `the SAML assertion was refused (status): the response carries no samlp:Status` | — |
| `{"rule":"several-status","check":"status"}` | `the SAML assertion was refused (status): the response carries more than one samlp:Status; exactly one is allowed` | — |
| `{"rule":"no-status-code","check":"status"}` | `the SAML assertion was refused (status): the samlp:Status carries no samlp:StatusCode` | — |
| `{"rule":"several-status-codes","check":"status"}` | `the SAML assertion was refused (status): the samlp:Status carries more than one samlp:StatusCode; exactly one is allowed` | — |
| `{"rule":"status-code-no-value","check":"status"}` | `the SAML assertion was refused (status): the samlp:StatusCode carries no Value` | — |
| `{"rule":"declined","check":"status"}` | `the SAML assertion was refused (status): the identity provider declined the login` | — |
| `{"rule":"no-assertion-id","check":"assertionId"}` | `the SAML assertion was refused (assertionId): the assertion carries no ID` | — |
| `{"rule":"no-issuer","check":"issuer"}` | `the SAML assertion was refused (issuer): the assertion carries no saml:Issuer` | — |
| `{"rule":"several-issuers","check":"issuer"}` | `the SAML assertion was refused (issuer): the assertion carries more than one saml:Issuer; exactly one is allowed` | — |
| `{"rule":"empty-issuer","check":"issuer"}` | `the SAML assertion was refused (issuer): the assertion's saml:Issuer is empty` | — |
| `{"rule":"no-expected-issuer","check":"issuer"}` | `the SAML assertion was refused (issuer): no expectedIssuer was configured, so the assertion issuer cannot be trusted` | — |
| `{"rule":"untrusted-issuer","check":"issuer"}` | `the SAML assertion was refused (issuer): the assertion was not issued by the trusted issuer` | — |
| `{"rule":"several-response-issuers","check":"issuer"}` | `the SAML assertion was refused (issuer): the response must carry at most one saml:Issuer` | — |
| `{"rule":"issuers-differ","check":"issuer"}` | `the SAML assertion was refused (issuer): the response and the assertion name different issuers` | — |
| `{"rule":"no-conditions","check":"conditions"}` | `the SAML assertion was refused (conditions): the assertion carries no saml:Conditions` | — |
| `{"rule":"several-conditions","check":"conditions"}` | `the SAML assertion was refused (conditions): the assertion carries more than one saml:Conditions; exactly one is allowed` | — |
| `{"rule":"not-before-invalid","check":"notBefore"}` | `the SAML assertion was refused (notBefore): Conditions NotBefore is not a valid xsd:dateTime` | — |
| `{"rule":"not-yet-valid","check":"notBefore"}` | `the SAML assertion was refused (notBefore): the assertion is not valid yet` | — |
| `{"rule":"no-not-on-or-after","check":"notOnOrAfter"}` | `the SAML assertion was refused (notOnOrAfter): Conditions carries no NotOnOrAfter, so the assertion states no lifetime` | — |
| `{"rule":"not-on-or-after-invalid","check":"notOnOrAfter"}` | `the SAML assertion was refused (notOnOrAfter): Conditions NotOnOrAfter is not a valid xsd:dateTime` | — |
| `{"rule":"expired","check":"notOnOrAfter"}` | `the SAML assertion was refused (notOnOrAfter): the assertion has expired` | — |
| `{"rule":"no-audience-restriction","check":"audience"}` | `the SAML assertion was refused (audience): the assertion restricts no audience` | — |
| `{"rule":"audience-restriction-empty","check":"audience"}` | `the SAML assertion was refused (audience): an AudienceRestriction names no audience` | — |
| `{"rule":"audience-not-us","check":"audience"}` | `the SAML assertion was refused (audience): an AudienceRestriction on this assertion does not name us` | — |
| `{"rule":"no-subject","check":"bearerConfirmation"}` | `the SAML assertion was refused (bearerConfirmation): the assertion carries no saml:Subject` | — |
| `{"rule":"several-subjects","check":"bearerConfirmation"}` | `the SAML assertion was refused (bearerConfirmation): the assertion carries more than one saml:Subject; exactly one is allowed` | — |
| `{"rule":"no-subject-confirmation","check":"bearerConfirmation"}` | `the SAML assertion was refused (bearerConfirmation): the saml:Subject holds no SubjectConfirmation` | — |
| `{"rule":"no-bearer-qualifies","check":"bearerConfirmation"}` | `the SAML assertion was refused (bearerConfirmation): no bearer confirmation qualifies` | — |
| `{"rule":"no-destination","check":"destination"}` | `the SAML assertion was refused (destination): the response carries no Destination` | — |
| `{"rule":"destination-not-us","check":"destination"}` | `the SAML assertion was refused (destination): the response is not addressed to us` | — |
| `{"rule":"replayed","check":"replay"}` | `the SAML assertion was refused (replay): this assertion has been presented before` | — |
| `{"rule":"payload-not-base64-xml","check":"document"}` | `the SAML assertion was refused (document): SAML bearer payload is not base64-encoded XML` | — |
| `{"rule":"payload-not-well-formed","check":"document"}` | `the SAML assertion was refused (document): SAML bearer payload is not well-formed XML` | — |
| `{"rule":"payload-not-saml","check":"document"}` | `the SAML assertion was refused (document): SAML bearer payload is neither a SAML Response nor an Assertion` | — |
| `{"rule":"only-encrypted-assertion","check":"document"}` | `the SAML assertion was refused (document): SAML Response carries only an EncryptedAssertion; encrypted Assertions are not supported` | — |
| `{"rule":"no-assertion","check":"document"}` | `the SAML assertion was refused (document): SAML Response carries no Assertion` | — |
| `{"rule":"several-assertions","check":"document"}` | `the SAML assertion was refused (document): SAML Response carries more than one Assertion; a bearer grant takes one` | — |
| `{"rule":"several-assertions","check":"document","count":3}` | `the SAML assertion was refused (document): SAML Response carries 3 Assertions; a bearer grant takes one` | — |
| `{"rule":"declined","check":"status","statusCode":"urn:oasis:names:tc:SAML:2.0:status:Requester"}` | `the SAML assertion was refused (status): the identity provider declined the login (urn:oasis:names:tc:SAML:2.0:status:Requester)` | — |
| `{"rule":"no-bearer-qualifies","check":"bearerConfirmation","candidates":[{"reason":"recipient-not-acs"},{"reason":"several-confirmation-data","count":2}]}` | `the SAML assertion was refused (bearerConfirmation): no bearer confirmation qualifies: #1 Recipient is not the ACS \| #2 carries 2 SubjectConfirmationData; exactly one is allowed` | — |

#### `snc`

| facts | reason | hint |
|---|---|---|
| `{"problem":"no-credential"}` | `the SNC library has no credential to present (A2200019)` | `make sure the SNC product behind the SNC library is logged on` |
| `{"problem":"library-init-failed"}` | `the RFC SDK could not initialise the SNC library as its SNC library (SNCERR_INIT)` | — |
| `{"problem":"logon-refused"}` | `SNC logon refused` | — |
| `{"problem":"library-not-found"}` | `no usable SNC library was found` | `set sncLib to the SNC (GSS) library of your SNC product` |
| `{"problem":"locator-returned-no-path"}` | `no usable SNC library was found: the locator returned no path` | `set sncLib to the SNC (GSS) library of your SNC product` |
| `{"problem":"no-credential","secureLoginClient":true,"libraryArchs":["x64"]}` | `the SNC library has no credential to present (A2200019)` | `log on in the Secure Login Client, to the profile used for SAP applications` |
| `{"problem":"logon-refused","rfcKey":"RFC_LOGON_FAILURE"}` | `SNC logon refused (RFC_LOGON_FAILURE)` | — |
| `{"problem":"library-not-found","searched":true,"candidates":[{"source":"SNC_LIB_64","reason":"missing"},{"source":"sncLib","reason":"wrong architecture","archs":["arm64"]}],"processArch":"x64"}` | `no usable SNC library was found: SNC_LIB_64 (missing); sncLib (wrong architecture)` | `set sncLib to the SNC (GSS) library of your SNC product` |

#### `credential-refused`

| facts | reason | hint |
|---|---|---|
| `{"credential":"user-password"}` | `the user or password was refused` | `check the user and password` |
| `{"credential":"client-certificate"}` | `the client certificate was refused` | `check that it is mapped to a user (CERTRULE / USREXTID)` |
| `{"credential":"saml-session"}` | `the SAML session was refused or has expired` | `obtain a new SAML session` |
| `{"credential":"token"}` | `the token was refused` | `obtain a new token` |
| `{"credential":"refresh-token"}` | `the refresh token was refused` | `log in again` |
| `{"credential":"user-password","at":"logon"}` | `the user or password was refused` | `check the user and password` |

#### `system-refused`

| facts | reason | hint |
|---|---|---|
| `{"verdict":"not-authorized","status":403,"at":"request"}` | `the credential was accepted, but the user is not authorized (403)` | `check the user's authorizations in the system` |
| `{"verdict":"redirected","status":302,"at":"request"}` | `the system redirected instead of accepting the credential (302)` | `the service may require another logon procedure (single sign-on, an identity provider)` |
| `{"verdict":"system-failed","status":503,"at":"request"}` | `the system failed (503), not the credential` | `try again later` |
| `{"verdict":"other-status","status":418,"at":"request"}` | `the system answered 418, which is not a credential refusal` | — |
| `{"verdict":"rfc-failure","rfcKey":"RFC_COMMUNICATION_FAILURE","at":"logon"}` | `the RFC logon failed (RFC_COMMUNICATION_FAILURE), not as a credential refusal` | — |
| `{"verdict":"unknown","at":"request"}` | `the request was refused (unknown error)` | — |
| `{"verdict":"unknown","at":"logon"}` | `the logon failed (unknown error)` | — |

#### `renewal-unchanged`

| facts | reason | hint |
|---|---|---|
| `{"source":"token-source"}` | `the renewal returned the credential that was refused` | `the token source must issue a new token` |
| `{"source":"token-provider"}` | `the renewal returned the credential that was refused` | `the token source must issue a new token; log in again` |

#### `token-binding`

| facts | reason | hint |
|---|---|---|
| `{"problem":"bound-to-unpinned"}` | `the token is bound to a client certificate this provider does not present` | `give the provider a clientAuthentication that presents the certificate the token was issued for` |
| `{"problem":"renewed-bound-elsewhere"}` | `the new token is bound to a client certificate this provider does not present` | `the authorization server bound the new token to another certificate: check the certificate registered for this client` |

#### `not-prepared`

| facts | reason | hint |
|---|---|---|
| `{"provider":"certificate"}` | `the certificate is not loaded` | `connect() prepares it first` |
| `{"provider":"snc"}` | `the SNC provider is not prepared` | `connect() prepares it first` |

#### `logon-target`

| facts | reason | hint |
|---|---|---|
| `{"wire":"http","refused":"tls-material"}` | `the logon target did not take the TLS material (HTTP)` | — |
| `{"wire":"http","refused":"logon-parameters"}` | `this wire takes no logon parameters (HTTP)` | — |
| `{"wire":"rfc","refused":"tls-material"}` | `this wire carries no TLS material (RFC)` | — |
| `{"wire":"rfc","refused":"logon-parameters"}` | `the logon target did not take the logon parameters (RFC)` | — |
| `{"wire":"unknown","refused":"tls-material"}` | `the logon target did not take the TLS material` | — |
| `{"wire":"unknown","refused":"logon-parameters"}` | `the logon target did not take the logon parameters` | — |

#### `connection`

| facts | reason | hint |
|---|---|---|
| `{"problem":"provider-threw"}` | `the credential provider failed` | — |
| `{"problem":"refused-after-renewal"}` | `the credential was refused again after the provider renewed it` | — |
| `{"problem":"no-credential"}` | `this connection has no credential to renew` | — |
| `{"problem":"provider-threw","at":"logon"}` | `the credential provider failed` | — |

#### `unknown`

| facts | reason | hint |
|---|---|---|
| `{"operation":"token-request"}` | `the token request failed (unknown error)` | — |
| `{"operation":"refresh"}` | `the refresh failed (unknown error)` | — |
| `{"operation":"on-tokens-hook"}` | `onTokens failed (unknown error)` | — |
| `{"operation":"presenting-token"}` | `presenting the token failed (unknown error)` | — |
| `{"operation":"presenting-certificate"}` | `presenting the certificate failed (unknown error)` | — |
| `{"operation":"loading-certificate"}` | `loading the certificate failed (unknown error)` | — |
| `{"operation":"writing-authorization-header"}` | `writing the Authorization header failed (unknown error)` | — |
| `{"operation":"offering-logon-parameters"}` | `offering the logon parameters failed (unknown error)` | — |
| `{"operation":"writing-session-cookies"}` | `writing the session cookies failed (unknown error)` | — |
| `{"operation":"reading-rejection"}` | `reading the rejection failed (unknown error)` | — |
| `{"operation":"token-source"}` | `the token source failed (unknown error)` | — |
| `{"operation":"resolving-snc-library"}` | `the SNC provider failed while resolving the SNC library (unknown error)` | — |
| `{"operation":"handing-over-snc-parameters"}` | `the SNC provider failed while handing over the SNC logon parameters (unknown error)` | — |
| `{"operation":"authorizing-snc-request"}` | `the SNC provider failed while authorizing a request (unknown error)` | — |
| `{"operation":"explaining-snc-refusal"}` | `the SNC provider failed while explaining the SNC refusal (unknown error)` | — |
| `{"operation":"probing-snc-product"}` | `the probe failed (unknown error)` | — |
| `{"operation":"presenting-device-code"}` | `the presenter failed (unknown error)` | — |
| `{"operation":"saml-token-exchange"}` | `the SAML token exchange failed (unknown error)` | — |
| `{"operation":"saml-token-refresh"}` | `the SAML token refresh failed (unknown error)` | — |
| `{"operation":"browser-login"}` | `the browser login failed (unknown error)` | — |
| `{"operation":"opening-browser"}` | `opening the browser failed (unknown error)` | — |
| `{"operation":"passcode-exchange"}` | `the passcode exchange failed (unknown error)` | — |
| `{"operation":"device-authorization"}` | `the OIDC device authorization failed (unknown error)` | — |
| `{"operation":"password-grant"}` | `the OIDC password grant failed (unknown error)` | — |
| `{"operation":"client-credentials"}` | `the client credentials request failed (unknown error)` | — |
| `{"operation":"token-refresh"}` | `the token refresh failed (unknown error)` | — |
| `{"operation":"oidc-discovery"}` | `OIDC discovery failed (unknown error)` | — |
| `{"operation":"code-exchange"}` | `the code exchange failed (unknown error)` | — |
| `{"operation":"device-poll"}` | `the device poll failed (unknown error)` | — |
| `{"operation":"oidc-token-request"}` | `the OIDC token request failed (unknown error)` | — |
| `{"operation":"validating-assertion"}` | `validating the SAML assertion failed (unknown error)` | — |
| `{"operation":"client-authentication-strategy"}` | `the clientAuthentication strategy failed (unknown error)` | — |
| `{"operation":"unfamiliar-error"}` | `an authentication error of a kind this version does not know` | — |
| `{"operation":"preparing"}` | `preparing failed (unknown error)` | — |
| `{"operation":"establishing"}` | `establishing the logon failed (unknown error)` | — |
| `{"operation":"authorizing"}` | `authorizing the request failed (unknown error)` | — |
| `{"operation":"token-request","grant":"password","status":500}` | `password token request failed (HTTP 500)` | — |
| `{"operation":"refresh","code":"ECONNRESET"}` | `the refresh failed (unknown error, ECONNRESET)` | — |

<!-- END GENERATED: kinds table -->

## Building an error

`authError` holds one builder per kind — the only way to obtain an error:

```ts
import { authError, httpStatus } from '@mcp-abap-adt/auth-errors';

const expired = authError['client-certificate']({ problem: 'expired' });

const status = httpStatus(response.status); // HttpStatus | undefined
const refused = authError['request-failed']({
  operation: 'token-request',
  grant: 'client_credentials',
  problem: 'refused',
  ...(status === undefined ? {} : { status }),
});
```

A builder never throws. It reads every fact as an own data property (no
getter or conversion is invoked), checks it against its allowlist guard or
integer maker, omits absent facts, copies every array, deduplicates and caps
`fields` at 8, caps `candidates` (5 for `saml-assertion`, counting the rest in
`moreCandidates`; 8 for `snc`), renders the words and mints the error frozen
deeply. An invalid optional fact is dropped; an invalid required one makes the
call answer `unknown` with operation `unfamiliar-error`.

The builders of `saml-assertion`, `snc` and `configuration` are generic over
the variant, inferred from the facts literal (a discriminant typed as the
whole union does not compile), take the diagnostics that variant permits, and
answer that variant's error type. Every other builder takes facts only.

`isMinted(value)` is the public provenance guard: true only for an error this
copy of the package minted (a module-private `WeakSet`). A structural copy —
a spread, a JSON round-trip, another copy's error — is not one.

## Diagnostics and their admission

Three kinds may carry diagnostics: values read from a document or a machine
that help a person find the fault, kept apart from the words so a logger can
drop them.

| Kind | Variant | Permitted fields |
|---|---|---|
| `saml-assertion` | the rule | at most one field, per `SAML_RULE_DIAGNOSTIC`: `rootElement`, `id`, `referenceUri`, `statusCode`, `issuer`, `notBefore`, `notOnOrAfter` or `destination` |
| `snc` | the problem | `no-credential`, `library-init-failed`: `library`; `library-not-found`: `candidatePaths` (aligned with `facts.candidates`); others none |
| `configuration` | the case | `saml-acs-mismatch`, `redirect-mismatch`: `configuredUri`, `strategyUri`; others none |

Each field is admitted on its own; a refused value is dropped and the error is
still minted:

| Check | Admitted |
|---|---|
| `LocalPath` (`library`, each of `candidatePaths`) | a string of 1–1 024 code points with no control (C0, DEL, C1), U+2028/U+2029, format character (bidi controls, zero-width characters, the tag block, …), lone surrogate, private-use character, noncharacter, variation selector, U+034F or Hangul filler — refused by Unicode category; never truncated, longer is dropped |
| `DocumentValue` (`issuer`, `destination`, …) | a non-empty string with none of those characters, cut to 64 code points with `…` appended; `referenceUri` and `statusCode` also refuse anything outside U+0021–U+007E |
| `XmlName` (`rootElement`) | `^[A-Za-z_][A-Za-z0-9._-]{0,63}$` |
| `XmlId` (`id`) | `^[A-Za-z_][A-Za-z0-9._-]*$`, then cut as a `DocumentValue` |
| `DocumentTime` (`notBefore`, `notOnOrAfter`) | `^[0-9A-Za-z:.+-]{1,40}$` |
| `ConfigUri` (`configuredUri`, `strategyUri`) | parses as a URL, `http:` or `https:`, no user name or password; kept as origin + path only (no query, no fragment), at most 512 characters |

A refused character is refused, not escaped: a value that is kept is safe to
print as it is.

Diagnostics survive only on an error this copy minted. Classification rebuilds
anything else from `kind` and `facts` and drops them — a structurally valid
error from elsewhere cannot smuggle a value in.

- `renderDiagnostics(error)` — one `field: "value"` line per diagnostic,
  JSON-quoted, or `undefined`. Total.
- `logFields(error)` — what a log line may carry:
  `{ error: reason, kind, status?, diagnostics? }`; a value this copy did not
  mint is classified first. Total.

## Catching: `classify` and `readFailure`, never `instanceof`

```ts
import { logFields, readFailure } from '@mcp-abap-adt/auth-errors';

try {
  await provider.getTokens();
} catch (thrown) {
  const error = readFailure(thrown, 'token-request');
  logger.error(logFields(error));
}
```

`classify(thrown, operation, grant?)` turns any value into an error. It is
total — it never throws, whatever the value: a Proxy whose every trap throws,
a revoked Proxy, throwing getters, `null`, a symbol. In order:

1. an error this copy minted: itself;
2. a carrier's `error` (read once) that this copy minted: that error,
   diagnostics included;
3. a structure — the carried value first, then the value itself — whose
   `kind` is known and whose `facts` all pass: rebuilt, re-rendered, without
   diagnostics; its `reason`, `hint` and `diagnostics` are never read;
4. a TLS failure `code`: `tls`;
5. an integer status (`status`, else `response.status`), a registered OAuth
   error code (`oauthError`, else `response.data.error`; a top-level `error`
   is the carrier of step 2, never this) or an allowlisted system `code`:
   `unknown` with those facts;
6. anything else: `unknown` with the operation.

`readFailure(thrown, operation)` is `classify` for a caught value.
`classifyOutcome(value, fallback)` re-checks an `AuthOutcome` a collaborator
answered: `{ ok: true }` is `OK`, a refusal this copy minted passes as it is,
one that rebuilds is rebuilt, anything else is `{ ok: false, refusal }`
with the fallback as `classify(fallback, 'unfamiliar-error')` answers it: a
fallback this copy minted as it is, another copy's or a forged one rebuilt
without diagnostics, anything else `unknown`.

**Never `instanceof`.** Two copies of this package in one process — two
installs, a bundler's duplicate — have two `AuthProviderFailure` classes, and
an `instanceof` against one answers false for the other's failure. A forged
object, on the other hand, can pass `instanceof` by its prototype. Read what
was thrown with `readFailure`, which answers the same kind and facts for
either copy's failure and nothing of a forgery's words.

`AuthProviderFailure` — what a token provider throws: an `Error` named
`AuthProviderFailure` whose own `error` is one minted error; `message` is the
error's `reason`, or `reason — hint`, never a diagnostic; no `cause`. `name`,
`message` and `error` are its only enumerable own properties. The constructor
takes an error this copy minted; anything else becomes `unknown` with
operation `unfamiliar-error`.

- **`isAuthProviderFailure(value)` narrows to a name only.** It answers true
  for a failure of this copy or another — and for a forged object shaped like
  one, a plain JSON copy included — so it narrows to
  `AuthProviderFailureLike`, a value named `AuthProviderFailure` (not known
  to be an `Error`) without `error`. Read the error with `readFailure`;
  never print `message` or `error.reason` of a value this copy did not
  construct.
- **Serialising a failure carries its diagnostics.** `JSON.stringify`,
  `util.inspect` or a logger serialising an `AuthProviderFailure` includes
  `error.diagnostics` (admitted values — a library path, say — but more
  than the words). To log without them, log
  `logFields(readFailure(thrown, operation))` and leave out its
  `diagnostics` field.
- **`structuredClone` loses the failure.** A failure cloned with
  `structuredClone` — sent to a worker, say — comes back a plain `Error`:
  `isAuthProviderFailure` answers false and `readFailure` answers `unknown`.
  A JSON round-trip keeps the kind: `JSON.parse(JSON.stringify(failure))`
  holds `error` with `kind` and `facts`, which `readFailure` rebuilds (without
  diagnostics, with this copy's words). Send the JSON form across such a
  boundary.

## Exhaustiveness: two patterns

A plain `switch` over `error.kind` is not checked by TypeScript. Use one of
the two patterns below; both stop compiling when a kind is added — a new kind
is a major of interfaces-auth, so a consumer finds out on the upgrade, not at
run time.

```ts
import { matchKind, unreachableKind } from '@mcp-abap-adt/auth-errors';

// A: a handler map typed over every kind — a missing handler does not compile
const text = matchKind(error, {
  configuration: (e) => `check ${e.facts.fields.join(', ')}`,
  'client-certificate': (e) => e.reason,
  // … every kind …
  unknown: (e) => e.reason,
});

// B: a switch whose default only compiles when every kind was handled
switch (error.kind) {
  case 'configuration':
    return configure(error);
  // … every kind …
  default:
    return fallback(unreachableKind(error)); // error: never here
}
```

At run time both normalise through `classify(error, 'unfamiliar-error')`: a
handler, or the `default` branch, only ever sees an error this copy minted —
a newer contract's kind, or a fact this build does not know, arrives as
`unknown` with operation `unfamiliar-error`, its required facts present.

**In pattern B, the cases before `default` see the raw value** — possibly
another copy's error or a newer contract's — and only `default` gets the
normalised one. Prefer `matchKind`, or normalise first:
`const known = classify(error, 'unfamiliar-error')`, then switch on `known`.

## Producing: `guard`, `relayOutcome`, `AuthProviderBase`

Every moment of a provider (`prepare`, `establish`, `authorize`,
`rejected`) answers an `AuthOutcome` and never throws.

- **`guard(operation, body, grant?)`** — the boundary of one moment. The
  grant thunk and the body run inside one `try`; the grant is kept only when it
  is an `OAuth2GrantType`; a throw — from the grant, the body, or a thenable
  the body answers — becomes `{ ok: false, refusal: classify(thrown,
  operation, grant) }`. The catch reads only its two locals, never a property
  of the provider. A body that does not throw gets back its answer as
  `classifyOutcome` answers it: `{ ok: true }` is `OK`, this copy's minted
  refusal passes as itself, another copy's or a forged refusal is rebuilt
  without diagnostics, and anything else — not an outcome, a refusal that
  does not rebuild — is the refusal a throw without facts gets: `unknown`
  with the operation and the kept grant. Never rejects.
- **`relayOutcome(call, refused, operation)`** — a logon target's answer, and
  never the target's own object: a throw becomes `classify(thrown, operation)`
  with `thrown: true`; an answer goes through `classifyOutcome` with the
  `logon-target` fallback `{ wire: 'unknown', refused }` and `thrown: false`.
  Never throws.
- **`AuthProviderBase`** — in `@mcp-abap-adt/auth-providers` (not here): the
  abstract class that owns the four moments, each run inside `guard`, for
  anyone writing a provider of their own. The [shape check](#the-shape-check)
  refuses a provider that does not reach it.
- **`OK`** — the one success outcome, `{ ok: true }`, frozen.

**A limit of `guard` and `relayOutcome`.** A target is synchronous by
contract, and a grant thunk answers a plain value. When either answers a plain
native promise, it gets a no-op rejection handler, so its rejection is never
left unhandled. A target or grant that breaks its contract by answering a
Promise subclass or a proxied promise gets none — handling it would run its
code — and its rejection can still be reported as unhandled.

## Shared attempts: `sharedAttempt` and `createParties`

A renewal, a certificate pin or a login may be needed by several callers at
once; they share one attempt, and each may give up on its own.

- **`sharedAttempt<T>(operation)`** answers a slot with `join(start,
  signal?)`: it starts an attempt when the slot is empty, or joins the active
  one. `start` receives the attempt's `signal` (aborted once every waiter has
  aborted) and `exclusive(work)`, which runs work holding an exclusive local
  resource (a callback socket, a stdin reader) once the exclusive work of
  earlier attempts, and earlier exclusive work of this one, has settled. One
  waiter's abort rejects only that waiter, with an `AuthProviderFailure` of
  `interactive-login` `aborted`; a waiter without a signal never aborts; the
  last live waiter's abort makes the attempt leave the slot, so a later join
  starts afresh. A throw or rejection of `start` reaches the waiters only as
  `classify(thrown, operation)`. No timer.
- **`createParties()`** — a provider's attached parties: `attach(signal)`
  returns a `detach`; `waiterSignal()` answers `undefined` with no live party,
  else a `MomentWaiter` `{ signal, release }` whose signal aborts when every
  party live at the moment's start, and every party attached while it runs,
  has aborted.

Rules for the caller:

- **`start`'s result must not be thenable.** A waiter is resolved with it, and
  resolving reads its `then`, which would hand the waiter whatever that `then`
  passes, outside `classify`.
- **Call every `MomentWaiter.release()` in a `finally`**, once the attempt the
  moment waited on has settled; it is idempotent. Until it is released, a
  moment keeps taking in every party attached.
- **A party that detaches does not abort a moment.** It leaves the moment;
  only the abort of every member aborts it.

## Allowlist guards and branded integers

One membership guard per allowlist array of the error contract in
interfaces-auth — `isSystemCode`, `isTlsFailureCode`, `isOAuthErrorCode`,
`isRfcKey`, `isConfigField`, `isOperation`, `isAssertionRule`, … (34) — each
narrowing `unknown` to the array's union. `REFRESH_TOKEN_DISPOSITIONS` (the
token store's, not the error contract's) has none.

The sets behind them cannot be widened. They are module-private, copied from
the frozen arrays at load, and read through a `Set.prototype.has` captured at
load. No export is a `Set`, a `Map` or a mutable array, at the top or one
level down. A test runs every attack it knows — push through a cast, index
assignment, `Object.defineProperty`, `splice`, `Set` and `Map` methods called
on every export with `.call`, patching `Set.prototype.has` and
`Array.prototype.includes` after load — and then checks that a foreign code is
still refused everywhere and appears in no word. A consumer that needs a list
uses the frozen `as const` array from interfaces-auth.

**The threat model's boundary.** These guarantees are about values: what a
caller passes in, throws, or does to the exports. Code running in the same
process that requires a file under `dist/` by its absolute path, or redefines
an export of a module, can change what this package does. That code can
patch anything in the process; this package does not defend against it. The
`exports` map is hygiene that keeps internal modules from being imported by
name, not a security boundary.

`httpStatus()`, `count()`, `port()` make the branded integers: a finite
integer in 100–599, 0–1 000 000 or 0–65 535, read without coercion, comes
back branded (`-0` as `0`); anything else is `undefined`. A literal
`status: 500` does not compile; `httpStatus(500)` narrowed does.

## The brand and its limit

`IAuthProviderError` carries a property keyed by a symbol interfaces-auth
declares and does not export. No code can write the key, so an object
literal, a class instance or a parsed JSON value is not an
`IAuthProviderError` to the compiler, and a builder is the only way to obtain
one.

The limit: a **type assertion** (`value as IAuthProviderError`) still
compiles. The compiler cannot refuse it; the [shape check](#the-shape-check)
does (rule 4), in every repository that runs it. In this package exactly four
assertions are allowed — `mint` and the three integer makers — and they are
listed in `tools/assertion-sites.json`. At run time the brand is no check
either: `isMinted` is, and classification re-mints whatever it did not mint.

## The shape check

`tools/check-provider-shape.mjs` is published with the package: the rules of
the contract TypeScript cannot express, decided on the TypeScript compiler
API. It needs only `typescript`.

**Copy it byte for byte.** A repository that runs it keeps an identical copy
in its own `tools/`, and a test that compares the two:

```bash
cp node_modules/@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs tools/
```

```ts
const canonical = readFileSync(
  require.resolve('@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs'),
  'utf8',
);
expect(readFileSync('tools/check-provider-shape.mjs', 'utf8')).toBe(canonical);
```

When an upgrade of `@mcp-abap-adt/auth-errors` changes the script, that test
fails until the copy is refreshed — the copy cannot drift.

**Run it** in `lint:check`, after Biome, with the rules the repository needs:

```bash
node tools/check-provider-shape.mjs --rules 4,5,6
  [--base <module>#AuthProviderBase] [--root <dir>] [--project <tsconfig>]
  [--sites <dir>] [files…]
```

**Rules 1–3 need the base, by declaration:** `--base` names the repository's
`AuthProviderBase` — a path relative to the root
(`--base ./src/auth/AuthProviderBase#AuthProviderBase` in auth-providers) or
a package specifier resolved as the compiler resolves it
(`--base @mcp-abap-adt/auth-providers#AuthProviderBase` elsewhere). A class
reaches the base only if the declaration it extends is that one: a class of
the same name elsewhere, in a file of the same name too, exempts nothing. The
base itself is verified (reported as rule 1): each of its four moments must
be one method whose body is only `return guard(this.#moments.<moment>,
() => …, () => …)`, with auth-errors' `guard`; no constructor parameter
property may be named after a moment; and nothing may replace a moment —
`this.<moment> = …` in the base, `AuthProviderBase.prototype.<moment> = …`,
`Object.assign` / `Object.defineProperty` of a moment onto its `this` or
prototype, in any checked file and in the base's own file whatever files
were selected. A base read from a declaration file has no bodies — there
only the four methods are required, and the bodies are verified where the
base is written.

| Rule | Refuses, in `src/` outside tests |
|---|---|
| 1 | a class implementing `IAuthProvider` without reaching `AuthProviderBase` (by `implements` or structurally) |
| 2 | a class reaching `AuthProviderBase` that declares or assigns `prepare`, `establish`, `authorize` or `rejected` |
| 3 | an object literal satisfying `IAuthProvider` |
| 4 | a type assertion to an error, refusal, outcome, failure or branded integer outside the sites of `assertion-sites.json`; an overload returning an error, refusal, outcome or failure |
| 5 | a spread or `Object.assign` of an error |
| 6 | a builder call with diagnostics outside the sites of `diagnostic-sites.json`; a builder through `call` / `apply` / `bind` |
| 7 | a `guard` call whose grant is not a function expression, or whose arguments read `this` other than `this.#moments` |
| 8 | in `src/auth` and `src/providers`: a `Basic ` header value, or a base64 of a value named as a client secret, outside `legacyBasic` and `clientSecretBasic` |

Site lists live in the repository's `tools/` (or `--sites`): an
`assertion-sites.json` of `{ file, function }` and a `diagnostic-sites.json`
of `{ file, function, field }`; a missing list is empty.

Each finding is one line on stdout,
`<file>:<line>:<column>: rule <n>: <what>`. **Exit codes:** `0` nothing found;
`1` findings; `2` it cannot check, reported on stderr — a usage error, a file
given that does not exist, nothing to check, a program that does not
type-check, rules 4 / 5 asked for while the brands of interfaces-auth 6.0.0
or later are not found, or rules 1–3 asked for without a `--base` that
resolves to an exported class. It never passes in silence.

**Limits.** It decides on syntax and types, without data flow, so it does not
see, among others: a provider built by a mixin returning an anonymous class;
writes through an alias of `this`, of a prototype, of `Object.assign` or of
`Object.defineProperties`; an unconstrained generic cast helper, or a value of
type `any` assigned without an assertion; `structuredClone` of an error;
`Reflect.apply` of a builder or of `guard`; a provider property read into a
local before a `guard` call; a `Basic ` value assembled from pieces, or a
secret under a name the heuristic does not know. The full list is in the
script's header.

This repository runs rules 4 and 6.

## Exported types

Beside the values above, the entry exports these types:
`AuthErrorBuilders`, `PlainBuilders`, `VariantBuilders`,
`DiagnosticsInputOf`, `One` (the builders); `LogFields` (`logFields`);
`Words` (`render`); `KindHandlers` (`matchKind`); `AuthProviderFailureLike`
(`isAuthProviderFailure`); `RelayedOutcome` (`relayOutcome`);
`SharedAttempt`, `AttemptContext`, `AttemptStart` (`sharedAttempt`);
`Parties`, `MomentWaiter` (`createParties`). The error types themselves come
from interfaces-auth.

## Versioning

interfaces-auth's rule decides most of this package's versions:

- **A major of interfaces-auth:** a new kind; a new member of a discriminant
  a consumer switches on (`problem`, `outcome`, `verdict`, `case`, `rule`,
  `credential`, `source`, `wire`, `refused`); **any change to the shape of the
  facts or the diagnostics** — a field added, removed, made required or
  narrowed, even an optional one, since the fact types are closed and a
  complete object literal stops being one.
- **A minor of interfaces-auth:** a new member of a code list — `SystemCode`,
  `TlsFailureCode`, `OAuthErrorCode`, `RfcKey`, `ConfigField`,
  `SamlStatusCode`. Do not assert exhaustiveness over code lists; only over
  kinds and discriminants.

What it means here:

- This package depends on `^6.0.0`. A major of interfaces-auth needs a major
  of auth-errors that moves its range: the builders, words and fact checks are
  written against one shape. Upgrade the two together, so that a process holds
  one interfaces-auth major (`npm ls @mcp-abap-adt/interfaces-auth`).
- A minor of interfaces-auth is taken up without a release here: the guards
  copy the installed arrays at load, so a new code is admitted at once. A code
  this build has no words for (a new TLS code, say) renders the unfamiliar
  words until a release of auth-errors adds them.

## Development

```bash
npm run build        # clean build: Biome errors, then tsc
npm run test:check   # type check: sources, tests and type tests
npm run lint:check   # Biome (warnings fail), then the shape check, rules 4 and 6
npm test             # Jest; needs a build first (tests load dist/)
npm run docs:kinds   # regenerate the README kinds table (needs a build)
```

## License

LGPL-3.0-only — see [LICENSE](LICENSE) and [COPYING](COPYING).
