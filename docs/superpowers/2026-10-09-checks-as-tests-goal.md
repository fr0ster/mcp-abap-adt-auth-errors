# The shape check and the generated tables as tests — goal

The spec and the plan answer this file. If either needs to depart from
anything under *Holds throughout*, this file changes first.

## Goal

The auth chain's own checks are tests. Today the shape check is a script:
`tools/check-provider-shape.mjs`, published by auth-errors and copied
byte for byte into auth-providers, connection and auth-broker. The README
tables are kept current by hand-run generator scripts. Instead:

- auth-errors ships the shape check and the table rendering as a module;
- each repository runs them from Jest, under its own `npm test` and CI.

**Success:**
- **One implementation, no copies.**
  - The shape check's rules live once, in auth-errors.
  - auth-providers, connection and auth-broker reach them through their
    dependency on a published auth-errors.
  - No repository keeps a copy, and no test compares copies.
- **A repository's checks run as its tests.**
  - Each repository has a Jest test that runs the shape check with the rules
    and options it uses today (rules, base, sites, roots).
  - That test fails with every finding listed: file, line, column, rule and
    what was found.
  - `npm test` runs it, and so does CI.
  - No `lint:check`, `check` or `check:shape` script calls a checking script
    of its own any more.
- **Generated tables are checked, and regenerated without a hand-run script.**
  These are the tables a README carries: auth-errors' kinds table and
  auth-providers' refusal tables.
  - A test fails when the committed README differs from what the module
    renders.
  - The same module produces the table a person writes back.
- **Nothing gets weaker.**
  - Every rule decides exactly what it decides today, on the same code.
  - Every fixture is still refused by its own rule alone.
  - Every load-bearing break of today's tests still turns them red.
- **Nothing cites a deleted document.** Comments, messages and docs of the
  module name no spec section or decision of a working document.

## Why

- **Copies drift.** A byte-identical copy in three repositories means a fix
  in auth-errors lands everywhere only by hand, in lockstep, guarded by
  comparison tests that exist only because the copies do.
- **The copies cite a deleted spec.** The script and its copies cite sections
  of a spec that was deleted after its release, and nothing points at what
  they mean.
- **Only tests stay.** The repositories keep Jest suites and the tooling those
  suites run. Hand-run scripts are temporary.

## Holds throughout

1. **Registry only.** Every repository uses the module through a published
   auth-errors range, never a link or a copy; a consumer waits until it is
   published.
2. **Nothing extra at run time.** Anyone who imports auth-errors for its
   errors loads nothing of the shape check or the tables: not TypeScript, not
   the compiler API, not a file read. What the checks need is reached only by
   whoever asks for it.
3. **The rules do not change here.** This moves where the rules run, not what
   they decide. A defect found in a rule is recorded and fixed in its own
   change, not folded into this one.
4. **No guessing.** A repository states every option the check needs: rules,
   base, roots, sites. The module assumes no repository layout of its own.
5. **No regex over the checked source.** The module keeps deciding through
   the TypeScript compiler API and plain code.

## Out of scope

- New rules, or a change to what an existing rule decides.
- Other hand-run scripts in the repositories (connection's `check-docs`,
  `check-pack`, `release-notes`, `version-stats`; the broker's
  `check:packed` / `check:publish` tooling). The spec lists which are tooling
  a test runs and which are temporary, and leaves them for their own change.
- Releases of auth-providers, connection or auth-broker for this alone: their
  part is development-only.

## Open — for the spec

1. **Entry point and TypeScript.** How the module is reached: for example a
   subpath export such as `@mcp-abap-adt/auth-errors/checks`. How the compiler
   is obtained: a peer dependency, or the consumer's own `typescript`, and
   the version range.
2. **What the module returns.** The shape of a finding, how a usage error (no
   base, a program that does not type-check) is reported, and how the Jest
   test prints them.
3. **Writing a table back.** A test run in a write mode, or a small entry the
   test also uses, and what that entry may be.
4. **Release and order.** auth-errors' version for the module (a minor), then
   one development-only PR in each of auth-providers, connection and
   auth-broker that removes the copy and its comparison test and adds the
   test.
5. **Where the fixtures live.** Today's fixtures stay in auth-errors as its
   own tests, or the module ships the ones a consumer needs.
