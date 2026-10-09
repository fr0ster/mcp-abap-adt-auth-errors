# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`@mcp-abap-adt/auth-errors` — the **runtime half** of the authentication error
contract. `@mcp-abap-adt/interfaces-auth` (6.0.0+) declares the types —
`IAuthProviderError` (`kind`, `variant` for three kinds, `facts`, `reason`,
`hint?`, `diagnostics?`), `IAuthRefusal` (the error itself), `AuthOutcome`,
`IAuthProviderFailure`, the allowlist arrays and their unions, the branded
integers — and holds no logic. This package holds the code: every producer
(auth-providers, connection's logon targets, the broker) obtains its errors
here, and every reader classifies what it caught here.

A change to a word, a list or a rule is made here and in the test that
protects it; the consumers (auth-providers, connection, the broker) take it
with their next dependency bump.

## Rules

1. **The only place a brand is minted.** `IAuthProviderError` carries a brand
   keyed by an unexported symbol, so no code can write one. `mint` (`mint.ts`)
   is the single type assertion that produces one, and it records every
   minted error in a module-private `WeakSet` — that membership is the only
   provenance mark (`isMinted`). The three branded-integer makers
   (`numbers.ts`) are the only other assertion sites. Any other `as` / `<T>`
   whose target is or contains an error, an outcome, a failure or a branded
   integer is a defect.
2. **One builder per kind** (`builders.ts`) — the only exported way to obtain
   an error. A builder never throws: it reads every fact as an own data
   property and checks it (`factCheck.ts`) against its allowlist guard or
   branded-integer maker, drops an invalid optional fact, answers `unknown`
   (`unfamiliar-error`) for an invalid required one, normalises (absent keys
   omitted, arrays copied, capped and deduplicated, everything frozen), admits
   each diagnostic (`admission.ts`), renders `reason` / `hint` with the
   default words, and mints. `render` runs the same check.
3. **No secret and no foreign text in any error.** `reason` / `hint` come only
   from `WORDS` (`words.ts`), rendered from `kind` and `facts`. Facts are
   allowlist members and branded ranges only. Diagnostics are admitted field
   by field (`LocalPath`, `DocumentValue`, `XmlName`, `XmlId`,
   `DocumentTime`, `ConfigUri`) and kept only when minted by this copy's
   builder; a structural rebuild drops them. No `message`, `cause`, `stack`,
   `name`, body or string form of a thrown value is ever read — not here, not
   in classification.
4. **Classification is total** (`classify.ts`). `classify` and
   `classifyOutcome` run inside their own `try`; every property is read once,
   through a guarded read, so a throwing getter, a Proxy trap or a revoked
   Proxy reads as absent and answers `unknown`. A foreign structure is
   re-minted from `kind` and checked `facts` only; its `reason`, `hint` and
   `diagnostics` are never read.
5. **Nothing mutable is exported.** Allowlist sets are module-private
   (`allowlists.ts`), exposed only through membership guards that call a
   `Set.prototype.has` captured at load. Tables (`WORDS`, the diagnostics and
   blame tables) are module-private or exported only deeply frozen. `OK` is
   frozen. A consumer that needs a list uses the frozen `as const` array from
   `interfaces-auth`. `widening.test.ts` runs the attacks on
   every export (one level down) and every allowlist array, and sweeps the
   namespace for a `Set` / `Map`: a new export that is one fails there.
6. **Exhaustive by construction.** `WORDS` `satisfies` a mapped type over
   every kind; within a kind every discriminant is a `switch` ending in
   `unreachable(x: never)`. A kind or variant without words does not compile.
7. **No implicit defaults — the consumer composes.** The default words are
   stored, but a consumer may render its own from `kind` and `facts`
   (`render`, `matchKind`); nothing here reads the environment, a file, or a
   global configuration.
8. **Strict compiler, no escape hatches.** `tsconfig.json` sets `strict`,
   `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`,
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; `noExplicitAny`
   is an error, and Biome warnings fail `lint:check`.

9. **Words in the README are generated, never copied.** The kinds table
   between the `BEGIN GENERATED` / `END GENERATED` markers is what
   `kindsTable.test.ts` renders from the built builders; it fails when they
   differ. After changing a word or a list: `npm run docs:kinds` (builds, then
   runs that test with `WRITE_README_TABLES=1`; refused when `CI` is set). The
   pieces a repository needs for a table of its own are the `./tables`
   subpath (`src/tables.ts`). Prose quotes no word.
10. **The shape check is a module, run as a test.** `src/shapeCheck/` is
    published as `@mcp-abap-adt/auth-errors/shape-check`
    (`checkProviderShape`, `reportLines`): the caller hands it its own
    `typescript`, and the package declares no dependency on TypeScript and
    loads none (`import type` only). Each repository runs it from a Jest test
    with its own options constant — no copy of a script. A change to a rule is
    a change for every repository: keep the module's description (its limits)
    and the README's summary current. `tools/check-provider-shape.mjs` stays as
    a thin command over the module, with the same arguments, lines and exit
    statuses; it holds no rule. `npm run test:shape` runs the shape-check test
    alone, and `prepublishOnly` runs it after the build.

## Dependencies

`dependencies`: `@mcp-abap-adt/interfaces-auth` only, from the npm registry —
never a `file:`, `link:` or `npm link`. After any install the lockfile holds
no `"link": true` and every package resolves from `registry.npmjs.org`.

## Build Commands

```bash
npm run build        # clean + Biome errors + tsc -p tsconfig.build.json
npm run build:fast   # tsc -p tsconfig.build.json
npm run test:check   # tsc --noEmit over sources, tests and __typechecks__
npm run lint:check   # Biome, --error-on-warnings, alone
npm run test:shape   # the shape check (shapeCheck.test.ts); the publishing gate runs it after the build
npm run lint         # Biome with --write
npm run docs:kinds   # build, then rewrite the README kinds table (its test in write mode)
npm test             # Jest (needs a build: tests load dist/ as a consumer would)
```

Run one file: `npm test -- src/__tests__/ok.test.ts`. Never invoke
`npx jest` directly — the npm script supplies `--experimental-vm-modules`.

## Layout

```
src/
├── index.ts          # public surface
├── allowlists.ts     # module-private sets, membership guards
├── numbers.ts        # branded integer makers
├── admission.ts      # diagnostics admission
├── mint.ts           # the one assertion, the WeakSet
├── factCheck.ts      # each kind's facts read own and checked (builders, render)
├── builders.ts       # one builder per kind
├── words.ts          # WORDS, render
├── diagnostics.ts    # renderDiagnostics
├── classify.ts       # classify, classifyOutcome
├── failure.ts        # AuthProviderFailure, readFailure
├── guard.ts          # guard, relayOutcome
├── exhaustive.ts     # matchKind, unreachableKind
├── sharedAttempt.ts  # the waiter rules of a shared attempt
├── shapeCheck/       # the shape check: index.ts (API), options.ts, program.ts, rules/, types.ts
├── tables.ts         # the ./tables subpath: render, contract, rowsFor, markdownCell, withRegions, tableWriteMode
├── __tests__/        # Jest; built-package tests require dist/ by path
│                     #   widening.test.ts — allowlists cannot be widened
│                     #   kindsTable.test.ts — README table equals the rendered one; write mode
│                     #   exportsMap.test.ts — packed package: five paths by name, deep paths refused
│                     #   readme.test.ts — Install names the five paths and package.json's interfaces-auth range
│                     #   shapeCheck*.test.ts — the module, its fixtures, the packed command; mainEntryLoadsNothing.test.ts
└── __typechecks__/   # compiled by test:check only, never built or run
tools/
├── check-provider-shape.mjs  # the published command: a thin wrapper over the shape-check module, no rule
├── assertion-sites.json      # rule 4's sites: mint and the three integer makers
├── diagnostic-sites.json     # rule 6's sites: none
└── __fixtures__/             # one file per rule breaking it, the obeying ones; the module's tests run them
```

## Testing

Tests first. A test meant to protect a rule is proved load-bearing: break the
rule, watch it go red, revert. A type rule gets a `__typechecks__` file
(`Expect<Equal<…>>`, or `@ts-expect-error` for what must not compile), which
`test:check` compiles and `tsconfig.build.json` leaves out of `dist`.

## Plans and specs

Everything under `docs/superpowers/` is kept only while active; once
implemented or cancelled, delete it, at the latest before the release that
ships the work.
