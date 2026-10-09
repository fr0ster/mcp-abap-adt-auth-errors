# Task 8 report
Status: done. Added test:shape, prepublishOnly = build && test:shape, gate tests in shapeCheck.test.ts, CLAUDE.md Build Commands.
Release workflow: unchanged (it already runs npm test, which includes shapeCheck.test.ts; brief gives no step).
Plant run (src/forged.ts: `export const forged = {} as IAuthProviderError;`), `npm run prepublishOnly`: exit 1; finding:
  src/forged.ts:3:23: rule 4: a type assertion to a type of the contract (IAuthProviderError); only a listed site may assert
Plant removed, prepublishOnly: exit 0, 66 tests passed.
Break: test:shape removed from prepublishOnly -> gate test red (1 failed, 2 passed); with plant present prepublishOnly exit 0. Restored by copy.
Gates: build, test:check, lint:check exit 0; npm test 22 suites, 2793 tests passed.
Note: lint:check still names tools/check-provider-shape.mjs as a Biome target, so the gate test asserts "Biome alone" (no other command), not "names no tools/ path".
