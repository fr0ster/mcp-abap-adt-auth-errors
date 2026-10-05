# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The package scaffold: build, type check (tests and type tests included),
  Biome with warnings as errors, Jest, CI on Node.js 22, 24 and 26, and a
  release workflow on a `v*.*.*` tag.
- `OK` — the one success outcome, `{ ok: true }`, frozen, typed as the
  `{ ok: true }` member of `AuthOutcome` from
  `@mcp-abap-adt/interfaces-auth` 5.0.0.
- `httpStatus()`, `count()`, `port()` — the branded-integer makers: a finite
  integer inside 100–599, 0–1 000 000, 0–65 535, read without coercion,
  comes back as `HttpStatus`, `Count`, `Port`; anything else is `undefined`.
- One membership guard per allowlist array of `interfaces-auth` 5.0.0
  (`isSystemCode`, `isTlsFailureCode`, `isOAuthErrorCode`, `isRfcKey`,
  `isConfigField`, `isAssertionRule`, `isOperation`, … — 34 in all), each
  narrowing `unknown` to the array's union. The sets behind them are
  module-private, copied from the arrays at load, and read through a
  `Set.prototype.has` captured at load, so patching it later changes no
  answer.
- `authError` — one builder per kind, the only way to obtain an
  `IAuthProviderError`. The builders of `saml-assertion`, `snc` and
  `configuration` are generic over the variant, inferred from the facts
  literal (a discriminant typed as a whole union does not compile), take the
  diagnostics that variant permits and answer that variant's error type;
  every other kind takes facts only. A builder omits absent facts, copies
  every array, deduplicates `fields` and caps it at 8, caps `candidates` at 5
  (`saml-assertion`, counting the rest in `moreCandidates`) or 8 (`snc`,
  `candidatePaths` aligned with them), admits each permitted diagnostic and
  drops any other field or refused value, renders `reason` / `hint` and
  mints the error frozen deeply. It never throws: every fact is read as an
  own data property (no getter or conversion is ever invoked) and checked
  against its allowlist guard or branded-integer maker; an invalid optional
  fact is dropped, an invalid required one makes the call answer the
  unfamiliar error (`unknown`, operation `unfamiliar-error`). A count of a
  "carries N" rule must be at least 2; bearer candidates not listed are all
  counted, from the array's own length.
- `isMinted(value)` — true only for an error this copy of the package
  minted (a module-private `WeakSet`); a structural copy is not one.
- `render(kind, facts)` — the default words a builder stores, from `kind`
  and `facts` only, never a diagnostic: today's strings exactly where the
  error contract marks a row verbatim; an unknown kind or discriminant
  answers "an authentication error of a kind this version does not know"
  as a whole — so does an operation, TLS code, rule or candidate reason this
  build does not know (`constructor` and `toString` included), or a
  required fact that is missing.
  No word mentions a login timeout.
- `blamesCredential(error)` — whether an error blames the credential:
  `credential-refused` and `renewal-unchanged`; `snc` `no-credential`, and
  `logon-refused` with `RFC_LOGON_FAILURE`; `connection`
  `refused-after-renewal`. Total.
- `AuthProviderFailure` — the one thrown class: an `Error` named
  `AuthProviderFailure` holding one minted error as its own `error` data
  property; `message` is the error's `reason`, or `reason — hint`, never a
  diagnostic; no `cause`. `error` and `message` are neither writable nor
  configurable. `name`, `message` and `error` are its only
  enumerable own properties, so `JSON.stringify` and pino's serializer see
  those three. The constructor takes an error minted by this copy (typed and
  checked): anything else — a `structuredClone`, a JSON copy, another copy's
  error — becomes `unknown` with operation `unfamiliar-error`; classify a
  foreign value with `readFailure` first to keep its kind and facts.
- `readFailure(thrown, operation)` — `classify` for a caught value: this
  copy's failure answers its error as it is, diagnostics included; another
  copy's failure, or any carrier, is rebuilt without diagnostics.
- `isAuthProviderFailure(value)` — true for a failure of this copy or
  another: an own data `name` of `AuthProviderFailure` and an own data
  `error` this copy minted or that rebuilds structurally. No `instanceof`,
  no getter, never `message`. Total. A forged object passes too, so it
  narrows to `AuthProviderFailureLike` (an `Error` named
  `AuthProviderFailure`, without `error`): read the error with
  `readFailure(value, operation)`, never print `message` or `error.reason`
  of a value this copy did not construct.
- `guard(operation, body, grant?)` — the boundary of one provider moment:
  the grant thunk and the body run inside one `try`; the grant is kept only
  when it is an `OAuth2GrantType`; a throw (from the grant, the body, or a
  thenable the body answers) becomes `{ ok: false, refusal:
  classify(thrown, operation, grant) }`, the catch reading only its two
  locals. Never rejects.
- `relayOutcome(call, refused, operation)` and `RelayedOutcome` — a logon
  target's answer, never the target's own object: a throw is
  `classify(thrown, operation)` with `thrown: true`; an answer goes through
  `classifyOutcome` (this copy's refusal as it is, another copy's rebuilt
  without diagnostics, anything else — a carrier included — the
  `logon-target` fallback `{ wire: 'unknown', refused }`, built here) with
  `thrown: false`. Never throws.
- `matchKind(error, handlers)` and `KindHandlers<R>` — a handler map typed
  over every kind (a missing handler does not compile); `unreachableKind(
  error: never)` — the exhaustiveness check of a `switch`'s `default`. Both
  normalise through `classify(error, 'unfamiliar-error')`: a handler, or the
  default branch, only ever sees an error this copy minted — a newer
  contract's kind, or a fact this build does not know, arrives as `unknown`
  with operation `unfamiliar-error`.
