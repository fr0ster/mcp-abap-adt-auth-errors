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

The binding design is the error-contract spec (auth-providers,
`docs/superpowers/specs/2026-10-05-error-contract-design.md`, §5 for this
package). A change that departs from it changes the spec first.

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
   `interfaces-auth`. `widening.test.ts` runs the attacks of spec §11.1 on
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
   `scripts/generate-kinds-table.mjs` prints from the built builders;
   `kindsTable.test.ts` fails when they differ. After changing a word or a
   list: `npm run build && npm run docs:kinds`. Prose quotes no word.
10. **The shape check is canonical here.** `tools/check-provider-shape.mjs` is
   published (`files`); connection, auth-providers and the broker keep
   byte-identical copies with a test comparing them. A change to it is a
   change for every repository: keep its header's rules and Limits current,
   and the README's summary with them.

## Dependencies

`dependencies`: `@mcp-abap-adt/interfaces-auth` only, from the npm registry —
never a `file:`, `link:` or `npm link`. After any install the lockfile holds
no `"link": true` and every package resolves from `registry.npmjs.org`.

## Build Commands

```bash
npm run build        # clean + Biome errors + tsc -p tsconfig.build.json
npm run build:fast   # tsc -p tsconfig.build.json
npm run test:check   # tsc --noEmit over sources, tests and __typechecks__
npm run lint:check   # Biome, --error-on-warnings, then the shape check (rules 4, 6)
npm run lint         # Biome with --write
npm run docs:kinds   # regenerate the README kinds table (after a build)
npm test             # Jest (needs a build: tests load dist/ as a consumer would)
```

Run one file: `npm test -- src/__tests__/ok.test.ts`. Never invoke
`npx jest` directly — the npm script supplies `--experimental-vm-modules`.

## Layout

```
src/
├── index.ts          # public surface
├── allowlists.ts     # module-private sets, membership guards (§5.5)
├── numbers.ts        # branded integer makers (§4.3)
├── admission.ts      # diagnostics admission (§5.3)
├── mint.ts           # the one assertion, the WeakSet
├── factCheck.ts      # each kind's facts read own and checked (builders, render)
├── builders.ts       # one builder per kind (§5.2)
├── words.ts          # WORDS, render (§5.6)
├── diagnostics.ts    # renderDiagnostics (§5.6)
├── classify.ts       # classify, classifyOutcome (§5.4)
├── failure.ts        # AuthProviderFailure, readFailure (§6)
├── guard.ts          # guard, relayOutcome (§7, §8.1)
├── exhaustive.ts     # matchKind, unreachableKind (§9)
├── sharedAttempt.ts  # the waiter rules of a shared attempt (§6b)
├── __tests__/        # Jest; built-package tests require dist/ by path
│                     #   widening.test.ts — §11.1 "allowlists cannot be widened"
│                     #   kindsTable.test.ts — README table equals the generated one
└── __typechecks__/   # compiled by test:check only, never built or run
scripts/
└── generate-kinds-table.mjs  # the README kinds table from dist/ (§11.4); not published
tools/
├── check-provider-shape.mjs  # the shape check (§8.2), published; other repos copy it byte for byte
├── assertion-sites.json      # rule 4's sites: mint and the three integer makers
├── diagnostic-sites.json     # rule 6's sites: none
└── __fixtures__/             # one file per rule breaking it, the obeying ones; shapeCheck.test.ts
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
