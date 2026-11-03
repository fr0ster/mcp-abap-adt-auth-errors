# Plan: the test suites run on `node:test` — auth-errors

Goal: `2026-11-03-node-test-goal.md`. Spec: `2026-11-03-node-test-spec.md`. The spec binds, and
each step names the spec section it carries out.

## Baseline

1. **Record what the suites prove today.** Run the Jest suite and keep, per test file, its
   number of tests and the full list of test titles. These are the before-list that step 9
   compares with (spec §3, the goal's first invariant). The counts go into this plan.

## The runner

2. **The test build** (spec §2).
   - Add `tsconfig.test.json`: emits the sources and tests into `.test-build/`, which git
     ignores. It is the type check of the tests too.
   - Scripts:
     - `test`: build the tests, then `node --test` over `.test-build/**/*.test.js`;
     - `test:check`: the type check, through an npm script instead of `npx tsc`;
     - `test:shape`: build, then run the shape check file alone.
   - Keep `prepublishOnly` calling `test:shape`.
3. **The matchers module** (spec §3): `src/__tests__/helpers/expect.ts`.
   - The asymmetric matchers this repository uses, written test first, with their own tests.
   - A function that reads a mock's call arguments.
   - Only what the suites use: if a matcher has no call site here, it is not written.

## The suites

4. **Move the files that use neither mocks nor matchers.**
   - Structure: `describe`, `it`, the hooks, `.skip` / `.todo` from `node:test`, and loops
     instead of `each`.
   - Assertions: `node:assert/strict`.
   - One commit per few files. Each commit is green under `npm test`, and its file's titles
     equal the before-list.
5. **Move `sharedAttempt.test.ts` and `sharedAttemptReentrancy.test.ts`** to `mock.fn`, with
   calls read through the matchers module.
6. **Move the suites that read the build or the packed tarball** (`builtPackage.ts`,
   `packedConsumer.ts`, `exportsMap.test.ts`, `mainEntryLoadsNothing.test.ts`). They build
   `dist` and pack before they read, as they do today, in their own `before`.
7. **Move the shape check** (`shapeCheck.test.ts`, `shapeCheckApi`, `shapeCheckCommand`).
   `test:shape` runs it alone.

## Cut Jest out

8. **Remove the old setup.**
   - Delete `jest.config.js`.
   - Remove `jest`, `jest-util`, `ts-jest` and `@types/jest` from the devDependencies.
   - Remove `NODE_OPTIONS=--experimental-vm-modules` from the scripts.
   - Regenerate the lockfile with npm. Check that it holds no link and resolves everything
     from the registry, and that `npm audit` is clean.
9. **Prove nothing was lost.**
   - The after-list of titles per file equals the before-list of step 1. Any difference is
     named in the PR, with the case that replaces it.
   - Break one assertion in a moved file on purpose, watch `npm test` go red, and revert.
   - Check that a Jest-only global (`expect`, `jest`) no longer resolves in the tests:
     `test:check` fails on one if it is put back.

## Release

10. **Docs.**
    - The README and CLAUDE.md lines on running tests. The CLAUDE.md text goes to the owner
      for approval.
    - The CHANGELOG entry, a patch: nothing in the package changes, only its development
      tooling.
11. **Run CI's step list locally**, and make sure the workflow runs the new scripts. Then Codex
    review and CI, and the owner's review.
12. **Delete the goal, spec and plan** before the release commit. Put what they still owe
    into the PR description: the order of the next repositories and the seams auth-broker
    will need. Then wait for the owner's merge and tag, and the publish.
