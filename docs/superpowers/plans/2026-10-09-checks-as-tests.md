# The shape check and the generated tables as tests — plan

> **For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development**

**Goal.** The shape check and the README-table rendering become a module of
`@mcp-abap-adt/auth-errors` 2.2.0 that every repository of the chain runs from
its own Jest suite, with no copy left anywhere.

**Architecture.** auth-errors ports `tools/check-provider-shape.mjs` to
TypeScript under `src/shapeCheck/` (reached as `@mcp-abap-adt/auth-errors/shape-check`,
compiler given by the caller) and adds `src/tables.ts` (reached as
`@mcp-abap-adt/auth-errors/tables`); the published command becomes a thin
wrapper over the module. auth-providers, connection and auth-broker, once 2.2.0
is on the registry, replace their byte-identical copies with a Jest test over
the module, each proven equivalent to 2.1.1 by a transitional commit, and keep
the check in every publishing gate through a `test:shape` script.

**Spec.** [`../specs/2026-10-09-checks-as-tests-design.md`](../specs/2026-10-09-checks-as-tests-design.md)
(anchored by [`../2026-10-09-checks-as-tests-goal.md`](../2026-10-09-checks-as-tests-goal.md)).
Section and decision numbers below (§n, Dn) are the spec's; they appear in
this plan only — never in code, comments, messages or published docs (D8).

## Global Constraints

- Release: `@mcp-abap-adt/auth-errors` **2.2.0**, a minor; consumers depend on `^2.2.0`.
- Entries: `@mcp-abap-adt/auth-errors/shape-check` → `dist/shapeCheck/index.js`; `@mcp-abap-adt/auth-errors/tables` → `dist/tables.js`; each with `types`, `require`, `default`, plus `typesVersions` for `shape-check` and `tables`.
- The command stays at `tools/check-provider-shape.mjs`, in `files` and `exports`, with today's arguments, usage line, output lines and exit statuses 0 / 1 / 2.
- TypeScript: the caller's own module, passed as the `typescript` option; supported and documented `^5.9.0`, not gated; auth-errors declares no `dependencies`, `peerDependencies` or `peerDependenciesMeta` entry for it.
- The held 2.1.1 script: `tools/previous/check-provider-shape.mjs`, sha256 `681d8cbdc6177d2436955e172d9aded58ea67e8b9a604d1fbaf1f81c70715603`, outside `files`.
- Write-back: `WRITE_README_TABLES=1`; refused (throws) when `CI` is set; any other value of `WRITE_README_TABLES` throws.
- Scripts: `test:shape` in every repository; `docs:kinds` (auth-errors) and `docs:tables` (auth-providers) become runs of their README test.
- Registry only: every dependency range resolves on registry.npmjs.org; no `file:`, `link:`, `workspace:` or `npm link`; a consumer task starts only after `npm view @mcp-abap-adt/auth-errors@2.2.0 version` answers `2.2.0`; after every install, no `"link": true` in a lockfile other than the broker's own workspace siblings.
- No regex over the checked source: decisions stay on the compiler API and plain code; the port adds no regular expression.
- The six existing regexes stay as they are (test-path filter, base extension, rule 8's `Basic` value, its secret names, its encoding argument, the `@types/node` crypto path).
- Nothing at run time from the main entry: `src/index.ts` and everything it reaches import nothing of `src/shapeCheck`, `src/tables.ts`, `typescript` or `fs`.
- The rules do not change: a defect found while porting is recorded in the PR description and left as the script decides.
- Never `npx jest` where `npm test` supplies flags (auth-errors, auth-providers, the broker packages); run one file with `npm test -- <path>`.
- Main checkouts are shared: all work in `.worktrees/` of each repository; never switch a main checkout's branch.
- auth-providers' full `npm test` can reach live systems: run its new tests by path; run the full suite in the worktree only after checking no live configuration is present there, or after asking the user.

## Review Focus

Inputs and failure modes the spec implies but its §13 table does not exercise;
each gets a test in the owning task.

| # | Implied by | Input / failure mode | Test, owning task |
|---|---|---|---|
| RF1 | D5 "duplicates count once" | `rules: [4, 4, 6]` and `rules: [6, 4]` give the same report as `[4, 6]` | API usage suite, Task 1 |
| RF2 | D5 "inside a stated `sites` directory a missing list is still an empty one" | a stated `sites` directory holding only `assertion-sites.json` checks (no usage error), while a stated directory that does not exist is a usage error | API usage suite, Task 1 |
| RF3 | D5 / §5 "`project` / `sites` passed as `null` when the file / directory does not exist" | the command run with `--root` at a tree with no `tsconfig.json` and no `tools/`, and with `--project` naming a missing file, reports what the API reports with `project: null`, `sites: null` | packed command test, Task 3 |
| RF4 | D14 "from a copy in another repository's `tools/`" | the installed command copied into the temporary consumer's own `tools/` and run from there resolves the installed module and gives the same output as the installed one | packed command test, Task 3 |
| RF5 | D13 "writes the expected text when it differs" / D10 `withRegions` touches only bodies | write mode on an already current README writes nothing (bytes and mtime unchanged); write mode on a stale one changes only region bodies (text outside every region byte-identical); `rowsFor` ignores a row for a value outside the allowlist | tables unit suite, Task 5 (write path itself: Task 6) |

## Decisions the spec left to this plan (§15) and rulings

- **Broker fixtures: one set per package**, at `packages/auth-broker/tools/__fixtures__/` and `packages/auth-broker-cli/tools/__fixtures__/` (`rule4.ts`, `rule5.ts`, `rule6.ts` each). *Why:* each test's `root` is its package, so a fixture inside the root yields findings with in-root paths (`tools/__fixtures__/rule4.ts`) exactly like connection's and auth-providers' layout; the brands rules 4/5 need resolve from that package's own dependencies; a shared set outside both roots would make every finding a `../` path and depend on how the program admits a file outside its root, which no repository exercises today. The cost is three small duplicated files. Both packages' `tsconfig.json` `include` names `src/**/*` (and `tests/stand/*.ts`), so `tools/` is outside `test:check` and the build; Biome, whose `includes` is `**`, gets `!!packages/*/tools/__fixtures__`.
- **The README test names the regenerating command in its title** — `the README tables equal the rendered ones (regenerate: npm run docs:tables)`, and `… (regenerate: npm run docs:kinds)` in auth-errors. *Why:* Jest prints the title with every failure, and the assertion stays a plain `toBe`, so Jest's own diff is shown; a thrown message would replace that diff.
- **Ruling — "first code commit" (D17) against task granularity.** In auth-errors the transitional equivalence test grows across Tasks 1–3 (usage cases, then findings, then the thin command); the commit that ends Task 3 is "the transitional commit": pushed, CI green on it, the run recorded in the PR. Task 4 is the next commit and deletes it with `tools/previous/`. In each consumer the transitional commit is one commit, as the spec says.
- **Ruling — "moves the script to `tools/previous/`" (§7).** Task 1 copies it there and leaves the original in place until Task 3 overwrites it with the thin command. Between those commits the tree holds two identical 2.1.1 files, neither a copy that outlives the PR; in exchange every existing test and gate stays green on every commit, and the repository is never without a working command. After Task 3 the state is exactly the spec's move.
- **Ruling — `tableWriteMode`.** "`CI` is set" means `env.CI !== undefined` (any value, `'false'` and `''` included); "any other value" of `WRITE_README_TABLES` includes `''`. Strict both ways: no silent write in CI, no silent no-op on a typo.
- **Ruling — `test:shape` form.** auth-errors and auth-providers: `npm test -- src/__tests__/shapeCheck.test.ts` (their `test` supplies `--experimental-vm-modules`). connection: `jest src/__tests__/shapeCheck.test.ts` (its `test` is `check:docs && jest`; `check:docs` keeps its own place in `prepublishOnly`). Broker packages: `cross-env NODE_OPTIONS=--experimental-vm-modules jest <path>` as their `test` does; broker root `npm run test:shape --workspaces`.
- **Ruling — D15 "linked in".** The packed consumer is a temporary directory of the test (as `exportsMap.test.ts` builds today), into which the repository's installed `typescript` and `@mcp-abap-adt/interfaces-auth` are symlinked. This is test scaffolding inside a temp dir, not a dependency of any package; the registry-only rule is about package manifests and lockfiles and is untouched.
- **Ruling — where `loadBuiltModule` comes from.** It lives in `src/__tests__/builtPackage.ts`; the new `src/__tests__/helpers/kindsTable.ts` imports it from there (no helper is moved).
- **Ruling — defects found while porting** go into a "Found defects" section of the auth-errors PR description (rule, script line, input, what the script does); they are not fixed here and not listed in the CHANGELOG.

## Tasks

### Task 1 — auth-errors: hold the 2.1.1 script; port the API and program loading

Repository: auth-errors, worktree `.worktrees/checks-as-tests`, PR #7.

**Implements:** D2 (structure, strict options), D3, D5, D6, D7, §2.1 (API), §1 (the `fail` paths, the type-error sentence, the project fallback, the site lists), D17 (held script and its hash; usage/type-error rows of the matrix), D8 for the new files.

**Files:**
- copy `tools/check-provider-shape.mjs` → `tools/previous/check-provider-shape.mjs` (same bytes). The original stays in place, unchanged, until Task 3 replaces it with the thin command — so the pack test, `lint:check`'s call of the command and today's `shapeCheck.test.ts` stay green through Tasks 1–2; the net effect at Task 3 is the spec's move (see the ruling below)
- create `src/shapeCheck/index.ts` (API, `formatFinding`, `reportLines`), `src/shapeCheck/options.ts` (validation of options), `src/shapeCheck/program.ts` (project/fallback, file selection, sites, base, brands, interfaces-auth, per-call package cache), `src/shapeCheck/types.ts` (`ShapeRule`, `ShapeCheckOptions`, `ShapeFinding`, `ShapeCheckReport`)
- create `src/__tests__/shapeCheckApi.test.ts`
- create `src/__tests__/shapeCheckEquivalence.test.ts` (transitional; runs `tools/previous/…`)

**Interfaces:**
- produces `checkProviderShape(options: ShapeCheckOptions): ShapeCheckReport`, `formatFinding(finding: ShapeFinding): string`, `reportLines(report: ShapeCheckReport): readonly string[]`, the four types — exact names of §2.1
- produces (internal) a `RuleContext` the rules of Task 2 consume: the program, the checker, the selected source files, the brands, the trusted sites, the resolved base, the per-call package cache, and a `report(node, rule, what)` collector
- consumes `typescript` only through `options.typescript`; `import type` only

**Steps:**
- [ ] Copy the script; add to the equivalence test a first case asserting the held file's sha256 is `681d8cbd…70715603`.
- [ ] Write `shapeCheckApi.test.ts`, failing: each `fail` path of the script, by its message, through the API (no rules, unknown rule, malformed base, base not resolving, missing file, nothing to check, rules 4/5 without the brands, interfaces-auth missing, a file not in the program, a bad site list) → `usage-error` with today's text; a program that does not type-check → `type-errors` with diagnostics relative to `root`; API-only refusals (relative `root`/`project`/`sites`/`files`, empty `rules`, no `typescript`, a stated missing `project`, a stated missing `sites`) → `usage-error` naming the option; RF1 (duplicates and order); RF2 (a stated `sites` directory with one list only checks; a stated missing one is refused); `project: null` with `files` given checks those files under the strict defaults; no state between calls (two calls, the root's `package.json` name changed between them, the second decides on the new name); `reportLines` for each status (`cannot check: <message>`; `cannot check: the program does not type-check` then the diagnostic lines; one `formatFinding` line per finding); no stream written, no environment variable read (spy on `process.stdout.write`, `process.stderr.write`, a Proxy over `process.env` reporting reads).
- [ ] Write the equivalence test's usage/type-error matrix (every usage and type-error case of today's `shapeCheck.test.ts`): the held script as a child (`node tools/previous/check-provider-shape.mjs …`) against the API with the same options resolved; exit 2 ↔ `usage-error` whose `message + '\n' + USAGE + '\n'` is the script's stderr, or `type-errors` whose diagnostics follow the script's sentence; stdout empty on both sides.
- [ ] Run both files: red (no module).
- [ ] Implement the port of `parseArguments`-independent parts: options validation, program loading with the fallback, file selection (the rules' own exclusions, the existing test-path regex unchanged), site lists, base resolution, brands, interfaces-auth lookup, the type-error formatting; `fail` becomes a returned `usage-error`; `packageCache` per call; no rule yet (every `checked` has no findings). Strict-option guards keep every outcome for a present value; each place where the script would have thrown is noted for the PR's "Found defects".
- [ ] Run green: `npm test -- src/__tests__/shapeCheckApi.test.ts src/__tests__/shapeCheckEquivalence.test.ts`.
- [ ] [break] return `checked` with no findings for a missing base → the base usage case red; restore.
- [ ] [break] move the package cache back to module level → the no-state case red; restore.
- [ ] [break] drop the `cannot check:` line for a usage error in `reportLines` → its case red; restore.
- [ ] [break] collapse duplicate handling (count `[4,4,6]` as given) — if it changes nothing observable, RF1 is weak: strengthen it with a rule whose findings would double, then confirm red; restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test` (today's tests untouched and green, the original command still in place); no `§`, `Decision D`, `C1`… in `src/shapeCheck/` (`grep`).
- [ ] Self-check of this task's text: every refusal listed in the test is one of §1's `fail` sites or D6's API-only list.
- [ ] Commit: `feat(shape-check): the API and program loading as a module; hold the 2.1.1 script`.

### Task 2 — auth-errors: port the rules; the fixture table in-process; the full equivalence matrix

**Implements:** D2 (rules in order and structure), D16 (fixtures stay), §7 (auth-errors matrix, findings rows), §13 rows "fixture table" and the own-tree case, D8 (`shapeCheck.test.ts` drops its citations), the six regexes kept, the rule-8 comment corrected to three directories.

**Files:**
- create `src/shapeCheck/rules/rule1.ts` … `rule8.ts` (or one file per group as the script groups them — same order as the script), `src/shapeCheck/constants.ts` (`OVERLOAD_FILES`, `BASIC_SCOPE`, `BASIC_SITES`, crypto modules, `MAX_DEPTH`)
- edit `src/shapeCheck/index.ts` (run the selected rules, sort findings by file, line, column, rule)
- rewrite `src/__tests__/shapeCheck.test.ts` (in-process through the module; every case of today's file kept)
- extend `src/__tests__/shapeCheckEquivalence.test.ts`

**Interfaces:**
- consumes Task 1's `RuleContext` and `report`
- produces `ShapeFinding[]` sorted as the script sorts; nothing new exported

**Steps:**
- [ ] Rewrite `shapeCheck.test.ts`, failing: the fixture table (every breaking fixture under `tools/__fixtures__/src` reported for its rule only, with its count; every obeying file clean), the base by declaration, the impostor pair, the rewriting base, `ParameterBase`, the four trusted sites with empty lists, the base's own file scanned, rule 5 only, given files, the three `bases/`, `prose.ts` with `RewritingBase`, `obeys.ts` with either base; the own tree with `{ rules: [4, 6], root, project: <root>/tsconfig.json, sites: <root>/tools }` → `reportLines` equals `[]`. No citation in the file.
- [ ] Extend the equivalence matrix with every findings entry of §7's auth-errors row: own tree `4,6`; own tree `4` with an empty sites dir; own tree 1–8 with the fixtures' base; the fixtures root with every rule, fixture sites and base; every narrowed run of today's test; each fixture file alone with every rule. Each: the script's stdout lines equal `reportLines`, in order; exit 0 ↔ none, 1 ↔ some. The comparison runs on today's file set: entries over the own tree pass, to both sides, `files` listing the selected `src/` files of the base commit `3cbf6a4` (from `git ls-tree`, filtered by the rules' own exclusions), so the new module's files are not part of the comparison; the own-tree test of `shapeCheck.test.ts` covers them.
- [ ] Run red.
- [ ] Port each rule in the script's order, changing syntax and adding types only; the six regexes copied as they are; the rule-8 comment names `src/auth/`, `src/providers/`, `src/clientAuthentication/`; comments say what a rule decides and why, citing nothing.
- [ ] Run green: `npm test -- src/__tests__/shapeCheck.test.ts src/__tests__/shapeCheckEquivalence.test.ts src/__tests__/shapeCheckApi.test.ts`.
- [ ] [break] for each rule 1–8, delete the `report` call of one of its checks → that rule's fixture row red (eight separate breaks, each restored before the next).
- [ ] [break] sort findings by file and line only → an equivalence entry with two findings on one line red (if none exists, add a fixture-alone entry that has one); restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, the three test files by path; `grep` that `src/shapeCheck` has no `import … from 'typescript'` other than `import type`, and no regex literal or `RegExp` beyond the six (count them).
- [ ] Record in the PR description draft: each found defect (rule, script line, input, outcome kept).
- [ ] Commit: `feat(shape-check): the eight rules as a module, the fixtures run in-process`.

### Task 3 — auth-errors: the thin command, the `./shape-check` export, the packed command test

**Implements:** §5, D1 (for `./shape-check`), D14, D15, D17 (the thin-command column), RF3, RF4; README note deferred to Task 9.

**Files:**
- create `tools/check-provider-shape.mjs` (thin command)
- edit `package.json`: `exports["./shape-check"]`, `typesVersions` (`shape-check` → `dist/shapeCheck/index.d.ts`), `lint` / `lint:check` name `tools/check-provider-shape.mjs` again for Biome; `lint:check` no longer calls any command (the own-tree check is the Jest test of Task 2)
- create `src/__tests__/shapeCheckCommand.test.ts` (packed command, D15) — sharing the packed-consumer setup with `exportsMap.test.ts` through a new helper `src/__tests__/packedConsumer.ts` (extracted from `exportsMap.test.ts`, which then uses it)
- edit `src/__tests__/exportsMap.test.ts` (`./shape-check` by name; deep paths refused; `node` and `node16` consumers type-check an import of `./shape-check`)
- extend `src/__tests__/shapeCheckEquivalence.test.ts`

**Interfaces:**
- consumes `checkProviderShape`, `formatFinding` by name from `@mcp-abap-adt/auth-errors/shape-check` (default import of the CommonJS entry), `typescript` resolved from the command's location
- produces `packedConsumer({ withTypescript: boolean }): { dir, run(script), runCommand(args, cwd) }` (test helper), consumed by Tasks 5 and 7

**Steps:**
- [ ] Extract the packed-consumer setup into `packedConsumer.ts`; `exportsMap.test.ts` still green on it.
- [ ] Write `shapeCheckCommand.test.ts`, failing: the installed command on the fixtures with every rule (exit 1, stdout equals `reportLines` of the API on the same options, stderr empty); auth-errors' own tree `--rules 4,6` (exit 0, nothing printed); each usage case of today's test (exit 2, stdout empty, stderr exactly message + usage line); a program that does not type-check (exit 2, stderr starts with `the shape check needs a program that type-checks:`); RF3 (a temporary tree without `tsconfig.json` and `tools/`, and `--project` naming a missing file, against the API with `project: null`, `sites: null`); RF4 (the installed command copied into the consumer's `tools/`, run from there, same status/stdout/stderr as the installed one).
- [ ] Extend `exportsMap.test.ts`, failing: `./shape-check` resolves by name; `dist/shapeCheck/index.js` by deep path is refused; `node` and `node16` consumers type-check `import { checkProviderShape } from '@mcp-abap-adt/auth-errors/shape-check'`.
- [ ] Extend the equivalence test, failing: for every matrix entry, the in-repository thin command (run after `npm run build`, by self-reference) against the held script — status, stdout and stderr byte for byte.
- [ ] Run red.
- [ ] Implement the thin command: shebang; header (what it is, arguments, output, statuses; the rules and their limits are the module's); today's `parseArguments` and usage line verbatim; relative paths against the working directory; missing project/sites → `null`; output mapping of §5. Add the export and `typesVersions`.
- [ ] Run green: `npm run build` then the four test files by path.
- [ ] [break] map `usage-error` to exit 1 → red; restore. [break] drop the usage line → red; restore. [break] print findings unsorted (reverse) → red; restore.
- [ ] [break] remove the `typesVersions` entry → the `node` consumer case red; restore.
- [ ] [break] make the command import the module by relative path to `../dist/shapeCheck/index.js` → RF4 red; restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test` (whole suite; auth-errors has no live tests), `npm pack --dry-run` shows `tools/` holding the command alone (the existing pack assertion green).
- [ ] Commit: `feat(shape-check): the published command over the module`. This is the transitional commit: push the branch, wait for CI green on it, record the equivalence run (matrix size, all equal) in the PR description.

### Task 4 — auth-errors: remove the transitional test and the held script

**Implements:** D17 (removal), goal "no copy, no comparison test".

**Files:** delete `src/__tests__/shapeCheckEquivalence.test.ts`, `tools/previous/` (directory).

**Interfaces:** none produced; confirms nothing else consumes `tools/previous` (`grep`).

**Steps:**
- [ ] Precondition: CI green on Task 3's commit (checked with `gh pr checks 7` or `gh run list --commit <sha>`).
- [ ] Delete both; `grep -r "tools/previous\|shapeCheckEquivalence"` over the tree answers nothing outside `docs/superpowers`.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `test(shape-check): drop the 2.1.1 script and the transitional equivalence test`.

### Task 5 — auth-errors: the tables module and the `./tables` export

**Implements:** D1 (for `./tables`), D9, D10, RF5 (pure parts), §13 rows "tables module" and the `./tables` exports cases.

**Files:**
- create `src/tables.ts`
- create `src/__tests__/tables.test.ts`
- edit `package.json` (`exports["./tables"]`, `typesVersions` `tables` → `dist/tables.d.ts`)
- edit `src/__tests__/exportsMap.test.ts` (`./tables` by name; `dist/tables.js` deep path refused; `node`/`node16` consumers type-check an import of `./tables`)

**Interfaces:**
- produces `render` (re-export from `./words`), `contract` (interfaces-auth as auth-errors resolves it — the same instance `allowlists.ts` uses), `rowsFor<V extends string, R>(values, rows, table)`, `markdownCell(text)`, `GeneratedRegion { open, close, body }`, `withRegions(text, regions)`, `tableWriteMode(env)` — exact names and signatures of D10
- consumed by Task 6 (from `dist/tables.js`), Task 13 (by name), Task 7 (must not be reachable from the main entry)

**Steps:**
- [ ] Write `tables.test.ts`, failing: `rowsFor` answers rows in allowlist order, throws an `Error` naming table and value for a value without a row, ignores a row for a value outside the allowlist (RF5); `withRegions` replaces only the body between the first `open` and the first `close` after it with `\n<body>\n`, several regions, text outside regions byte-identical (RF5), throws naming the marker when `open` or `close` is missing or `close` precedes `open`; `markdownCell` escapes `|`; `tableWriteMode`: unset → false, `'1'` → true, `'1'` with `CI` (`'true'`, `'false'`, `''`) → throws, `''` / `'0'` / `'true'` → throws, reads only the given object (a frozen plain object; a Proxy recording reads sees only `WRITE_README_TABLES` and `CI`); `render` is the main entry's function object (`===` with `require('../index').render`); `contract` is the interfaces-auth module object `allowlists.ts` imports (`===`).
- [ ] Extend `exportsMap.test.ts` for `./tables`, failing.
- [ ] Run red.
- [ ] Implement `src/tables.ts` (no `fs`, no `typescript`, no environment read); add export and `typesVersions`.
- [ ] Run green: `npm run build`, then `npm test -- src/__tests__/tables.test.ts src/__tests__/exportsMap.test.ts`.
- [ ] [break] `rowsFor` returns the rows that exist → red; restore. [break] give `tables.ts` its own copy of `render` → the identity case red; restore. [break] remove `./tables` from `exports` → exports case red; restore. [break] `tableWriteMode` ignores `CI` → red; restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `feat(tables): render, contract and the region helpers as a subpath`.

### Task 6 — auth-errors: the kinds table as a test; `scripts/` deleted

**Implements:** D11, D13 (auth-errors), RF5 (write path), §13 row "kinds table", D8 (`kindsTable.test.ts` drops citations), §11 (`lint`/`lint:check` stop naming `scripts`; `docs:kinds`), the README's kinds-table paragraph and CLAUDE.md "Development" lines that name the script (folded here).

**Files:**
- create `src/__tests__/helpers/kindsTable.ts` (samples, `statusFor`, `code`, the three throws; builders from `dist/index.js`, `contract` from `dist/tables.js`, `ASSERTION_RULE_CHECK` from `dist/words.js` through `loadBuiltModule` of `src/__tests__/builtPackage.ts`)
- rewrite `src/__tests__/kindsTable.test.ts` (in-process; compare; write mode)
- delete `scripts/generate-kinds-table.mjs` and `scripts/`
- edit `package.json` (`lint`, `lint:check` without `scripts`; `docs:kinds` = `npm run build && WRITE_README_TABLES=1 npm test -- src/__tests__/kindsTable.test.ts`)
- edit `README.md` (kinds-table paragraph names the test and `docs:kinds`; the README's generated region itself byte-identical), `CLAUDE.md` (Development / Build Commands lines naming the script)

**Interfaces:**
- consumes `withRegions`, `tableWriteMode`, `markdownCell`, `contract` (Task 5, built), `loadBuiltModule`
- produces `kindsTableRegion(): GeneratedRegion` (helper), consumed only by `kindsTable.test.ts`

**Steps:**
- [ ] Before changing anything, record the README bytes (sha256) and today's generator output.
- [ ] Write the helper and the test, failing: the README equals `withRegions(readme, [kindsTableRegion()])`; 17 sections; the three throws (no samples, no builder, a builder answering another kind — each by injecting a sample map into the helper); write mode (in a temporary copy of the README, passed as a path option of the test's local write function — the real README is never touched by a test case): a current file is not rewritten (bytes and mtime unchanged), a stale one is rewritten and then equal; `CI` set with write mode throws before any write. Title: `the README kinds table equals the rendered one (regenerate: npm run docs:kinds)`.
- [ ] Run red; implement; run green: `npm run build`, `npm test -- src/__tests__/kindsTable.test.ts`. The README's sha256 is unchanged.
- [ ] [break] change one word in `words.ts` → red (the title names `docs:kinds`); `npm run docs:kinds` rewrites the README; revert the word and the README.
- [ ] [break] make the write branch write unconditionally → the mtime case red; restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`; `CI=1 WRITE_README_TABLES=1 npm test -- src/__tests__/kindsTable.test.ts` fails with the refusal.
- [ ] Commit: `test(kinds-table): the README table is checked and written by its test`.

### Task 7 — auth-errors: invariant 2 proven

**Implements:** §3 (the three proofs and the subpaths loading without `typescript`), D3.

**Files:** create `src/__tests__/mainEntryLoadsNothing.test.ts`.

**Interfaces:** consumes `packedConsumer({ withTypescript: false })` (Task 3); the test's own source-graph walk uses `ts.preProcessFile` (test code).

**Steps:**
- [ ] Write the test, failing until the walk and the consumer exist: (1) the transitive imports of `src/index.ts` (relative imports followed, `import type` included) reach none of `./shapeCheck`, `./tables`, `typescript`, `fs`, `node:fs`, `node:fs/promises`; (2) in a packed consumer with interfaces-auth and no `typescript`, a child requires the main entry, uses `authError`, `classify`, `render`, and prints `Object.keys(require.cache)`: no path under `dist/shapeCheck/`, `dist/tables`, or a `typescript` package; (3) the same child with a preload recording `fs.readFileSync`, `openSync`, `readdirSync`, `statSync`, `existsSync`: every recorded path is a module file in `require.cache`, nothing recorded after the entry has loaded; (4) in that consumer `require('@mcp-abap-adt/auth-errors/shape-check')` and `…/tables` load.
- [ ] Run; it is expected green on the tree as built (the property already holds) — so prove each part load-bearing:
- [ ] [break] `export * from './shapeCheck'` in `src/index.ts` → (1) and (2) red; restore.
- [ ] [break] `import './tables'` in `words.ts` → (1) and (2) red; restore.
- [ ] [break] a `readFileSync` of `package.json` at load in `allowlists.ts` → (3) red; restore.
- [ ] [break] a top-level `require('typescript')` in `src/shapeCheck/index.ts` → (4) red; restore.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `test(entry): the main entry loads nothing of the check or the tables`.

### Task 8 — auth-errors: `test:shape` and the publishing gate

**Implements:** D18, §6a (auth-errors row), §6 (`lint:check` is Biome only — already true since Task 3; asserted here), the gate assertion, the planted-construct proof; CLAUDE.md Build Commands (`lint:check` is Biome only; `test:shape`) folded here.

**Files:** edit `package.json` (`test:shape` = `npm test -- src/__tests__/shapeCheck.test.ts`; `prepublishOnly` = `npm run build && npm run test:shape`), `src/__tests__/shapeCheck.test.ts` (gate assertion), `CLAUDE.md` (Build Commands).

**Interfaces:** produces the script name `test:shape`, consumed by the gate assertion and by Task 12's publish.

**Steps:**
- [ ] Add to `shapeCheck.test.ts`, failing: `package.json` `prepublishOnly` names `npm run test:shape`; `test:shape` runs `src/__tests__/shapeCheck.test.ts`; `lint:check` names no `.mjs` / `tools/` command.
- [ ] Run red; edit `package.json`; run green.
- [ ] Planted-construct proof: add `export const forged = {} as IAuthProviderError;` to a file in `src/`; `npm run prepublishOnly` exits non-zero listing the finding; revert; `npm run prepublishOnly` passes. Record both runs (command, exit status, the finding line) in the PR description.
- [ ] [break] remove `test:shape` from `prepublishOnly` → the gate assertion red, and with the plant in place `npm run prepublishOnly` passes; restore both.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `build: the shape check is a publishing gate through test:shape`.

### Task 9 — auth-errors: documentation and the drift

**Implements:** §9 (auth-errors README and CLAUDE.md), D4 (the `^5.9.0` statement), D8 (no citation anywhere in what ships), the drift the spec lists: README "Install" names five paths and `^7.4.0` instead of the stale `^6.0.0`; the rule-8 scope as three directories wherever docs state it; "Copy it byte for byte" removed; limits moved from "the script's header" to the module's description; the migration note.

**Files:** `README.md`, `CLAUDE.md` (principles 9 and 10, Layout: `src/shapeCheck/`, `src/tables.ts`, no `scripts/`, `tools/` = the command, the site lists, the fixtures), create `src/__tests__/readme.test.ts`.

**Interfaces:** documents exactly the names produced by Tasks 1, 3, 5, 6, 8.

**Steps:**
- [ ] Write a failing check first where one is cheap: `readme.test.ts` asserting the README's "Install" lists the five paths (`.`, `./package.json`, `./tools/check-provider-shape.mjs`, `./shape-check`, `./tables`) and that the interfaces-auth range it states equals `package.json`'s. Run red.
- [ ] Rewrite "The shape check": run it from Jest through `@mcp-abap-adt/auth-errors/shape-check` with the repository's own `typescript`; the options (every one stated, absolute; `null` meanings); the report and `reportLines`; the command as an alternative with its statuses; tested with TypeScript `^5.9.0`; the rules' limits; the migration note of §9.
- [ ] Update CLAUDE.md principles 9 and 10 and Layout.
- [ ] Run green.
- [ ] [break] change the README's interfaces-auth range back to `^6.0.0` → red; restore.
- [ ] Sweep: `grep -rn "§\|Decision D[0-9]\|spec §\|byte for byte\|generate-kinds-table\|scripts/" README.md CLAUDE.md src tools/check-provider-shape.mjs` answers nothing that refers to a document or a deleted path.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `docs: the shape check and the tables as modules; install paths and range`.

### Task 10 — auth-errors: CHANGELOG 2.2.0 and the version

**Implements:** §9 (CHANGELOG with the migration note), §12 (why a minor).

**Files:** `CHANGELOG.md`, `package.json` / `package-lock.json` (`version` `2.2.0`).

**Interfaces:** produces version `2.2.0`, consumed by Task 12's tag check (`release.yml` compares tag and version).

**Steps:**
- [ ] Add the 2.2.0 entry: the two subpaths, the module, `typesVersions`, the thin command (same arguments, lines, statuses), `scripts/` gone, `docs:kinds` as a test run, `test:shape` in `prepublishOnly`, TypeScript `^5.9.0` supported, the migration note (re-copy once if you keep a copy; recommended: no copy, a Jest test).
- [ ] `npm version 2.2.0 --no-git-tag-version`; the lockfile's own version follows; the lockfile holds no `"link": true` and every package resolves from registry.npmjs.org (`grep`).
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`, `npm pack --dry-run` (contents: `dist`, the command, the docs; no `tools/previous`, no fixtures).
- [ ] Commit: `chore(release): 2.2.0`.

### Task 11 — auth-errors: delete `docs/superpowers`; the PR description carries what it owes

**Implements:** §12 step 1 (plan and spec deleted before the tag), the user's rule on working documents.

**Files:** delete `docs/superpowers/` (goal, spec, this plan); edit the PR #7 description (`gh pr edit 7 --body-file …` from the scratchpad).

**Interfaces:** the PR description is consumed by Tasks 13–16 (their order and steps).

**Steps:**
- [ ] Write the PR description: summary; found defects (Task 2); the equivalence run (Task 3); the planted-construct runs (Task 8); each §13 break and its result; what is owed after the release — the three consumer PRs with their scope (Tasks 13–15), the final cross-repo check (Task 16), and the out-of-scope hand-run scripts of §10 for their own change.
- [ ] Delete `docs/superpowers/`; `grep -rn "docs/superpowers\|checks-as-tests-design\|checks-as-tests-goal"` answers nothing.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, `npm test`.
- [ ] Commit: `docs: drop the working documents; the PR carries what they owe`. Push.

### Task 12 — auth-errors: review, merge, tag; the user publishes; registry and clean install

**Implements:** §12 step 1, the registry-only rule (clean install of the release).

**Files:** none in the tree.

**Interfaces:** produces `@mcp-abap-adt/auth-errors@2.2.0` on the registry, consumed by Tasks 13–16.

**Steps:**
- [ ] Approval: a Codex review that approves, or the user's explicit word; every finding answered in the PR (fixed in this PR as new commits, rerunning the affected task's gates).
- [ ] CI green on the final commit (`gh pr checks 7`).
- [ ] Merge PR #7; tag `v2.2.0` on the merge commit; push the tag; `release.yml` green (tag matches version; build, test:check, lint:check, test).
- [ ] Ready the publish checkout: in the main auth-errors checkout, on its own branch (`master`), fast-forward to the merge; `git describe --exact-match --tags` answers `v2.2.0`; `npm ci`, `npm run build`. Tell the user it is ready; the user runs `npm publish`.
- [ ] Registry check: `npm view @mcp-abap-adt/auth-errors@2.2.0 version` answers `2.2.0`; `dist-tags.latest` is `2.2.0`; `npm view … exports` lists `./shape-check` and `./tables`.
- [ ] Clean install outside every repository (scratchpad): `npm init -y`, `npm install @mcp-abap-adt/auth-errors@2.2.0 typescript@^5.9.0`; the lockfile resolves everything from registry.npmjs.org, no `"link": true`; `require` of the main entry, `/shape-check`, `/tables` succeeds; `node node_modules/@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs` with no arguments exits 2 with the usage line. Remove the scratch directory.

### Task 13 — auth-providers: the shape check and the refusal tables as tests (development-only PR)

Repository: `/home/okyslytsia/prj/mcp-abap-adt-auth-providers`, worktree `.worktrees/checks-as-tests`, branch `chore/checks-as-tests`, one PR, no release.

**Implements:** §6 (auth-providers), §6a / D18 (auth-providers row, including `release.yml`), D12, D13, D17 (auth-providers matrix), §9 (auth-providers docs), §11, §13 (auth-providers rows), invariant 1.

**Files:**
- `package.json` / `package-lock.json` (`@mcp-abap-adt/auth-errors` `^2.2.0`; `lint:check` Biome only; `test:shape` = `npm test -- src/__tests__/shapeCheck.test.ts`; `prepublishOnly` = `npm run build && npm run test:shape`; `docs:tables` = `WRITE_README_TABLES=1 npm test -- src/__tests__/readmeRefusalTables.test.ts`)
- rewrite `src/__tests__/shapeCheck.test.ts`; create (transitional) `src/__tests__/shapeCheckEquivalence.test.ts`
- create `src/__tests__/helpers/refusalTables.ts`; rewrite `src/__tests__/readmeRefusalTables.test.ts`
- delete `tools/check-provider-shape.mjs`, `scripts/generate-refusal-tables.mjs`, `scripts/`
- `.github/workflows/release.yml` (a `test:shape` step after `build`)
- `CLAUDE.md`, `README.md`, `AGENTS.md` (wherever they name the script, the copy, the byte comparison, `docs:tables`)

**Interfaces:**
- consumes from the registry: `checkProviderShape`, `reportLines` (`/shape-check`); `render`, `contract`, `rowsFor`, `markdownCell`, `withRegions`, `tableWriteMode` (`/tables`); `httpStatus` (main entry)
- produces `SHAPE_CHECK` (`{ typescript, rules: [1..8], root, project: <root>/tsconfig.json, sites: <root>/tools, base: './src/auth/AuthProviderBase#AuthProviderBase' }`), `refusalTableRegions(): GeneratedRegion[]` (the five regions `rejected`, `refusals`, `saml`, `saml-candidates`, `configuration`)

**Steps:**
- [ ] Precondition: `npm view @mcp-abap-adt/auth-errors@2.2.0 version` answers `2.2.0`; no other PR open in this repository (`gh pr list --state open`); create the worktree from `master`.
- [ ] Bump to `^2.2.0`, `npm install`; lockfile: auth-errors 2.2.0 from registry.npmjs.org, no `"link": true`.
- [ ] Transitional commit, test first: delete the byte-comparison case; write `shapeCheckEquivalence.test.ts` over §7's auth-providers matrix (own tree as configured; own tree `6` with an empty sites dir; own tree 1–8 with an empty sites dir; `rule1.ts`…`rule7.ts`, `clean.ts` with the configuration; the rule-8 tree with `8`), comparing the repository's own `tools/check-provider-shape.mjs` (2.1.1, sha256 asserted) with `reportLines` of the module and with the installed thin command (status, stdout, stderr byte for byte); rewrite `shapeCheck.test.ts` per §6 (own tree; assertion list empty; diagnostic list names exactly the approved sites; empty sites → rule 6 reports each listed site and nothing else; each fixture refused with its count by its own rule; `rule2.ts` names `establish`; `clean.ts` passes; the rule-8 tree reports two; every fixture's rule is in `SHAPE_CHECK.rules`, rule 8 included). Run red, adjust only the test wiring, run green (by path). Gates: `npm run build`, `npm run test:check`, `npm run lint:check` (still the old one at this commit), both test files by path. Commit `test(shape-check): run the shape check through auth-errors 2.2.0; prove it equal to 2.1.1`; push; CI green on it; record the run in the PR.
- [ ] Removal commit: delete `tools/check-provider-shape.mjs` and the equivalence test; `lint:check` Biome only.
- [ ] Tables, test first: `readmeRefusalTables.test.ts` rewritten — README equals `withRegions(readme, refusalTableRegions())`, three hand-edited rows each fail, write mode per D13 in a temporary copy, title `the README tables equal the rendered ones (regenerate: npm run docs:tables)`. Run red; move the five builders and their row texts into the helper (TypeScript; `contract` replaces the `createRequire` lookup; `rowsFor` replaces `each`; branded facts through the main entry's makers); delete `scripts/`. Run green; the README's sha256 unchanged.
- [ ] Gate, test first: the shape-check test asserts `prepublishOnly` and `release.yml` name `npm run test:shape`; run red; edit `package.json` and `release.yml`; run green.
- [ ] [break] add `as IAuthProviderError` in `src/` → own-tree red; restore.
- [ ] [break] remove one rule from `SHAPE_CHECK.rules` → that rule's fixture red; restore. [break] remove `base` → usage error, red; restore. [break] remove `8` → the "every fixture's rule" case red; restore.
- [ ] [break] `sites: null` in the constant → the own tree reports 15, red; restore.
- [ ] [break] edit one row text in the helper → the README test red; `npm run docs:tables` rewrites it; revert both.
- [ ] Planted-construct proof: plant `export const forged = {} as IAuthProviderError;` in `src/`; `npm run prepublishOnly` exits non-zero with the finding; revert; it passes. [break] remove `test:shape` from `prepublishOnly` → the gate assertion red, and the plant passes the gate; restore. Record both runs in the PR.
- [ ] Docs: CLAUDE.md Build Commands (`lint:check` Biome only, `test:shape`), the Testing paragraph (no copy, no byte comparison, the rule-8 fixture tree, rule-8 scope = `src/auth/`, `src/providers/`, `src/clientAuthentication/`), the SAML and Error-classes paragraphs (`docs:tables` is the test run; no script); README and AGENTS.md wherever they name the script or the copy. `grep -rn "check-provider-shape\|generate-refusal-tables\|byte-identical\|byte for byte"` answers nothing stale.
- [ ] Gates: `npm run build`, `npm run test:check`, `npm run lint:check`, the shape-check and README tests by path, `npm run test:shape`, then the full `npm test` under the live-systems constraint; lockfile check again.
- [ ] Commit(s): `chore: the shape check runs from auth-errors; no copy`, `test(readme): the refusal tables are checked and written by their test`, `build: test:shape in prepublishOnly and release`, `docs: …`. Push; PR description lists the transitional run, the breaks, the gate runs; review (Codex approve or the user's word), CI green, merge. No tag, no release.

### Task 14 — connection: the shape check as a test (development-only PR)

Repository: `/home/okyslytsia/prj/mcp-abap-connection`, worktree `.worktrees/checks-as-tests`, branch `chore/checks-as-tests`.

**Implements:** §6 (connection), §6a / D18 (connection row), D17 (connection matrix), §9, §11, §13 (connection), invariant 1.

**Files:** `package.json` / lockfile (`^2.2.0`; `lint:check` = Biome only; `test:shape` = `jest src/__tests__/shapeCheck.test.ts`; `prepublishOnly` = `npm run build && npm run lint:check && npm run test:shape && npm run check:docs && npm run --silent check:pack`); rewrite `src/__tests__/shapeCheck.test.ts`; transitional `src/__tests__/shapeCheckEquivalence.test.ts`; delete `tools/check-provider-shape.mjs`; `CLAUDE.md` and any doc naming the copy (checked by `check:docs`).

**Interfaces:** consumes `checkProviderShape`, `reportLines` from the registry; produces `SHAPE_CHECK` (`{ typescript, rules: [4, 5, 6], root, project: <root>/tsconfig.json, sites: <root>/tools }`).

**Steps:**
- [ ] Precondition: `npm view @mcp-abap-adt/auth-errors@2.2.0 version` answers `2.2.0`; no other PR open here; worktree from `master`.
- [ ] Bump, install, lockfile check.
- [ ] Transitional commit, test first: equivalence over §7's connection matrix (own tree `4,5,6`; own tree 4–8 with an empty sites dir; each fixture with `4,5,6`) — own 2.1.1 copy (sha256 asserted) vs module vs installed thin command; rewritten `shapeCheck.test.ts` (both site lists empty; `rule4.ts`, `rule5.ts`, `rule6.ts` each by its rule alone; `clean.ts` passes; own tree passes); `R1` removed. Red, green, gates (`npm run build`, `npm run lint:check`, `npm test`), commit, push, CI green, record.
- [ ] Removal commit: delete the copy and the equivalence test; `lint:check` Biome only.
- [ ] Gate, test first: the shape-check test asserts `prepublishOnly` names `npm run test:shape`; red; edit; green.
- [ ] [break] `as IAuthProviderError` in `src/` → own tree red; restore. [break] remove each rule from the constant in turn → its fixture red; restore. [break] add an entry to a site list → the empty-lists case red; restore.
- [ ] Planted-construct proof with `npm run prepublishOnly` (non-zero with the finding, then pass); [break] remove `test:shape` from it → assertion red, plant passes; restore. Record.
- [ ] Docs: CLAUDE.md Build Commands and the shape-check paragraph; any doc naming the copy; `npm run check:docs` green.
- [ ] Gates: `npm run build`, `npm run lint:check`, `npm test`, `npm run test:shape`, `npm run check:pack`; lockfile check.
- [ ] Commits, push, PR description, review, CI green, merge. No release.

### Task 15 — auth-broker: the shape check as tests in both packages (development-only PR)

Repository: `/home/okyslytsia/prj/mcp-abap-adt-auth-broker`, worktree `.worktrees/checks-as-tests`, branch `chore/checks-as-tests`.

**Implements:** §6 (auth-broker, two roots, three fixtures each), §6a / D18 (broker row, `check`, `release.yml`), D17 (broker matrix), §9 (README, CLAUDE.md, AGENTS.md, `docs/architecture/ARCHITECTURE.md`, `docs/development/TESTING.md`), §11, §13 (broker), the fixture placement ruling, invariant 1 (workspace siblings the only links).

**Files:**
- `packages/auth-broker/package.json`, `packages/auth-broker-cli/package.json` (`^2.2.0`; `test:shape` = `cross-env NODE_OPTIONS=--experimental-vm-modules jest <its shape-check test>`); root `package.json` (`test:shape` = `npm run test:shape --workspaces`; `check:shape` deleted; `check` names `npm run test:shape` in its place); lockfile
- delete `tools/check-provider-shape.mjs`, `packages/auth-broker/src/__tests__/tools/shapeCheckCopy.test.ts`
- create `packages/auth-broker/src/__tests__/tools/shapeCheck.test.ts`, `packages/auth-broker-cli/src/__tests__/shapeCheck.test.ts`
- create `packages/auth-broker/tools/__fixtures__/{rule4,rule5,rule6}.ts`, `packages/auth-broker-cli/tools/__fixtures__/{rule4,rule5,rule6}.ts`
- transitional `packages/auth-broker/src/__tests__/tools/shapeCheckEquivalence.test.ts` (covers both roots)
- `biome.json` (`!!packages/*/tools/__fixtures__`)
- `.github/workflows/release.yml` (a `test:shape` step after `build`)
- docs of §9

**Interfaces:** consumes `checkProviderShape`, `reportLines` from the registry; produces one `SHAPE_CHECK` per package (`{ typescript, rules: [4, 5, 6], root: <package>, project: <package>/tsconfig.json, sites: null }`).

**Steps:**
- [ ] Precondition: `npm view @mcp-abap-adt/auth-errors@2.2.0 version` answers `2.2.0`; no other PR open here; worktree from `main`.
- [ ] Bump both packages, `npm install`; lockfile: auth-errors 2.2.0 from the registry; the only `"link": true` entries are the two workspace packages.
- [ ] Transitional commit, test first: fixtures written (each breaking one rule, type-correct under the package's strict options); equivalence over §7's broker matrix (each root `4,5,6`; each root 4–8) plus each fixture with its package's options — own 2.1.1 copy (sha256 asserted) vs module vs installed thin command; the two shape-check tests (own root clean; each fixture refused by its rule alone). Confirm with the 2.1.1 copy that each fixture is accepted as a file argument under the package's `tsconfig.json` (as connection's are). Red, green, gates (`npm run build`, `npm run test:check`, `npm run lint:check`, both tests by path), commit, push, CI green, record.
- [ ] Removal commit: delete the copy, `shapeCheckCopy.test.ts`, the equivalence test, `check:shape`.
- [ ] Gate, test first: each package's shape-check test asserts root `check` names `npm run test:shape`, its own `prepublishOnly` runs `check`, `release.yml` names `npm run test:shape`; red; edit root `package.json`, `release.yml`; green.
- [ ] [break] a cast `as IAuthProviderError` in each package's `src/` in turn → that package's own-root case red; restore. [break] remove each rule from each package's constant in turn → that fixture red; restore.
- [ ] Planted-construct proof with `npm run check` (non-zero with the finding, then pass); [break] remove `test:shape` from `check` → assertion red, plant passes `check`; restore. Record.
- [ ] Docs: README (`check` list, `check:shape` row), CLAUDE.md, AGENTS.md, `docs/architecture/ARCHITECTURE.md`, `docs/development/TESTING.md`; `grep -rn "check:shape\|check-provider-shape\|shapeCheckCopy"` answers nothing stale.
- [ ] Gates: `npm run check`, `npm test`, `npm run test:shape`; lockfile check.
- [ ] Commits, push, PR description, review, CI green, merge. No release.

### Task 16 — the cross-repository check

**Implements:** goal *Success* "One implementation, no copies", "A repository's checks run as its tests", invariant 1.

**Files:** none changed (findings go to a note or the relevant PR, never a new PR).

**Interfaces:** consumes the merged states of Tasks 12–15.

**Steps:**
- [ ] In fresh worktrees (or `git fetch` + read-only inspection of `origin/master` / `origin/main`) of all four repositories: no file named `check-provider-shape.mjs` outside auth-errors' `tools/`; no test reading the installed command's bytes; no `scripts/generate-*` left; no `lint:check`, `check` or `check:shape` calling a `.mjs`/`.js` checking script of the shape check.
- [ ] Each repository: `test:shape` exists and each publishing gate of §6a names it; `npm run test:shape` green.
- [ ] Each consumer lockfile resolves `@mcp-abap-adt/auth-errors` 2.2.0 from registry.npmjs.org; no `"link": true` outside the broker's workspace siblings.
- [ ] `grep -rn "§\|Decision D[0-9]"` over the four repositories' `src`, `tools` and docs answers nothing citing a working document from this change.
- [ ] No `docs/superpowers` file of this change remains anywhere; the auth-errors PR description's "owed" list is all ticked, the §10 scripts left for their own change.
- [ ] Report to the user: the four PRs, the transitional runs, the gate proofs, any found defects for their own change.

## Pre-flight

### Shared files and interfaces

| Producer → consumer | Produced | Consumed | Agree? |
|---|---|---|---|
| T1 → T2 | `RuleContext`, `report(node, rule, what)`, the four API types | rules call `report`; `index.ts` sorts | yes — T2 adds no option, only rules |
| T1 → T2, T3 | `shapeCheckEquivalence.test.ts` (usage/type-error rows, held script path) | T2 adds findings rows, T3 the thin-command column | yes — same file, appended |
| T1 → T3 | API messages equal to the script's `fail` text | thin command prints `message`, then `USAGE` | yes — D6 keeps the flag-naming messages |
| T2 → T8 | `shapeCheck.test.ts` (fixtures, own tree) | T8 adds the gate assertion; `test:shape` runs this file | yes |
| T3 → T4 | transitional commit, CI green | T4 deletes the test and `tools/previous/` | yes — T4's precondition |
| T3 → T5, T7 | `packedConsumer({ withTypescript })` | T5's exports cases, T7's no-TypeScript consumer | yes — the flag covers both |
| T3, T5 → `exportsMap.test.ts` | `./shape-check` (T3), `./tables` (T5) cases | one file edited twice | yes — T5 appends; neither removes the other's case |
| T3 → T9 | the command's arguments, statuses | README "The shape check" | yes |
| T5 → T6 | `withRegions`, `tableWriteMode`, `markdownCell`, `contract` in `dist/tables.js` | kinds helper loads `dist/tables.js` after build | yes — T6's gates build first |
| T5 → T7 | `src/tables.ts` | must be unreachable from `src/index.ts` | yes — T5 adds no import from the entry |
| T5 → T13 | `/tables` exports by name | providers' helper | yes — after T12 publishes |
| T6 → T9, T10 | `docs:kinds` as a test run; `scripts/` gone | README/CLAUDE.md wording; CHANGELOG | yes — T6 fixes the script-naming lines, T9 the rest |
| T8 → T12 | `prepublishOnly` = `build && test:shape` | the user's `npm publish` in the publish checkout | yes |
| T8, T9 → `CLAUDE.md` | T8 Build Commands; T9 principles and Layout | one file, two sections | yes — disjoint sections |
| T10 → T12 | version `2.2.0` | `release.yml` tag check, registry check | yes |
| T11 → T13–T16 | PR description's owed list | the consumer tasks and the final check | yes |
| T12 → T13, T14, T15 | `@mcp-abap-adt/auth-errors@2.2.0` on the registry | each consumer's precondition `npm view` | yes |
| T13/T14/T15 → T16 | merged consumer trees | the cross-repo sweep | yes |

### Each task against itself

| Task | Consistent? | Note |
|---|---|---|
| T1 | yes | the original command stays in place, so `lint:check`, the pack test and today's `shapeCheck.test.ts` are green; T3 replaces the command and removes `lint:check`'s call |
| T2 | yes | the own-tree comparison uses 2.1.1's file set; the own-tree test uses the whole tree, new files included |
| T3 | yes | the transitional commit; push and CI before T4 |
| T4 | yes | precondition stated |
| T5 | yes | pure module; RF5's write path is T6's |
| T6 | yes | the real README is never written by a test case; `docs:kinds` writes it |
| T7 | yes | green on arrival by design; each part made load-bearing by its break |
| T8 | yes | the plant is reverted before commit |
| T9 | yes | `readme.test.ts` is the one new test; the sweep is a `grep` over docs, not over checked source |
| T10 | yes | |
| T11 | yes | this plan deletes itself here |
| T12 | yes | publishing is the user's |
| T13 | yes | one task, one PR, several commits; the transitional commit comes first, CI green before removal |
| T14 | yes | `test:shape` uses plain `jest` as connection's `test` does |
| T15 | yes | per-package fixtures; Biome ignores them; tsconfig `include` does not reach them |
| T16 | yes | read-only |
