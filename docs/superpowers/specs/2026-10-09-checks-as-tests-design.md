# The shape check and the generated tables as tests — design

Anchor: [`../2026-10-09-checks-as-tests-goal.md`](../2026-10-09-checks-as-tests-goal.md).
Every item under the goal's *Success* and *Holds throughout* binds this spec;
§14 says how each is met. Nothing here departs from the goal.

Statements about today are checked against these trees:
auth-errors `feat/checks-as-tests` at `3cbf6a4` (2.1.1), auth-providers
`master` at `a144c2d`, connection `master` at `e366bc9`, auth-broker `main`
at `d66fcdb`.

## 0. The decisions in one place

The goal's "Open — for the spec", answered:

1. **Entry points and TypeScript** (D1–D4). Two new subpath exports of the
   CommonJS build: `@mcp-abap-adt/auth-errors/shape-check` (the check) and
   `@mcp-abap-adt/auth-errors/tables` (rendering for README tables). The
   caller hands the check its own `typescript` module as an option; auth-errors
   declares no TypeScript dependency of any kind, and neither entry loads
   TypeScript by itself. Supported compiler: `typescript` `^5.9.0`, the range
   every repository of the chain uses today.
2. **What the module returns** (D5–D7). `checkProviderShape(options)` returns
   a report: `checked` with the sorted findings (`file`, `line`, `column`,
   `rule`, `what`), or `usage-error` with today's message, or `type-errors`
   with today's formatted diagnostics. It never throws for those, never writes
   to a stream, never exits. `reportLines(report)` turns any report into the
   lines a test compares with `[]`, so a failing test lists every finding.
3. **Writing a table back** (D13). The Jest test that compares the README is
   the code that writes it: run with `WRITE_README_TABLES=1`, it writes the
   rendered README and then asserts as always. No script, no second entry.
   The npm scripts `docs:kinds` / `docs:tables` stay as names for that run.
4. **Release and order** (§12). auth-errors **2.2.0** (a minor) carries the
   module, the thin command and its own tests in PR #7. After it is on the
   registry: one development-only PR each in auth-providers, connection and
   auth-broker, in any order.
5. **Where the fixtures live** (D16). They stay where they are, as each
   repository's own tests: auth-errors' under `tools/__fixtures__`, the
   consumers' under theirs. The package ships none.

Beyond the five questions: **the shape check stays a publishing gate** (D18,
§6a). Each repository gets a `test:shape` script that runs its shape-check
Jest test by path. Every path that publishes to npm — `prepublishOnly`, and
the broker's `check`, which `release:publish` runs before publishing with
`--ignore-scripts` — runs `test:shape`, so a type-correct rule violation still
blocks a publish. Open for the user (§15): reading invariant 5 as allowing the
script's existing regexes over strings the compiler extracted.

## 1. What is there today

- **The script.** `tools/check-provider-shape.mjs`, 1804 lines of ESM, `import
  ts from 'typescript'` at the top (`:141`). `parseArguments` (`:186-239`)
  takes `--rules` (required), `--base`, `--root` (default: the working
  directory), `--project` (default `<root>/tsconfig.json`), `--sites`
  (default `<root>/tools`) and file arguments, resolved against the working
  directory. `fail(message)` (`:181-184`) writes `message`, then the usage
  line, to stderr and exits 2; it is reached from argument parsing, site lists
  (`:241-258`), the project (`:288-294`), files (`:313-318`), the base
  (`:322-327`, `:533-551`), the brands (`:387-412`), interfaces-auth
  (`:524-530`) and `a file to check is not in the program` (`:358-359`). A
  program that does not type-check writes `the shape check needs a program
  that type-checks:` and the formatted diagnostics, without the usage line,
  and exits 2 (`:352-357`). Findings are sorted by file, line, column, rule
  and printed as `<file>:<line>:<column>: rule <n>: <what>` on stdout; exit 1
  with findings, 0 without (`:1792-1804`). A missing project file falls back
  to strict defaults over `<root>/src` (`:262-305`); a missing site list is an
  empty one (`:243`). `packageCache` (`:438`) is module-level state.
- **What a rule owns.** The selection of files (`src/`, outside
  `__tests__`, `__typechecks__`, `__fixtures__`, `__mocks__`, `*.test.*`,
  `*.spec.*`, declarations; `:271-312`), rule 4's `OVERLOAD_FILES` (`:161`),
  rule 8's `BASIC_SCOPE` — `src/auth/`, `src/providers/`,
  `src/clientAuthentication/` — and `BASIC_SITES` (`:163-174`), the crypto
  modules (`:176`), `MAX_DEPTH` (`:177`). The header's rule 8 line still says
  "in src/auth and src/providers"; the code and the README say three
  directories.
- **Citations.** The header and comments cite `spec §8.2`, `§6, C12`,
  `Decision D4` (`:3-4`, `:9`, `:52`, `:79`, `:152`); the generator and the
  tests cite `§11.4`, `§11.3`, `§4.3`, `Decision D4`.
- **Copies.** The same bytes (sha256 `681d8cbd…70715603`) sit in
  auth-providers, connection and auth-broker `tools/`, each with a test
  comparing them to the installed `@mcp-abap-adt/auth-errors` 2.1.1 file:
  auth-providers `src/__tests__/shapeCheck.test.ts`, connection
  `src/__tests__/shapeCheck.test.ts` (`R1`), auth-broker
  `packages/auth-broker/src/__tests__/tools/shapeCheckCopy.test.ts`.
- **How each repository runs it.**

  | Repository | Where | Arguments |
  |---|---|---|
  | auth-errors | `lint:check` | `--rules 4,6` (sites `tools/`: four assertion sites, no diagnostic site) |
  | auth-providers | `lint:check` | `--rules 1,2,3,4,5,6,7,8 --base ./src/auth/AuthProviderBase#AuthProviderBase` (sites `tools/`: no assertion site, 14 diagnostic sites) |
  | connection | `lint:check` | `--rules 4,5,6` (sites `tools/`: both lists empty) |
  | auth-broker | `check:shape` (in `check`) | `--rules 4,5,6 --root packages/auth-broker`, then the same with `--root packages/auth-broker-cli` (no `tools/` in either root: both lists empty) |

  Run on these trees, all four are clean (exit 0). auth-providers with an
  empty sites directory and `--rules 6` reports 15 lines; its rule-8 tree
  (`--rules 8 --root tools/__fixtures__/rule8`) reports two.
- **Fixtures.** auth-errors: `tools/__fixtures__/src` (22 breaking files, 9
  obeying), `bases/` (three bases), `sites/`, its own `tsconfig.json`;
  `shapeCheck.test.ts` runs them through child processes. auth-providers:
  `tools/__fixtures__/rule1.ts`…`rule7.ts`, `clean.ts`, and a `rule8/` tree
  with its own `tsconfig.json`. connection: `rule4.ts`, `rule5.ts`,
  `rule6.ts`, `clean.ts`. auth-broker: none.
- **Tables.** auth-errors: `scripts/generate-kinds-table.mjs` builds every
  row through the built builders (`dist/index.js`) and reads
  `ASSERTION_RULE_CHECK` from `dist/words.js`; its samples, per kind, are this
  repository's; `kindsTable.test.ts` runs it as a child and compares the
  README between `BEGIN GENERATED` / `END GENERATED`; `npm run docs:kinds`
  runs it with `--write`. auth-providers: `scripts/generate-refusal-tables.mjs`
  renders five tables (`rejected`, `refusals`, `saml`, `saml-candidates`,
  `configuration`) with `render` from auth-errors and the allowlists of
  interfaces-auth resolved *through* auth-errors (`createRequire` on
  auth-errors' path, `:22-27`); `each` (`:39-46`) throws for an allowlist value
  with no row text; regions are `<!-- generated:refusal-table NAME -->` /
  `<!-- /generated:refusal-table NAME -->`; `readmeRefusalTables.test.ts` runs
  it with `--check` and checks that three hand-edited rows fail;
  `npm run docs:tables` rewrites the README.
- **Packaging.** auth-errors is CommonJS (`main: dist/index.js`, no
  `"type"`), built by `tsc -p tsconfig.build.json` (module `Node16`). Its
  `exports`: `.`, `./package.json`, `./tools/check-provider-shape.mjs`.
  Every consumer compiles with `moduleResolution: "node"`, which ignores
  `exports`. `typescript` is a devDependency of every repository (`^5.9.2`;
  the broker CLI package `^5.9.3`); 5.9.3 is installed everywhere.
- **The main entry** (`src/index.ts`) imports `node:util/types` (in
  `guard.ts`) and interfaces-auth; no module reachable from it imports
  `node:fs` or `typescript`.

## 2. The shape-check module

**D1 — Two subpath exports of the CommonJS build.**
`@mcp-abap-adt/auth-errors/shape-check` → `dist/shapeCheck/index.js`, and
`@mcp-abap-adt/auth-errors/tables` → `dist/tables.js`, each with `types`,
`require` and `default` conditions like the main entry. For consumers that
compile with `moduleResolution: "node"` the package also declares
`typesVersions` mapping `shape-check` and `tables` to their `.d.ts` (verified
on a scratch package: the main entry and both subpaths resolve under `node`,
`node16` and `bundler`). *Reason:* every consumer's Jest runs CommonJS
(connection's plain `jest` included), so the module must load through
`require` without `--experimental-vm-modules`; two entries keep the tables,
which need no compiler, apart from the check; `typesVersions` is what makes
the subpath typable where the consumers stand today.

**D2 — The module is TypeScript in `src/`, a port of the script.**
`src/shapeCheck/` holds the API (`index.ts`), program loading, and the rules,
ported from the script in the same order and structure; it is compiled,
linted and type-checked under auth-errors' strict options like the rest of
`src`. The port changes syntax and adds types; it does not change a decision.
Where a strict option forces a guard on a value the script assumed present
(`noUncheckedIndexedAccess`), the guard keeps every outcome the script
produces for a present value; a path where the script would have thrown is
listed in the PR as a found defect and left as it decides (invariant 3).
*Reason:* the alternative, shipping the JavaScript as it is with a
hand-written declaration, keeps 1800 lines outside the compiler the package
otherwise refuses to work without; the equivalence proof (§7) is what makes a
port safe, and it is required anyway.

**D3 — The caller's TypeScript, given as an option.** The API takes
`typescript: typeof import('typescript')`. No file of `src/shapeCheck`
imports `typescript` at run time (`import type` only); every compiler call
goes through the instance given. auth-errors declares no `dependencies`,
`peerDependencies` or `peerDependenciesMeta` entry for TypeScript; its own
`typescript` devDependency stays. *Reason:* the repository states which
compiler decides its rules (invariant 4); an optional peer dependency would
still make npm resolve and possibly refuse a tree whose TypeScript is outside
the range — a cost to every consumer of the main entry, which has nothing to
do with the check (invariant 2); and the module then loads no compiler of its
own, which also makes the `shape-check` entry itself loadable without one.

**D4 — Supported range `^5.9.0`, documented, not gated.** The README states
that the check is tested with TypeScript `^5.9.0`. The module does not refuse
another version. *Reason:* a gate would add an exit-2 case to the published
command that does not exist today (the goal keeps its exit statuses), and
every repository is on 5.9.3; a later major is taken up by an auth-errors
release that runs its fixtures under it.

### 2.1 The API

```ts
export type ShapeRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ShapeCheckOptions {
  readonly typescript: typeof import('typescript');
  readonly rules: readonly ShapeRule[];        // --rules
  readonly root: string;                       // --root, absolute
  readonly project: string | null;             // --project, absolute; null: no tsconfig
  readonly sites: string | null;               // --sites, absolute directory; null: no site lists
  readonly base?: string | undefined;          // --base, '<module>#<export>'
  readonly files?: readonly string[] | undefined; // the file arguments, absolute
}

export interface ShapeFinding {
  readonly file: string;     // relative to root, '/'-separated
  readonly line: number;     // 1-based
  readonly column: number;   // 1-based
  readonly rule: ShapeRule;
  readonly what: string;
}

export type ShapeCheckReport =
  | { readonly status: 'checked'; readonly findings: readonly ShapeFinding[] }
  | { readonly status: 'usage-error'; readonly message: string }
  | { readonly status: 'type-errors'; readonly diagnostics: string };

export function checkProviderShape(options: ShapeCheckOptions): ShapeCheckReport;
export function formatFinding(finding: ShapeFinding): string;
export function reportLines(report: ShapeCheckReport): readonly string[];
```

**D5 — Options mirror the command, and nothing is guessed.** Each option is
the command's argument of the same name, already resolved. The API reads no
working directory and applies no default: `root`, `project`, `sites` and
`files` must be absolute paths; `project` and `sites` are stated even when
absent (`null`). What `null` means is today's behaviour for a missing file:
`project: null` is the strict defaults, over `<root>/src` when no files are
given; `sites: null` is two empty lists. A `project` or `sites` that is
stated but does not exist is a usage error (the command maps a missing one to
`null`, §5, so its behaviour is unchanged). Inside a stated `sites`
directory a missing list is still an empty one. `rules` is checked at run
time (empty, or a number outside 1–8: usage error), duplicates count once.
There is no option for the file selection, the test exclusions, rule 4's
overload files or rule 8's scope and sites: they are the rules' own
(invariant 4).

**D6 — A report, not a throw, for what the command reports with exit 2.**
Every path that ends in `fail(message)` today ends in
`{ status: 'usage-error', message }` with the same message text — including
the messages that name a command flag (`--base`), so the command prints
exactly today's words; the API-only refusals (a relative path, an empty rule
list, no `typescript` module given, a stated `project`/`sites` that does not
exist) have messages of their own naming the option. A program that does not
type-check is `{ status: 'type-errors', diagnostics }`, the diagnostics
formatted as today (relative to `root`). `checked` carries the findings
sorted as today. The function writes to no stream, never exits, reads no
environment variable, and keeps no state between calls (today's
`packageCache` becomes per call). An exception that is not one of today's
`fail` paths — a defect in a rule — is not caught: it propagates, as it
crashes the script today.

**D7 — `reportLines` is what a test compares.** For `checked`, one
`formatFinding` line per finding — `<file>:<line>:<column>: rule <n>: <what>`,
today's stdout line. For `usage-error`, `cannot check: <message>`; for
`type-errors`, `cannot check: the program does not type-check` followed by
the diagnostics' lines. A test writes
`expect(reportLines(checkProviderShape(options))).toEqual([])`, and Jest's
diff then lists every finding with file, line, column, rule and what was
found — or why nothing could be checked. *Reason:* one assertion covers the
three outcomes; no repository writes its own formatter.

**D8 — Comments cite no document.** The module's comments, messages and the
README's description of it say what a rule decides and why, in their own
words; no `§`, no `Decision Dn`, no `Cn`. The rule-8 comment is corrected to
the three directories the code covers. The tests touched by this change drop
their citations too (`shapeCheck.test.ts`, `kindsTable.test.ts`).

## 3. Invariant 2 — the main entry loads nothing of it

`src/index.ts` exports nothing from `src/shapeCheck` or `src/tables.ts`, and
nothing reachable from it imports them. Proven three ways, each a test:

1. **Source graph.** A test walks the imports of `src/index.ts` transitively
   (`ts.preProcessFile`, test code) and fails if any reaches `./shapeCheck`,
   `./tables`, `typescript`, `fs` / `node:fs` or `node:fs/promises`.
2. **The packed main entry, without TypeScript.** In a temporary consumer
   holding the packed package and interfaces-auth but **no** `typescript`, a
   child process requires `@mcp-abap-adt/auth-errors`, uses `authError`,
   `classify` and `render`, and prints `Object.keys(require.cache)`: no path
   under `dist/shapeCheck/`, `dist/tables`, or a `typescript` package.
3. **No file read.** The same child runs with a preload that records every
   call of `fs.readFileSync`, `fs.openSync`, `fs.readdirSync`, `fs.statSync`
   and `fs.existsSync`; every recorded path is a module file in
   `require.cache` (the loader's own reads), and nothing is recorded once the
   entry has loaded.

In the same consumer, `require('@mcp-abap-adt/auth-errors/shape-check')` and
`.../tables` load without `typescript` installed (D3).

## 4. The tables module

**D9 — Who owns what.** auth-errors owns rendering a row's words from a kind
and its facts (`render`, the builders) and the allowlists those facts are
checked against. The repository whose README carries a table owns its rows:
which values, which sample facts, the hand-written "When" / "The rejection" /
"Thrown" cells, the column layout and the prose. auth-providers' row texts
(configuration conditions, renewal behaviour, rejection examples) stay in
auth-providers; auth-errors' kinds samples stay in auth-errors' tests. A
provider change therefore needs no auth-errors release to keep its README
true.

**D10 — What `@mcp-abap-adt/auth-errors/tables` exports.**

```ts
export { render } from './words';   // the very function the main entry exports
export const contract: typeof import('@mcp-abap-adt/interfaces-auth');
export function rowsFor<V extends string, R>(
  values: readonly V[], rows: Readonly<Record<string, R>>, table: string,
): readonly (readonly [V, R])[];
export function markdownCell(text: string): string;
export interface GeneratedRegion { readonly open: string; readonly close: string; readonly body: string }
export function withRegions(text: string, regions: readonly GeneratedRegion[]): string;
export function tableWriteMode(env: Readonly<Record<string, string | undefined>>): boolean;
```

- `render` is re-exported from the same compiled module the main entry uses,
  so within one install it is the same function object.
- `contract` is interfaces-auth **as auth-errors resolves it** — the instance
  `allowlists.ts` copies its guards from. It replaces auth-providers'
  `createRequire` on auth-errors' path. *Reason:* words and values from one
  place, by construction rather than by a resolution trick.
- `rowsFor` is today's `each`: the row for each allowlist value, in the
  allowlist's order; a value without a row throws an `Error` naming the table
  and the value, so an unknown value fails the table as today. A row for a
  value not in the allowlist is ignored, as today.
- `markdownCell` escapes `|` as today's `cell`. The kinds table's `code` cell
  (backtick fencing) stays in auth-errors' tests — one table uses it.
- `withRegions` replaces each region's body between the first `open` and the
  first `close` after it with `\n<body>\n`, as auth-providers' `generate`
  does; markers missing, or `close` before `open`, throw naming the marker.
  Pure: it reads and writes no file. The kinds table is expressed as one
  region whose body yields the README bytes of today (the README test proves
  it, §13).
- `tableWriteMode(env)` is `true` when `env.WRITE_README_TABLES === '1'`,
  `false` when unset, and throws when it is `'1'` and `env.CI` is set, or
  when it holds any other value. It reads only the object it is given; the
  test passes `process.env`.

Rendering still goes through `render`, which answers the unfamiliar words for
facts it does not know rather than throwing; the tables keep today's guards
on top of it (`rowsFor`, the prefix checks in auth-providers' TLS and SAML
tables, the kinds table's `kind` check) — no new strictness, none lost.

**D11 — The kinds table (auth-errors).** `scripts/generate-kinds-table.mjs`
is deleted. Its samples, `statusFor` and `code` move unchanged in substance
to a test helper, `src/__tests__/helpers/kindsTable.ts`, which builds the
table from the **built** package as today: builders from `dist/index.js`,
`contract` from `dist/tables.js`, `ASSERTION_RULE_CHECK` from `dist/words.js`
(the `loadBuiltModule` helper). The throws stay: no samples for a kind, no
builder for a kind, a builder answering another kind. `kindsTable.test.ts`
compares and, in write mode, writes (D13).

**D12 — The refusal tables (auth-providers).**
`scripts/generate-refusal-tables.mjs` is deleted and `scripts/` with it. Its
five table builders and their row texts move to
`src/__tests__/helpers/refusalTables.ts` (TypeScript, under the test
compiler options; `throwSweep.test.ts` skips `__tests__`). They take
`render`, `contract`, `rowsFor`, `markdownCell` and `withRegions` from
`@mcp-abap-adt/auth-errors/tables`; a branded fact is made with the main
entry's maker (`httpStatus(403)`) where the type requires it — the words are
the same. The README's bytes do not change.

**D13 — Writing a table back is a run of its test.** Each README test:

1. reads the README, renders the expected text with `withRegions`;
2. if `tableWriteMode(process.env)`, writes the expected text when it
   differs;
3. reads the README again and asserts it equals the expected text; the
   failure names the command that regenerates it.

The npm scripts become runs of that test:
auth-errors `docs:kinds` = `npm run build && WRITE_README_TABLES=1 npm test --
src/__tests__/kindsTable.test.ts`; auth-providers `docs:tables` =
`WRITE_README_TABLES=1 npm test -- src/__tests__/readmeRefusalTables.test.ts`.
*Reason:* the user's rule keeps only Jest suites and the tooling they run; a
"tiny entry" that writes is a hand-run script under another name. The test is
already the code that renders; writing is one more branch of it, and CI —
which sets `CI` — cannot write (it throws instead of silently rewriting).

## 5. The published command

`tools/check-provider-shape.mjs` stays at that path, in `files` and in
`exports`, as a thin command:

- `#!/usr/bin/env node`; a header that says what it is, its arguments, its
  output and exit statuses, and points at the module for the rules and their
  limits;
- `import ts from 'typescript'`, resolved from the command's own location as
  today;
- the module by name — `@mcp-abap-adt/auth-errors/shape-check` (a default
  import of the CommonJS entry) — which resolves in an install, in the
  auth-errors repository by self-reference after a build, and from a copy in
  another repository's `tools/` through that repository's installed
  auth-errors;
- today's argument parsing and usage line, byte for byte in what it accepts
  and prints; relative paths resolved against the working directory as
  today; `project` / `sites` passed as `null` when the file / directory does
  not exist (today's fallback);
- output: `checked` → each `formatFinding` line on stdout, exit 1 if any,
  else exit 0; `usage-error` → `${message}\n${USAGE}\n` on stderr, exit 2;
  `type-errors` → `the shape check needs a program that type-checks:\n`
  followed by the diagnostics on stderr, exit 2. An uncaught defect crashes
  the process as today.

**D14 — The command imports the module by name, not by a relative path.**
*Reason:* a repository that still copies the file during its migration keeps
working after it re-copies (the thin file finds the installed module), and the
packed command needs no knowledge of `dist/`'s layout.

**D15 — A test of the packed package proves the command.** In the packed
consumer of `exportsMap.test.ts` (extended, or a sibling test using the same
setup) with `typescript` and interfaces-auth linked in, the installed command
is run as a child on: the fixtures with every rule (exit 1; stdout lines equal
`reportLines` of the API on the same options, in the same order; stderr
empty); auth-errors' own tree with `--rules 4,6` (exit 0, nothing printed);
each usage case of today's `shapeCheck.test.ts` (no `--rules`, an unknown rule,
an unknown option, an option without a value, a malformed `--base`, a base
that does not resolve, a missing file, nothing to check, rules 4/5 without
the brands) — exit 2, stdout empty, stderr exactly the expected message and
usage line; a program that does not type-check — exit 2, stderr starting with
today's sentence. The exports test also asserts that `./shape-check` and
`./tables` resolve by name, that deep paths are still refused, and that a
consumer with `moduleResolution: "node"` and one with `"node16"` type-check an
import of both subpaths.

## 6. The test each repository writes

Each repository declares one options constant — its whole configuration, in
one place — and one test file that uses it:

```ts
import ts from 'typescript';
import { checkProviderShape, reportLines } from '@mcp-abap-adt/auth-errors/shape-check';

const SHAPE_CHECK = { typescript: ts, rules: [...], root, project, sites, base? } as const;

it('the shape check finds nothing in this repository', () => {
  expect(reportLines(checkProviderShape(SHAPE_CHECK))).toEqual([]);
}, 120_000);
```

| Repository / root | `rules` | `root` | `project` | `sites` | `base` |
|---|---|---|---|---|---|
| auth-errors | 4, 6 | the repository | `tsconfig.json` | `tools/` | — |
| auth-providers | 1–8 | the repository | `tsconfig.json` | `tools/` | `./src/auth/AuthProviderBase#AuthProviderBase` |
| connection | 4, 5, 6 | the repository | `tsconfig.json` | `tools/` | — |
| auth-broker `packages/auth-broker` | 4, 5, 6 | the package | its `tsconfig.json` | `null` | — |
| auth-broker `packages/auth-broker-cli` | 4, 5, 6 | the package | its `tsconfig.json` | `null` | — |

Paths are absolute, from `__dirname`. Beyond the own-tree case, each test
keeps every case its repository has today, run through the module:

- **auth-providers** (`src/__tests__/shapeCheck.test.ts`, rewritten): the
  assertion list is empty; the diagnostic list names exactly the approved
  sites; with `sites` set to an empty directory, rule 6 reports each listed
  site and nothing else; each of `rule1.ts`…`rule7.ts` with `SHAPE_CHECK` and
  `files: [fixture]` is refused with its count, every finding its own rule;
  `rule2.ts` names `establish`; `clean.ts` passes; the rule-8 tree with
  `rules: [8]`, its own root and `tsconfig.json`, `sites: null` reports the
  two findings. New: `SHAPE_CHECK.rules` contains every rule a fixture breaks,
  rule 8 included. The case "lint:check runs it after Biome…" and the
  byte comparison are removed — the constant is the configuration.
- **connection** (`src/__tests__/shapeCheck.test.ts`, rewritten): both site
  lists empty; each of `rule4.ts`, `rule5.ts`, `rule6.ts` refused by its rule
  alone; `clean.ts` passes; the own tree passes. `R1` is removed.
- **auth-broker**: `shapeCheckCopy.test.ts` is replaced by
  `packages/auth-broker/src/__tests__/tools/shapeCheck.test.ts`, and
  `packages/auth-broker-cli` gains its own `src/__tests__/shapeCheck.test.ts`;
  each runs its package's root. Each also runs three fixtures — one breaking
  rule 4, one rule 5, one rule 6, new test data placed outside both packages'
  `src` selection and kept out of Biome as the other repositories' fixtures
  are — with its package's constant and `files`, each refused by its rule
  alone. *Reason:* the broker has no fixture today, so without them nothing
  would turn red when its options lose a rule.
- **auth-errors**: §13.

Scripts: `lint:check` in auth-errors, auth-providers and connection keeps
Biome only; auth-broker's `check:shape` script is deleted and `check` no
longer names it. `npm test` (and CI, which runs `npm test` or `npx jest`)
runs the new tests. auth-broker-cli's Jest config needs no change: the test
lives under its `src/__tests__`.

## 6a. The publishing gate

Today the shape check reaches publication only through scripts that this
change removes it from:

| Repository | What publishes to npm | What runs the shape check before it today |
|---|---|---|
| auth-errors | the user's `npm publish`; `prepublishOnly` = `build` | nothing in `prepublishOnly`; the tag workflow (`release.yml`) runs `lint:check` and `npm test` and builds a GitHub release, but does not publish to npm |
| auth-providers | the user's `npm publish`; `prepublishOnly` = `build` | nothing: `release.yml` runs `build` and `npm pack` only; the check runs only in branch CI (`lint:check`) |
| connection | the user's `npm publish`; `prepublishOnly` = `build && lint:check && check:docs && check:pack` | `lint:check` in `prepublishOnly`; `release.yml` runs `lint:check` and `npx jest` |
| auth-broker | `release:publish` (`tools/publish-changed.js`): runs `npm run check` once, then `npm publish --workspace … --ignore-scripts`; each package's `prepublishOnly` = `npm run --prefix ../.. check` | `check` → `check:shape`; `check` never runs `npm test`; `release.yml` runs `build` and `npm pack` only |

Once `lint:check` is Biome only and `check:shape` is deleted, connection's
`prepublishOnly` and the broker's `check` would publish without the shape
check, and auth-errors' and auth-providers' gates would still have none.

**D18 — Every publishing path runs the shape-check test.** Each repository
gets one script, `test:shape`, that runs its shape-check Jest test(s) by path
through the repository's own Jest invocation (with the flags `npm test`
supplies there):

| Repository | `test:shape` runs | Added to |
|---|---|---|
| auth-errors | `src/__tests__/shapeCheck.test.ts` (fixtures and own tree, in-process) | `prepublishOnly` (`build && test:shape`); `release.yml` already runs `npm test` |
| auth-providers | `src/__tests__/shapeCheck.test.ts` | `prepublishOnly` (`build && test:shape`); `release.yml` gains a `test:shape` step after `build` |
| connection | `src/__tests__/shapeCheck.test.ts` | `prepublishOnly`, in the place `lint:check`'s shape run had; `release.yml` already runs `npx jest` |
| auth-broker | each package's shape-check test; the root `test:shape` = `npm run test:shape --workspaces` | `check`, in the place of `check:shape` — so `prepublishOnly` and `release:publish` both run it; `release.yml` gains a `test:shape` step after `build` |

`test:shape` runs Jest, not a checking script, so the goal's "no `lint:check`,
`check` or `check:shape` calls a checking script of its own" still holds.
*Reason:* moving the check into the test suite must not move it out of the
gates; running the one test by path keeps the gates as fast as today and
needs none of the live configuration the full suites skip without.

**Proving the gate.** In each repository's PR, with a type-correct prohibited
construct planted in `src/` — `export const forged = {} as
IAuthProviderError;` (rule 4, compiles under the strict options) — the
publishing gate is run as it runs at publication: auth-errors, auth-providers
and connection `npm run prepublishOnly`, auth-broker `npm run check`. It must
exit non-zero with the finding listed; with the plant reverted it must pass.
The PR records both runs. The load-bearing break: remove `test:shape` from the
gate, and the planted construct passes the gate. To keep that break caught
after the PR, each repository's shape-check test file also asserts, by reading
its `package.json`, that every gate in the table above names
`npm run test:shape` (for the broker: `check` does, and both packages'
`prepublishOnly` run `check`); removing it turns that test red.

## 7. Before and after: the same findings

**D17 — The equivalence is proven in each PR by a transitional commit,
then removed.** The first code commit of each PR adds the module (auth-errors)
or the new dependency range (consumers), the new tests, and a transitional
test, `shapeCheckEquivalence.test.ts`, that runs the **2.1.1 script** and the
**module** on the same matrix and asserts, for every entry: the script's
stdout lines equal `reportLines` of a `checked` report, in order; exit 0 ↔
`checked` with none, 1 ↔ `checked` with some; exit 2 ↔ a `usage-error` whose
message plus the usage line is the script's stderr, or a `type-errors` whose
diagnostics follow the script's sentence. It also runs the installed thin
command on the same matrix and compares its status, stdout and stderr with the
script's, byte for byte. CI runs that commit green; the next commit deletes
the transitional test together with the copy. The PR description records the
run. No copy and no comparison test is left at the end.

Where the 2.1.1 script comes from:

- consumers: their own `tools/check-provider-shape.mjs`, still present in the
  first commit (the existing byte-comparison test is deleted in that commit,
  since the installed file is now the thin command);
- auth-errors: the first commit moves the script to
  `tools/previous/check-provider-shape.mjs` (outside `files`, so never
  published) and the transitional test asserts its sha256 is
  `681d8cbdc6177d2436955e172d9aded58ea67e8b9a604d1fbaf1f81c70715603`, the
  2.1.1 file the consumers' tests compare against today.

The matrix, per repository:

| Repository | Entries |
|---|---|
| auth-errors | own tree `4,6`; own tree `4` with an empty sites dir; own tree 1–8 with the fixtures' base; the fixtures root, every rule, fixture sites and base; every narrowed run of today's `shapeCheck.test.ts` (rule 5 only, given files, the impostor pair, the three `bases/`, `prose.ts` with `RewritingBase`, `obeys.ts` with either base); each fixture file alone with every rule; every usage and type-error case of today's test |
| auth-providers | own tree as configured; own tree `6` with an empty sites dir; own tree 1–8 with an empty sites dir; each of `rule1.ts`…`rule7.ts`, `clean.ts` with the configuration; the rule-8 tree with `8` |
| connection | own tree `4,5,6`; own tree 4–8 with an empty sites dir; each fixture with `4,5,6` |
| auth-broker | each root `4,5,6`; each root 4–8 |

The runs with an empty sites dir and with more rules than configured exist so
the comparison is made on trees that do report something, not only on clean
ones.

In auth-errors the module's own files (`src/shapeCheck/`, `src/tables.ts`)
join the files its own check selects. The comparison is made on today's file
set; the new files must be clean under the repository's configuration, which
the own-tree test then asserts.

## 8. Fixtures

**D16 — Fixtures stay with the tests that use them.** auth-errors' fixtures
stay in `tools/__fixtures__` (paths in its expectations are relative to that
root and do not move); the consumers' stay in their `tools/__fixtures__`. The
package ships none: `files` publishes `dist`, the command and the docs, and
the existing pack test (`tools/` in the tarball is the command alone) stays.
*Reason:* auth-errors' fixtures prove the rules; a consumer's prove that its
configuration runs the rules it means to. Neither is a consumer's runtime
need, and publishing test data would make it an API.

## 9. Documentation

Every document the change touches, in the PR that changes it:

- **auth-errors** — README: "Install" names five paths by name (and its
  stale interfaces-auth range `^6.0.0` becomes the `^7.4.0` of
  `package.json`); "The shape check" rewritten: run it from Jest through
  `@mcp-abap-adt/auth-errors/shape-check` with the repository's own
  `typescript`; the options; the report; the command as an alternative; the
  limits moved from "the script's header" to the module's description;
  "Copy it byte for byte" removed; the kinds-table paragraph and
  "Development" name the test and `docs:kinds`; "Versioning" unchanged.
  CLAUDE.md: principles 9 and 10, Build Commands (`lint:check` is Biome
  only), Layout (`src/shapeCheck/`, `src/tables.ts`, no `scripts/`,
  `tools/` holding the command, the site lists and the fixtures). CHANGELOG
  2.2.0 with the migration note below.
- **auth-providers** — CLAUDE.md: Build Commands (`lint:check`), the Testing
  paragraph on the shape check (no copy, no byte comparison, the rule-8
  fixture tree, and the rule-8 scope corrected to the three directories),
  the SAML and Error-classes paragraphs naming `docs:tables` and the script;
  README / AGENTS.md wherever they name the script or the copy.
- **connection** — CLAUDE.md (Build Commands, the shape-check paragraph);
  any doc naming the copy.
- **auth-broker** — README (`check` list, `check:shape` row), CLAUDE.md,
  AGENTS.md, `docs/architecture/ARCHITECTURE.md`,
  `docs/development/TESTING.md` (the test tree and the `check:shape` row).

**Migration note (CHANGELOG 2.2.0, README).** Nothing breaks: the command at
`@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs` takes the same
arguments, prints the same lines and exits with the same statuses. It is now a
thin command over the module, so a repository that keeps a byte-identical
copy must re-copy it once (its comparison test fails until then), and the
copy then runs the installed module. The recommended use is no copy: a Jest
test calling `checkProviderShape` with the repository's `typescript`, its
rules, root, project, sites and base — and `lint:check` / `check` no longer
calling the command. The command and the module are tested with TypeScript
`^5.9.0`.

## 10. Other hand-run scripts (out of scope)

Listed for their own change, not touched here:

| Repository | File | What runs it | Class |
|---|---|---|---|
| auth-providers | `tools/version-stats.sh` | `npm run chrono`, by hand | temporary |
| auth-providers | `tests/stand/*.sh`, `tests/xsuaa/*.sh` | `test:stand` (CI), `test:xsuaa` — they run Jest suites | tooling a test runs |
| connection | `scripts/check-docs.mjs` (with `docs-paths.js`) | `npm test`, CI | tooling a test runs; a candidate to become a Jest suite |
| connection | `scripts/check-pack.mjs` | CI, `prepublishOnly` | tooling a gate runs; a candidate |
| connection | `scripts/clean.mjs` | `build` | build tooling |
| connection | `scripts/release-notes.mjs` | the release workflow | release tooling |
| connection | `scripts/version-stats.mjs` | `npm run chrono`, by hand | temporary |
| auth-broker | `tools/check-graph.js`, `tools/check-packed.js`, `tools/test-publish-changed.js` | `check` (CI) | tooling a gate runs; candidates |
| auth-broker | `tools/publish-changed.js` | `release:publish` | release tooling |
| auth-broker | `tools/version-stats.sh` | `npm run chrono`, by hand | temporary |

## 11. What changes in each repository

- **auth-errors (PR #7, release 2.2.0).** Adds `src/shapeCheck/`,
  `src/tables.ts`, the two exports and `typesVersions`; replaces the command
  with the thin one; deletes `scripts/`; `lint`/`lint:check` stop naming
  `scripts`, and `lint:check` stops calling the command; `docs:kinds` becomes
  the test run (D13); version `2.2.0`; tests §13; docs §9.
- **auth-providers (development only).** `@mcp-abap-adt/auth-errors`
  `^2.2.0`; deletes `tools/check-provider-shape.mjs` and `scripts/`;
  `lint:check` is Biome only; `docs:tables` becomes the test run; the
  rewritten `shapeCheck.test.ts`, `readmeRefusalTables.test.ts` and the
  tables helper; docs §9. No release.
- **connection (development only).** `@mcp-abap-adt/auth-errors` `^2.2.0`;
  deletes `tools/check-provider-shape.mjs`; `lint:check` is Biome only; the
  rewritten test; docs. No release.
- **auth-broker (development only).** `@mcp-abap-adt/auth-errors` `^2.2.0` in
  both packages; deletes `tools/check-provider-shape.mjs` and
  `shapeCheckCopy.test.ts`; deletes `check:shape` and its place in `check`;
  the two tests and three fixtures; docs. No release.

Each of the four also gets `test:shape` and the gate changes of §6a.

In every consumer the lockfile resolves auth-errors 2.2.0 from
`registry.npmjs.org`; after the install, no `"link": true` other than a
workspace sibling (the broker), and every package from the registry.

## 12. Release and order

1. auth-errors PR #7 carries the goal, this spec, the plan, the code, the
   tests and the docs. After review and green CI it is merged and tagged
   `v2.2.0`; the plan and spec are deleted before the tag. The user publishes.
2. Once `@mcp-abap-adt/auth-errors@2.2.0` is on the registry — and not
   before (invariant 1) — one PR in each of auth-providers, connection and
   auth-broker, in any order, one open at a time per repository. Each: the
   transitional commit (§7), then the removal commit, then docs; merged
   without a release. Their changes reach npm with each package's next
   release, which then names `^2.2.0`.

*Why a minor:* two subpath exports, an optional-to-use `typesVersions`, a
module and a command whose arguments, output and statuses are unchanged; no
export removed, no type narrowed, no dependency added.

## 13. Tests, and the breaks that prove them

Every test meant to protect something is shown load-bearing: the break below
is made, the test goes red, the break is reverted. The PR names each.

**auth-errors**

| Test | Break → red |
|---|---|
| fixture table (`shapeCheck.test.ts`, now in-process): every breaking fixture reported for its rule only, with its count; every obeying file clean; every other case of today's file (the base by declaration, the impostor, the rewriting base, `ParameterBase`, the four trusted sites with empty lists, the base's own file scanned) | for each rule 1–8, delete the `report` call of one of its checks: that rule's fixture row |
| API usage: each `fail` path → `usage-error` with today's text; a broken program → `type-errors`; relative paths, empty rules, no `typescript`, a stated missing `project`/`sites` → `usage-error` | return `checked` with no findings for a missing base |
| no state between calls: a check, then a second over a root whose `package.json` name was changed in between, decides on the new name | move the package cache back to module level |
| `reportLines` of each status | drop the `cannot check:` line for a usage error |
| the packed command (D15) | map `usage-error` to exit 1; drop the usage line; print findings unsorted |
| the exports map: both subpaths by name, deep paths refused, both resolutions type-check | remove `./tables` from `exports`; remove the `typesVersions` entry |
| invariant 2 (§3, all three) | `export * from './shapeCheck'` in `src/index.ts`; an `import './tables'` in `words.ts`; a `readFileSync` at load in `allowlists.ts` |
| `tables` module: `rowsFor` throws naming table and value; `withRegions` replaces only the body and throws on missing or misordered markers; `markdownCell`; `tableWriteMode` (unset, `'1'`, `'1'` with `CI`, another value); `render` and `contract` are the main entry's and interfaces-auth's own objects | return the rows that exist from `rowsFor`; give `tables.ts` its own copy of `render` |
| kinds table: README equals the rendered table; 17 sections | change one word in `words.ts` |

**auth-providers**

| Test | Break → red |
|---|---|
| own tree with `SHAPE_CHECK` | add `as IAuthProviderError` in `src/` |
| each fixture with `SHAPE_CHECK` | remove a rule from `SHAPE_CHECK.rules` (that rule's fixture); remove `base` (usage error) |
| every fixture's rule is in `SHAPE_CHECK.rules` | remove `8` |
| the approved diagnostic sites; empty sites report exactly them | set `sites` to `null` in the constant (own tree reports 15) |
| README tables equal the rendered ones; three hand-edited rows differ | edit one row text in the helper |

**connection**: own tree (`as IAuthProviderError` in `src/`); each fixture by
its rule (remove the rule from the constant); site lists empty (add an entry).

**auth-broker**: each package's own root (a cast in its `src/`); each fixture
by its rule with each package's constant (remove the rule from that
constant).

**Every repository — the publishing gate (§6a).** A planted
`{} as IAuthProviderError` in `src/` makes the gate (`prepublishOnly`, or the
broker's `check`) exit non-zero; the gate assertion in the shape-check test
(each gate names `npm run test:shape`) goes red when `test:shape` is removed
from a gate, and with it removed the planted construct passes the gate.

## 14. How the goal is met

| Goal | Where |
|---|---|
| One implementation, no copies; reached through a published auth-errors; no copy, no comparison test | D1–D3, §11, §7 (the transitional test is deleted) |
| Each repository's Jest test with today's rules and options; every finding listed | §6, D7 |
| `npm test` and CI run it; no `lint:check` / `check` / `check:shape` calls a checking script | §6, §11 |
| Same findings, same tree, same files — each repository, both broker roots, each fixture | §7 |
| The published command keeps arguments, lines, statuses; a packed test proves it; a minor | §5, D15, §12 |
| Tables checked; the same code writes them back | D13 |
| Who owns what in a table | D9, D11, D12 |
| Words and values from one place | D10 (`contract`, `render`) |
| Unknown values still fail; prose kept | D10 (`rowsFor`), D12, D13 (`withRegions` touches only the bodies) |
| Nothing gets weaker: rules, fixtures by their rule alone, load-bearing breaks | D2, §6, §13; the shape check stays in every publishing gate, and is added where it was missing (D18, §6a) |
| Nothing cites a deleted document | D8 |
| **1 Registry only** | §11, §12: consumers bump to `^2.2.0` after the publish; lockfiles from the registry |
| **2 Nothing extra at run time** | D1, D3, §3 |
| **3 The rules do not change here** | D2, §7; a defect found is recorded in the PR and fixed in its own change |
| **4 No guessing about a repository** | D5: every path stated, absolute; no option for a rule's own scope |
| **5 No regex over the checked source** | D2: decisions stay on the compiler API and plain code; the port adds no regular expression. The existing regexes are kept as they are under invariant 3; whether that reading of invariant 5 holds is the user's call (§15) |

## 15. Not decided here

**Open for the user:**

- **Reading of invariant 5.** The script already applies regular expressions
  in places (`tools/check-provider-shape.mjs`): the test-path filter
  (`:273-275`), the base's extension (`:368`), rule 8's `Basic` value
  (`:1367-1375`), its secret names (`:1401-1403`), its encoding argument
  (`:1419`) and the `@types/node` crypto path (`:1508`). Each runs over a
  file path, or over a string the compiler API has already extracted (a
  literal's value, an identifier's name) — never over the text of a source
  file. This spec reads invariant 5 ("no regex over the checked source") as
  not covering these, and keeps them unchanged, because invariant 3 forbids
  changing what a rule decides here. If the user reads invariant 5 as
  covering them, replacing them with plain code is a separate change that
  must prove the same decisions on every fixture — not part of this one.

**Left to the plan:**

- Where exactly the broker's three new fixtures sit (one shared set or one
  per package) is the plan's choice, within §6's constraints.
- How the README test's failure message names the regenerating command (a
  thrown message or the test's title) is the plan's choice.
