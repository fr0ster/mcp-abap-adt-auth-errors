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
  mints the error frozen deeply. It never throws: facts are read through
  own data properties only, so a getter, a throwing Proxy, a revoked Proxy,
  a cycle, a hole or an `undefined` element reads as absent.
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
