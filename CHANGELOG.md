# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] - 2026-10-08

### Changed
- `interactive-login` `aborted`: the count of ignored requests reads
  "N request(s) to the callback server were refused and ignored". Since
  auth-providers 6.0.0 the callback transport refuses more than incomplete
  callbacks — a foreign `state`, a foreign `Host`, a forged paste — and the
  count includes them; "incomplete request(s) reached /callback" said less
  than it counted. The facts (`ignoredCallbacks`) are unchanged.

## [2.0.0] - 2026-10-07

A major: the contract package moves to `@mcp-abap-adt/interfaces-auth` 7.0.0,
which removes an interactive outcome and renames an operation. The new kind
`renewal-declined` is also breaking for a consumer that handles every kind:
a `matchKind` table or an exhaustive `switch` over `error.kind` no longer
compiles until it handles it.

### Dependencies

- `@mcp-abap-adt/interfaces-auth` `^7.0.0` (was `^6.0.0`), resolved from the
  registry.

### Added

- Kind `renewal-declined`, facts `{ trigger }` (`RENEWAL_TRIGGERS`: `no-token`,
  `expired`, `bound-elsewhere`, `explicit`, `rejected`): the builder
  `authError['renewal-declined']`, `matchKind` and `classify` handle it, and
  `isRenewalTrigger` guards the array. Reason "the renewal strategy declined
  to renew the credential", no hint; the trigger is checked and named in no
  word. It does not blame the credential (`blamesCredential` is `false`).
- Configuration case `invalid-value` (facts as `required-fields-missing`):
  reason "a configured value cannot be used: <fields>", no hint.
- Operation phrases for `renewal-strategy` ("the renewal strategy") and
  `persisting-tokens` ("persisting the tokens"), the subject of
  "<phrase> failed (...)".

### Removed

- Interactive outcome `browser-launch-failed`, with its words and hint ("the
  browser could not be opened", "open the authorization URL from the log by
  hand"): interfaces-auth 7.0.0 no longer has it, so `authError['interactive-login']`
  no longer accepts it and `render` answers the unfamiliar words for it.

### Changed

- Operation `on-tokens-hook` is renamed `persisting-tokens`; its phrase was
  `onTokens` and is now "persisting the tokens", so a `request-failed` or
  `unknown` error of that operation reads "persisting the tokens failed (...)".

### Migration

A consumer on 1.x of this package and `interfaces-auth` 6: move both to
`^7.0.0` / `^2.0.0` together; replace `on-tokens-hook` with `persisting-tokens`
and stop producing or matching `browser-launch-failed` (a launcher that fails
is no longer an error of the login). A `matchKind` handler table must gain a
`renewal-declined` handler, and a `switch` over `error.kind` a case for it.
The shape-check script is unchanged.

## [1.0.1] - 2026-10-07

### Fixed

- Shape check, rule 8: its scope now includes `src/clientAuthentication/`. The
  exemption for `clientSecretBasic` (`src/clientAuthentication/clientSecret.ts`)
  never applied, because the scope was only `src/auth/` and `src/providers/`:
  a `Basic ${x}` header anywhere in `src/clientAuthentication` passed with exit
  0. It is now reported, except in `clientSecretBasic`.
- Shape check, rule 8: a digest (`createHash` / `createHmac` `.digest()`) or
  a signature (`createSign` `.sign()`, `crypto.sign`) ends secret derivation,
  so a base64 of a hash of a secret is not reported (decided by the declaration
  a name resolves to in Node's `crypto` typings, never by the name); and the `clientSecretBasic`
  exemption covers the functions inside it (the returned `authenticate`).
  Documented limits: destructured crypto functions and `subtle.digest` are
  reported, as is a crypto object held in a `let`/`var`/parameter/property
  (only a `const` is trusted), and the boundary needs a name rooted at an
  import from `crypto` / `node:crypto`, and the chain must be exactly
  `factory(…) [.update(…)]* .digest(…)` / `.sign(…)` (`pipe`, `copy` and the
  like keep secret tracking) (an injected, type-only adapter is
  reported); a replaced method on a crypto object is not detected.

## [1.0.0] - 2026-10-06

The first release: the runtime half of the authentication error contract,
whose types `@mcp-abap-adt/interfaces-auth` 6.0.0 declares. Every producer
obtains its errors here and every reader classifies what it caught here.
README.md documents the whole surface.

### Dependencies

- `@mcp-abap-adt/interfaces-auth` `^6.0.0` — the only dependency, resolved
  from the registry. 6.0.0 adds two optional facts to `interactive-login`:
  `strategy` on outcome `aborted`, `oauthError` on outcome `failed`.

### Added

- The package: build, type check (tests and type tests included), Biome with
  warnings as errors and the shape check in `lint:check`, Jest, CI on
  Node.js 22, 24 and 26, and a release workflow on a `v*.*.*` tag.
- `OK` — the one success outcome, `{ ok: true }`, frozen, typed as the
  `{ ok: true }` member of `AuthOutcome` from
  `@mcp-abap-adt/interfaces-auth` 6.0.0.
- `httpStatus()`, `count()`, `port()` — the branded-integer makers: a finite
  integer inside 100–599, 0–1 000 000, 0–65 535, read without coercion,
  comes back as `HttpStatus`, `Count`, `Port`; anything else is `undefined`.
- One membership guard per allowlist array of the error contract in
  `interfaces-auth` 6.0.0 (`isSystemCode`, `isTlsFailureCode`,
  `isOAuthErrorCode`, `isRfcKey`, `isConfigField`, `isAssertionRule`,
  `isOperation`, … — 34 in all; `REFRESH_TOKEN_DISPOSITIONS`, the token
  store's, has none), each narrowing `unknown` to the array's union. The sets behind them are
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
- `classify(thrown, operation, grant?)` and `classifyOutcome(value,
  fallback)` — classification (spec §5.4). `classifyOutcome` answers `OK`,
  this copy's refusal as it is, a rebuilt one, or else the fallback as
  `classify(fallback, 'unfamiliar-error')` answers it: this copy's error as
  it is, another copy's or a forged one rebuilt without diagnostics,
  anything else `unknown` — a fallback's own text never passes unchecked.
- `renderDiagnostics(error)` — the diagnostics of an error this copy
  minted, one `field: "value"` line each, JSON-quoted, or `undefined`.
  Total. `logFields(error)` and its type `LogFields` — what a log line may
  carry: `{ error: reason, kind, status?, diagnostics? }`, a value this
  copy did not mint classified first; dropping its `diagnostics` field
  drops every diagnostic-derived character. Total.
- Exported types: `AuthErrorBuilders`, `VariantBuilders`, `PlainBuilders`,
  `DiagnosticsInputOf`, `One` (the builders); `LogFields` (`logFields`);
  `Words` (`render`); `KindHandlers` (`matchKind`); `AuthProviderFailureLike`
  (`isAuthProviderFailure`); `RelayedOutcome` (`relayOutcome`);
  `SharedAttempt`, `AttemptContext`, `AttemptStart` (`sharedAttempt`);
  `Parties`, `MomentWaiter` (`createParties`).
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
  narrows to `AuthProviderFailureLike` (a value named
  `AuthProviderFailure` — not known to be an `Error`, since a JSON copy
  passes — without `error`): read the error with
  `readFailure(value, operation)`, never print `message` or `error.reason`
  of a value this copy did not construct.
- `guard(operation, body, grant?)` — the boundary of one provider moment:
  the grant thunk and the body run inside one `try`; the grant is kept only
  when it is an `OAuth2GrantType`; a throw (from the grant, the body, or a
  thenable the body answers) becomes `{ ok: false, refusal:
  classify(thrown, operation, grant) }`, the catch reading only its two
  locals. A body that does not throw gets back its answer through
  `classifyOutcome`: `OK` and this copy's minted refusal as they are,
  another copy's or a forged refusal rebuilt without diagnostics, anything
  else `unknown` with the operation and the kept grant. Never rejects.
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
  drain — its `exclusive` work (reserved in the drain before the work runs,
  so work that synchronously ends its attempt is still in the drain it
  hands on), settled either way, plus the drain it
  inherited — which the slot hands to the next attempt; `exclusive` awaits
  it, raced only against the attempt's signal. A waiter's signal is read
  guarded: one that is not an object, whose `aborted` throws or is not a
  boolean, or whose `addEventListener` throws refuses only its own waiter
  (`aborted`); `aborted` is read again after the listener is added, so a
  signal aborting during its own registration refuses its waiter too (and
  is not added as a party), its listener removed; a registration that does
  not end cleanly — `addEventListener` throws, or the signal is aborted or
  unreadable after it — removes the provisional party as an abort, so a
  moment left with no member is aborted. Only an explicit `detach` removes
  a party without aborting. A signal's getter, `addEventListener` and
  `removeEventListener` run only on a consistent state — memberships, the
  slot and the moments to abort decided first — so code calling back in
  from them (join, attach, detach, an abort) sees the final state; the
  rejections and aborts follow, a waiter's rejection before its attempt's
  abort. A member (waiter or party) that leaves while its own registration
  runs — a re-entrant detach, abort or eager listener call — gets one more
  `removeEventListener` once the registration returns or throws, with no
  further membership change, so no listener outlives it. A finished member
  keeps nothing of the consumer's: a released party drops its signal, an
  ended moment its parties, a released `MomentWaiter` its moment and the
  party set, a settled waiter its listener removal; an aborted waiter's
  failure and an aborted attempt's or moment's `signal.reason` are built
  without stack frames (which would hold the dispatching signal). A kept
  handle — a `MomentWaiter`, a `detach`, an `AttemptContext`, a waiter's
  promise — lets the signal be collected. Every closure handed out (a
  `detach`, `MomentWaiter.release`, `AttemptContext.exclusive`) holds its
  captures in a cell cleared at its first use and when what it refers to
  ends by itself (a party released, a moment ended, an attempt settled or
  aborted), so a kept handle keeps neither the party set nor the slot — nor
  through them any other member's signal. The listener registered on a
  consumer's signal reaches its waiter or party the same way, its cell
  cleared when the member ends and before the foreign removal runs: a
  signal that keeps the listener (its `removeEventListener` throwing) keeps
  an inert function. No timer; what an attempt commits stays with the caller.
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
  reaching `AuthProviderBase` that declares or assigns (on `this` or its
  `prototype`, through assertions too) `prepare`,
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
  `legacyBasic` and `clientSecretBasic`. Rules 1–3 identify the base by
  declaration: `--base <module>#AuthProviderBase` (a path relative to the
  root, or a package specifier resolved as the compiler does); a class
  reaches it only through that declaration — a same-named class elsewhere
  exempts nothing — and the base's own four moments must each only `return
  guard(this.#moments.<moment>, () => …, () => …)`, with no constructor
  parameter property named after a moment and no write replacing one
  (`this.<moment> =`, `AuthProviderBase.prototype.<moment> =`,
  `Object.assign` / `Object.defineProperty` onto its `this` or prototype,
  its own file scanned whatever files were selected)
  (reported as rule 1;
  required methods only, for a base read from a declaration file). It exits
  2 rather than pass in silence: on a program that does not type-check, a
  given file that does not exist, nothing to check, rules 4 / 5 without the
  brands of interfaces-auth 6.0.0 or later, or rules 1–3 without a `--base`
  that resolves to an exported class. What it does not see is listed in the
  script's header (Limits). This repository runs rules 4 and 6 in
  `lint:check`, its four assertion sites being `mint` and the three integer
  makers.
- README.md: what an error is; the sixteen kinds and their facts; the words
  of every kind and every discriminant value, in a table generated from the
  built package's builders by `scripts/generate-kinds-table.mjs`
  (`npm run docs:kinds`) — a test fails when the committed table differs;
  diagnostics and their admission; catching with `classify` / `readFailure`
  and never `instanceof`; the two exhaustiveness patterns; `guard`,
  `relayOutcome` and a pointer to `AuthProviderBase`; `sharedAttempt` and
  `createParties` with the caller's rules; the allowlist guards; the brand
  and its limit; the shape check (copying it byte for byte, `--rules`, exit
  codes, limits); versioning against interfaces-auth.
- A test that exported allowlists cannot be widened: after a push through a
  cast, an index assignment, `Object.defineProperty` of an index or
  `length`, `splice`, and `Set` / `Map` methods called with `.call` on every
  allowlist array of interfaces-auth and on every export of this package
  (one level down included), and with `Set.prototype.has`,
  `Array.prototype.includes` and `Array.prototype.indexOf` patched, every
  guard answers as before, a foreign code, OAuth error, rule, kind,
  operation or field is still refused by `classify`, `classifyOutcome`,
  `readFailure`, the builders and `render`, and appears in no word, log
  field or diagnostic. No export is a `Set`, `Map`, `WeakSet` or `WeakMap`,
  nested one level, and an array one level down is frozen.
- An `exports` map: the entry (`types`, `require`, `default` →
  `dist/`), `./package.json` and `./tools/check-provider-shape.mjs`. A deep
  path by name (`@mcp-abap-adt/auth-errors/dist/allowlists`) is
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. A test packs the package, installs it
  into a temporary `node_modules` and checks the three paths and the
  refusal.

### Known limits

- Out of the threat model: code in the same process that requires `dist/`
  by absolute path or redefines an export of a module. The `exports` map is
  hygiene, not a security boundary.
- `structuredClone` of an `AuthProviderFailure` comes back a plain `Error`:
  `isAuthProviderFailure` answers false and `readFailure` answers
  `unknown`. A JSON round-trip keeps the kind and facts.
- `guard` / `relayOutcome`: a target or grant thunk answering a rejecting
  Promise subclass or a proxied promise can still cause an unhandled
  rejection; handling it would run its code.
- The type brand does not refuse a type assertion; the shape check does
  (rule 4), in the repositories that run it.
