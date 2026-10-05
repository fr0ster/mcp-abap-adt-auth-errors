# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Dependencies

- `@mcp-abap-adt/interfaces-auth` `^6.0.0` — the only dependency, resolved
  from the registry. 6.0.0 adds two optional facts to `interactive-login`:
  `strategy` on outcome `aborted`, `oauthError` on outcome `failed`.

### Added

- The package scaffold: build, type check (tests and type tests included),
  Biome with warnings as errors, Jest, CI on Node.js 22, 24 and 26, and a
  release workflow on a `v*.*.*` tag.
- `OK` — the one success outcome, `{ ok: true }`, frozen, typed as the
  `{ ok: true }` member of `AuthOutcome` from
  `@mcp-abap-adt/interfaces-auth` 6.0.0.
- `httpStatus()`, `count()`, `port()` — the branded-integer makers: a finite
  integer inside 100–599, 0–1 000 000, 0–65 535, read without coercion,
  comes back as `HttpStatus`, `Count`, `Port`; anything else is `undefined`.
- One membership guard per allowlist array of `interfaces-auth` 6.0.0
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
  `interactive-login` `aborted` with no strategy reads `the authorization
  was aborted`, and with `strategy: 'browser'` `the browser login was
  aborted` — each with `; <k> incomplete request(s) reached /callback and
  were ignored` when `ignoredCallbacks` is above 0; with `strategy: 'manual'` it reads `the manual login was aborted`, never
  with that clause. `failed` reads `the browser login failed (HTTP <n>[,
  <oauthError>][, <code>])`, or `(unknown error[, <oauthError>][, <code>])`
  without a status — the registered OAuth code where today's words put it.
  A `strategy` outside `browser` / `manual` and an unregistered `oauthError`
  are dropped, and the words are those without them.
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
  `thrown: false`. Never throws. A plain native promise answered by a
  target (or by `guard`'s grant thunk) — `Promise.prototype` its prototype,
  no own `constructor`, no Proxy around it, `Promise.prototype.constructor`
  and `Promise[Symbol.species]` still the built-ins — gets a no-op rejection
  handler through the `then` captured at load, so an async target's
  rejection is never left unhandled. Nothing else is handled, since handling
  it would run its code: a foreign thenable's `then` is never called, and
  **a limit** remains — a target or grant thunk that breaks its contract by
  answering a rejecting Promise subclass or a proxied promise can still
  cause an unhandled rejection.
- `matchKind(error, handlers)` and `KindHandlers<R>` — a handler map typed
  over every kind (a missing handler does not compile); `unreachableKind(
  error: never)` — the exhaustiveness check of a `switch`'s `default`. Both
  normalise through `classify(error, 'unfamiliar-error')`: a handler, or the
  default branch, only ever sees an error this copy minted — a newer
  contract's kind, or a fact this build does not know, arrives as `unknown`
  with operation `unfamiliar-error`.
- `sharedAttempt<T>(operation)` — a slot of shared attempts (spec §6b), with
  `SharedAttempt`, `AttemptContext` and `AttemptStart`. `join(start,
  signal?)` starts an attempt when the slot is empty or joins the active
  one; `start` gets the attempt's `signal` and `exclusive(work)`. One
  waiter's abort rejects only that waiter with an `AuthProviderFailure` of
  `interactive-login` `aborted`; a waiter without a signal never aborts;
  the last live waiter's abort makes the attempt leave the slot
  (identity-checked) before that waiter is rejected and before the
  attempt's signal aborts, so a join arriving meanwhile starts afresh. A
  settled attempt leaves the slot; a throw or rejection of `start` reaches
  the waiters only as `classify(thrown, operation)`. Every attempt carries a
  drain — its `exclusive` work, settled either way, plus the drain it
  inherited — which the slot hands to the next attempt; `exclusive` awaits
  it, raced only against the attempt's signal. A waiter's signal is read
  guarded: one that is not an object, whose `aborted` throws or is not a
  boolean, or whose `addEventListener` throws refuses only its own waiter
  (`aborted`). No timer; what an attempt commits stays with the caller.
  Calls of `exclusive` within one attempt run one at a time, in call order.
  `T` must not be thenable.
- `createParties()` — a provider's attached parties (spec §6b), with
  `Parties` and `MomentWaiter`: `attach(signal)` returns a `detach`; the
  same signal is one party; a party is released on its signal's abort (its
  listener removed) or on `detach`; an already-aborted or unusable signal is
  not added. `waiterSignal()` answers `undefined` with no live party (the
  moment's login never aborts), else `{ signal, release }`: a signal aborted
  when every party live at the moment's start, and every party attached
  while it runs, has aborted; a party detached meanwhile leaves the moment
  without aborting it. `release()` ends the moment's membership; nothing
  accumulates.
- `tools/check-provider-shape.mjs` — the shape check of the error contract
  (spec §8.2), published as a plain file for connection, auth-providers and
  the broker to copy byte for byte; it needs only `typescript`. Run as
  `node tools/check-provider-shape.mjs --rules <n,…>`, it refuses, in
  `src/` outside tests: (1) a class implementing `IAuthProvider` — by
  `implements` (beside the base: drop the clause), or structurally without
  reaching `AuthProviderBase`, class expressions included; (2) a class
  reaching `AuthProviderBase` that declares or assigns `prepare`,
  `establish`, `authorize` or `rejected` — a computed name from a constant,
  `Object.assign` / `Object.defineProperty` onto `this` or its `prototype`
  included; (3) an object literal satisfying `IAuthProvider`; (4) a type
  assertion to a type carrying a brand of `interfaces-auth` (an error, a
  refusal, an outcome, a failure, a branded integer) outside the sites of
  `tools/assertion-sites.json`, and an overload returning an error,
  refusal, outcome or failure outside this package's `builders.ts` and
  `mint.ts`; (5) a spread or `Object.assign` of an error; (6) a builder call
  with diagnostics outside the sites of `tools/diagnostic-sites.json`, or a
  builder through call / apply / bind; (7) a `guard` call whose grant is not
  a function expression or whose arguments read `this` other than
  `this.#moments`; (8) in `src/auth` and `src/providers`, a `Basic `
  header value (a template head, a constant, `Basic` joined later, a
  literal credential — not prose) or a base64 of a value named as a client
  secret (a heuristic; a hash or HMAC is not reported) outside
  `legacyBasic` and `clientSecretBasic`. It exits 2 rather than pass in
  silence: on a program that does not type-check, a given file that does
  not exist, nothing to check, or rules 4 / 5 without the brands of
  interfaces-auth 6.0.0 or later. What it does not see is listed in the
  script's header (Limits). This repository runs rules 4 and 6 in
  `lint:check`, its four assertion sites being `mint` and the three integer
  makers.
