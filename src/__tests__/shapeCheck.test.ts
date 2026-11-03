import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as typescript from 'typescript';
import {
  checkProviderShape,
  reportLines,
  type ShapeCheckOptions,
  type ShapeCheckReport,
  type ShapeFinding,
  type ShapeRule,
} from '../shapeCheck';

/**
 * The shape check, run in-process through the module. Each fixture under
 * `tools/__fixtures__/src` breaks exactly one rule and must be reported for
 * exactly that rule; the obeying files must be clean. This repository's own
 * sources, with its own site lists, must be clean, and its four assertion
 * sites are reported once the list is empty.
 */
const repo = join(__dirname, '..', '..');
const fixtures = join(repo, 'tools', '__fixtures__');
const fixtureSites = join(fixtures, 'sites');
const ALL_RULES: readonly ShapeRule[] = [1, 2, 3, 4, 5, 6, 7, 8];
/** The fixtures' base, named by declaration (relative to the fixture root). */
const FIXTURE_BASE = './src/auth/AuthProviderBase#AuthProviderBase';

/** The bound of each test and hook of this file. */
const perTest = { timeout: 120_000 };

const trees: string[] = [];

function scratch(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  trees.push(root);
  return root;
}

after(() => {
  for (const root of trees) rmSync(root, { recursive: true, force: true });
}, perTest);

/** The fixtures root with its project and site lists, and `overrides`. */
function onFixtures(overrides: Partial<ShapeCheckOptions>): ShapeCheckOptions {
  return {
    typescript,
    rules: ALL_RULES,
    root: fixtures,
    project: join(fixtures, 'tsconfig.json'),
    sites: fixtureSites,
    ...overrides,
  };
}

/** This repository, as its own check runs it, and `overrides`. */
function onRepo(overrides: Partial<ShapeCheckOptions>): ShapeCheckOptions {
  return {
    typescript,
    rules: [4, 6],
    root: repo,
    project: join(repo, 'tsconfig.json'),
    sites: join(repo, 'tools'),
    ...overrides,
  };
}

function findings(report: ShapeCheckReport): readonly ShapeFinding[] {
  if (report.status !== 'checked') {
    throw new Error(`not checked: ${reportLines(report).join('\n')}`);
  }
  return report.findings;
}

function usage(report: ShapeCheckReport): string {
  if (report.status !== 'usage-error') {
    throw new Error(`expected a usage error, got ${JSON.stringify(report)}`);
  }
  return report.message;
}

/** Whether `text` holds `first`, then `second` after it on the same line. */
function onOneLine(text: string, first: string, second: string): boolean {
  for (
    let at = text.indexOf(first);
    at !== -1;
    at = text.indexOf(first, at + 1)
  ) {
    const rest = text.slice(at + first.length);
    const end = rest.indexOf('\n');
    if ((end === -1 ? rest : rest.slice(0, end)).includes(second)) return true;
  }
  return false;
}

function fixtureFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtureFiles(join(dir, entry.name))
      : [relative(fixtures, join(dir, entry.name)).split(sep).join('/')],
  );
}

/** Each fixture: the one rule it breaks, and how many findings it holds. */
const BREAKING: Readonly<Record<string, readonly [ShapeRule, number]>> = {
  'src/rule1.ts': [1, 2],
  'src/rule1-structural.ts': [1, 2],
  'src/impostor/AuthProviderBase.ts': [1, 1],
  'src/impostor/provider.ts': [1, 1],
  'src/rule2.ts': [2, 9],
  'src/rule3.ts': [3, 1],
  'src/rule4-branded.ts': [4, 1],
  'src/rule4-site.ts': [4, 1],
  'src/rule4-casts.ts': [4, 7],
  'src/rule4-overload.ts': [4, 2],
  'src/rule4-deep.ts': [4, 1],
  'src/rule5.ts': [5, 2],
  'src/rule6.ts': [6, 2],
  'src/rule7.ts': [7, 3],
  'src/auth/rule8.ts': [8, 10],
  'src/clientAuthentication/rule8.ts': [8, 1],
  'src/clientAuthentication/rule8-secret.ts': [8, 2],
  'src/clientAuthentication/rule8-impostors.ts': [8, 4],
  'src/clientAuthentication/rule8-limits.ts': [8, 4],
  'src/clientAuthentication/rule8-reassigned.ts': [8, 1],
  'src/clientAuthentication/rule8-adapters.ts': [8, 3],
  'src/clientAuthentication/rule8-chains.ts': [8, 2],
};

const OBEYING = [
  'src/obeys.ts',
  'src/numbers.ts',
  'src/auth/AuthProviderBase.ts',
  'src/auth/tokenRequest.ts',
  'src/auth/prose.ts',
  'src/clientAuthentication/clientSecret.ts',
  'src/clientAuthentication/digest.ts',
  'src/clientAuthentication/fakeCrypto.ts',
  'src/credentials/BasicLike.ts',
];

/** Every finding of the fixtures under every rule, as the check reports it. */
const FIXTURE_REPORT: readonly string[] = [
  'src/auth/rule8.ts:3:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:3:19: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:8:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:11:22: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:14:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:17:16: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:24:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:28:11: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:32:13: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/auth/rule8.ts:36:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-adapters.ts:8:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-adapters.ts:17:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-adapters.ts:31:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-chains.ts:5:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-chains.ts:14:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-impostors.ts:9:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-impostors.ts:15:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-impostors.ts:19:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-impostors.ts:26:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-limits.ts:6:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-limits.ts:14:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-limits.ts:21:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-limits.ts:28:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-reassigned.ts:8:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-secret.ts:3:10: rule 8: a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8-secret.ts:7:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/clientAuthentication/rule8.ts:3:10: rule 8: a Basic authorization value outside legacyBasic and clientSecretBasic',
  'src/impostor/AuthProviderBase.ts:8:51: rule 1: a class implements IAuthProvider; a provider extends AuthProviderBase',
  'src/impostor/provider.ts:4:14: rule 1: a class satisfies IAuthProvider without extending AuthProviderBase',
  'src/rule1-structural.ts:5:14: rule 1: a class satisfies IAuthProvider without extending AuthProviderBase',
  'src/rule1-structural.ts:26:34: rule 1: a class satisfies IAuthProvider without extending AuthProviderBase',
  'src/rule1.ts:6:40: rule 1: a class implements IAuthProvider; a provider extends AuthProviderBase',
  'src/rule1.ts:27:65: rule 1: drop `implements IAuthProvider`: AuthProviderBase already implements it',
  'src/rule2.ts:7:3: rule 2: a class reaching AuthProviderBase declares prepare; AuthProviderBase owns the four methods',
  'src/rule2.ts:15:5: rule 2: a class reaching AuthProviderBase assigns this.establish; AuthProviderBase owns the four methods',
  'src/rule2.ts:20:15: rule 2: a class reaching AuthProviderBase declares authorize; AuthProviderBase owns the four methods',
  'src/rule2.ts:28:3: rule 2: a class reaching AuthProviderBase declares prepare; AuthProviderBase owns the four methods',
  'src/rule2.ts:36:5: rule 2: Object.assign writes rejected onto a class reaching AuthProviderBase; AuthProviderBase owns the four methods',
  'src/rule2.ts:37:5: rule 2: Object.defineProperty writes prepare onto a class reaching AuthProviderBase; AuthProviderBase owns the four methods',
  'src/rule2.ts:41:1: rule 2: Object.assign writes authorize onto a class reaching AuthProviderBase; AuthProviderBase owns the four methods',
  'src/rule2.ts:43:1: rule 2: a class reaching AuthProviderBase assigns NamedProvider.prototype.rejected; AuthProviderBase owns the four methods',
  'src/rule2.ts:51:5: rule 2: a class reaching AuthProviderBase assigns this.rejected; AuthProviderBase owns the four methods',
  'src/rule3.ts:6:10: rule 3: an object literal satisfies IAuthProvider; a provider is a class extending AuthProviderBase',
  'src/rule4-branded.ts:4:23: rule 4: a type assertion to a type of the contract (HttpStatus); only a listed site may assert',
  'src/rule4-casts.ts:11:22: rule 4: a type assertion to a type of the contract (IAuthProviderError); only a listed site may assert',
  'src/rule4-casts.ts:12:24: rule 4: a type assertion to a type of the contract (IAuthRefusal); only a listed site may assert',
  'src/rule4-casts.ts:13:24: rule 4: a type assertion to a type of the contract (AuthOutcome); only a listed site may assert',
  'src/rule4-casts.ts:14:22: rule 4: a type assertion to a type of the contract (Promise<AuthOutcome>); only a listed site may assert',
  'src/rule4-casts.ts:15:24: rule 4: a type assertion to a type of the contract (IAuthProviderFailure); only a listed site may assert',
  'src/rule4-casts.ts:16:24: rule 4: a type assertion to a type of the contract ({ readonly inner: IAuthProviderError }); only a listed site may assert',
  "src/rule4-casts.ts:17:20: rule 4: a type assertion to a type of the contract (Extract<IAuthProviderError, { kind: 'tls' }>); only a listed site may assert",
  'src/rule4-deep.ts:35:21: rule 4: a type assertion to a type of the contract ({ readonly far: L1; readonly near: Holder }); only a listed site may assert',
  'src/rule4-overload.ts:8:1: rule 4: an overload signature returns a type of the contract; its implementation is not checked against it',
  'src/rule4-overload.ts:13:1: rule 4: an overload signature returns a type of the contract; its implementation is not checked against it',
  'src/rule4-site.ts:5:37: rule 4: a type assertion to a type of the contract (HttpStatus); only a listed site may assert',
  'src/rule5.ts:5:12: rule 5: a spread of an error keeps its brand on a new object; relay the error as it is',
  'src/rule5.ts:9:28: rule 5: Object.assign copies an error, keeping its brand on another object; relay the error as it is',
  'src/rule6.ts:8:5: rule 6: diagnostics (issuer) passed outside the sites of diagnostic-sites.json (src/rule6.ts, samlRefusal)',
  'src/rule6.ts:13:22: rule 6: a builder reached through bind; call it directly',
  "src/rule7.ts:12:37: rule 7: guard's grant is not a function expression; it must be read inside the boundary",
  "src/rule7.ts:19:18: rule 7: a provider property read in guard's arguments, before the boundary; only this.#moments is",
  'src/rule7.ts:24:10: rule 7: guard reached through call; call it directly',
];

describe('the shape check: the fixtures', () => {
  let found: readonly ShapeFinding[];

  before(() => {
    found = findings(checkProviderShape(onFixtures({ base: FIXTURE_BASE })));
  }, perTest);

  it('lists every fixture in one of the two tables', perTest, () => {
    assert.deepEqual(
      fixtureFiles(join(fixtures, 'src')).sort(),
      [...Object.keys(BREAKING), ...OBEYING].sort(),
    );
  });

  it('reports every finding, in order and in its words', perTest, () => {
    assert.deepEqual(
      reportLines(checkProviderShape(onFixtures({ base: FIXTURE_BASE }))),
      FIXTURE_REPORT,
    );
  });

  for (const [file, [rule, count]] of Object.entries(BREAKING)) {
    it(`${file} is reported for its rule only`, perTest, () => {
      const mine = found.filter((finding) => finding.file === file);
      assert.deepEqual(
        mine.map((finding) => finding.rule),
        Array.from({ length: count }, () => rule),
      );
    });
  }

  for (const file of OBEYING) {
    it(`${file} is clean`, perTest, () => {
      assert.deepEqual(
        found.filter((finding) => finding.file === file),
        [],
      );
    });
  }

  it('reports `500 as HttpStatus` in any file', perTest, () => {
    assert.deepEqual(
      found
        .filter((finding) => finding.file === 'src/rule4-branded.ts')
        .map((finding) => [finding.line, finding.rule]),
      [[4, 4]],
    );
  });

  it(
    'tells a class beside the base to drop `implements IAuthProvider`',
    perTest,
    () => {
      assert.deepEqual(
        found
          .filter((finding) => finding.file === 'src/rule1.ts')
          .map((finding) => finding.what),
        [
          'a class implements IAuthProvider; a provider extends AuthProviderBase',
          'drop `implements IAuthProvider`: AuthProviderBase already implements it',
        ],
      );
    },
  );

  it('runs only the rules asked for', perTest, () => {
    const only = findings(checkProviderShape(onFixtures({ rules: [5] })));
    assert.ok(only.length > 0);
    assert.deepEqual(
      new Set(only.map((finding) => finding.rule)),
      new Set([5]),
    );
  });

  it('checks the files it is given, and only those', perTest, () => {
    const one = findings(
      checkProviderShape(
        onFixtures({
          base: FIXTURE_BASE,
          files: [
            join(fixtures, 'src', 'rule3.ts'),
            join(fixtures, 'src', 'obeys.ts'),
          ],
        }),
      ),
    );
    assert.deepEqual(
      one.map((finding) => [finding.file, finding.rule]),
      [['src/rule3.ts', 3]],
    );
  });

  it('counts a rule listed twice once, whatever the order', perTest, () => {
    const once = reportLines(
      checkProviderShape(onFixtures({ base: FIXTURE_BASE, rules: [4, 6] })),
    );
    assert.equal(once.filter((line) => line.includes(': rule 4: ')).length, 12);
    assert.equal(once.filter((line) => line.includes(': rule 6: ')).length, 2);
    assert.equal(new Set(once).size, once.length);
    for (const rules of [
      [4, 4, 6],
      [6, 4],
    ] as const) {
      assert.deepEqual(
        reportLines(
          checkProviderShape(onFixtures({ base: FIXTURE_BASE, rules })),
        ),
        once,
      );
    }
  });
});

describe('the shape check: this repository', () => {
  it('is clean with its own rules and site lists', perTest, () => {
    assert.deepEqual(reportLines(checkProviderShape(onRepo({}))), []);
  });

  it(
    'is clean under every rule (rules 1–3 against the fixtures’ base)',
    perTest,
    () => {
      assert.deepEqual(
        reportLines(
          checkProviderShape(
            onRepo({
              rules: ALL_RULES,
              base: './tools/__fixtures__/src/auth/AuthProviderBase#AuthProviderBase',
            }),
          ),
        ),
        [],
      );
    },
  );

  it('reports the four trusted sites once the list is empty', perTest, () => {
    const empty = scratch('shape-sites-');
    assert.deepEqual(
      findings(checkProviderShape(onRepo({ rules: [4], sites: empty }))).map(
        (finding) => `${finding.file} ${finding.rule}`,
      ),
      [
        'src/mint.ts 4',
        'src/numbers.ts 4',
        'src/numbers.ts 4',
        'src/numbers.ts 4',
      ],
    );
  });
});

describe('the shape check: the base, by declaration', () => {
  it(
    'a same-named local class, in a file of that name, exempts nothing',
    perTest,
    () => {
      assert.deepEqual(
        findings(
          checkProviderShape(
            onFixtures({
              rules: [1, 2, 3],
              base: FIXTURE_BASE,
              files: [
                join(fixtures, 'src', 'impostor', 'AuthProviderBase.ts'),
                join(fixtures, 'src', 'impostor', 'provider.ts'),
              ],
            }),
          ),
        ).map((finding) => [finding.file, finding.rule, finding.what]),
        [
          [
            'src/impostor/AuthProviderBase.ts',
            1,
            'a class implements IAuthProvider; a provider extends AuthProviderBase',
          ],
          [
            'src/impostor/provider.ts',
            1,
            'a class satisfies IAuthProvider without extending AuthProviderBase',
          ],
        ],
      );
    },
  );

  it(
    'the base named is verified: each moment only returns guard(…, () => …, () => …)',
    perTest,
    () => {
      assert.deepEqual(
        findings(
          checkProviderShape(
            onFixtures({
              rules: [1],
              base: './bases/AuthProviderBase#AuthProviderBase',
              files: [join(fixtures, 'bases', 'AuthProviderBase.ts')],
            }),
          ),
        ).map((finding) => [finding.file, finding.rule, finding.what]),
        ['prepare', 'establish', 'authorize', 'rejected'].map((moment) => [
          'bases/AuthProviderBase.ts',
          1,
          `AuthProviderBase.${moment} must only return guard(this.#moments.${moment}, () => …, () => …)`,
        ]),
      );
    },
  );

  it(
    'the base may not replace a verified moment: every write is refused under rule 1',
    perTest,
    () => {
      const suffix = '; its moments only delegate to guard';
      for (const rules of [[1], [2], [3]] as const) {
        assert.deepEqual(
          findings(
            checkProviderShape(
              onFixtures({
                rules,
                base: './bases/RewritingBase#AuthProviderBase',
                files: [join(fixtures, 'bases', 'RewritingBase.ts')],
              }),
            ),
          ).map((finding) => [finding.file, finding.rule, finding.what]),
          [
            'AuthProviderBase assigns this.authorize',
            'AuthProviderBase assigns this.prepare',
            'Object.assign writes rejected onto AuthProviderBase',
            'Object.defineProperty writes establish onto AuthProviderBase',
            'AuthProviderBase assigns AuthProviderBase.prototype.prepare',
            'Object.assign writes authorize onto AuthProviderBase',
            'Object.defineProperty writes rejected onto AuthProviderBase',
          ].map((what) => ['bases/RewritingBase.ts', 1, `${what}${suffix}`]),
        );
      }
    },
  );

  it(
    'the base’s own file is scanned for its writes even when only another file is checked',
    perTest,
    () => {
      const run = findings(
        checkProviderShape(
          onFixtures({
            rules: [1],
            base: './bases/RewritingBase#AuthProviderBase',
            files: [join(fixtures, 'src', 'auth', 'prose.ts')],
          }),
        ),
      );
      assert.equal(run.length, 7);
      for (const finding of run) {
        assert.equal(finding.file, 'bases/RewritingBase.ts');
        assert.equal(finding.rule, 1);
      }
    },
  );

  it(
    'the base may not declare a moment as a constructor parameter property',
    perTest,
    () => {
      assert.deepEqual(
        findings(
          checkProviderShape(
            onFixtures({
              rules: [1],
              base: './bases/ParameterBase#AuthProviderBase',
              files: [join(fixtures, 'bases', 'ParameterBase.ts')],
            }),
          ),
        ).map((finding) => [finding.file, finding.rule, finding.what]),
        [
          [
            'bases/ParameterBase.ts',
            1,
            'AuthProviderBase declares establish as a constructor parameter property; its moments only delegate to guard',
          ],
        ],
      );
    },
  );

  it(
    'a provider of the named base is clean; with another base named, it reaches none',
    perTest,
    () => {
      const obeys = join(fixtures, 'src', 'obeys.ts');
      assert.deepEqual(
        reportLines(
          checkProviderShape(
            onFixtures({
              rules: [1, 2, 3],
              base: FIXTURE_BASE,
              files: [obeys],
            }),
          ),
        ),
        [],
      );
      assert.equal(
        findings(
          checkProviderShape(
            onFixtures({
              rules: [1],
              base: './src/impostor/AuthProviderBase#AuthProviderBase',
              files: [obeys],
            }),
          ),
        ).some((finding) => finding.file === 'src/obeys.ts'),
        true,
      );
    },
  );

  for (const [_label, overrides] of [
    ['rules 1–3 without a base', { rules: [1] }],
    ['rule 2 without a base', { rules: [2] }],
    ['rule 3 without a base', { rules: [3] }],
    [
      'a base without #export',
      { rules: [1], base: './src/auth/AuthProviderBase' },
    ],
    [
      'a module that does not resolve',
      { rules: [1], base: './src/auth/Nope#AuthProviderBase' },
    ],
    [
      'a package that does not resolve',
      { rules: [1], base: '@mcp-abap-adt/nope#AuthProviderBase' },
    ],
    ['an export that is not there', { rules: [1], base: `${FIXTURE_BASE}X` }],
    [
      'an export that is not a class',
      { rules: [1], base: '@mcp-abap-adt/interfaces-auth#IAuthProvider' },
    ],
  ] as const) {
    it(`refuses ${_label}`, perTest, () => {
      assert.ok(
        usage(checkProviderShape(onFixtures(overrides))).includes('--base'),
      );
    });
  }
});

describe('the shape check: usage', () => {
  it('refuses to run without rules', perTest, () => {
    const { rules: _none, ...options } = onRepo({});
    assert.equal(
      usage(checkProviderShape(options as unknown as ShapeCheckOptions)),
      '--rules is required',
    );
  });

  it('refuses a rule it does not know', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onRepo({ rules: [4, 9] as unknown as readonly ShapeRule[] }),
        ),
      ),
      'unknown rule 9',
    );
  });

  it('refuses a file that does not exist', perTest, () => {
    assert.ok(
      onOneLine(
        usage(
          checkProviderShape(
            onRepo({ rules: [4], files: [join(repo, 'src', 'nope.ts')] }),
          ),
        ),
        'no such file: ',
        'nope.ts',
      ),
    );
  });

  it('refuses a root with nothing to check', perTest, () => {
    const root = scratch('shape-empty-');
    assert.ok(
      usage(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: null,
        }),
      ).includes('no file to check'),
    );
  });

  it(
    'refuses rules 4 and 5 without the brands of interfaces-auth 6',
    perTest,
    () => {
      const root = scratch('shape-old-');
      const contract = join(
        root,
        'node_modules',
        '@mcp-abap-adt',
        'interfaces-auth',
      );
      mkdirSync(contract, { recursive: true });
      writeFileSync(
        join(contract, 'package.json'),
        JSON.stringify({
          name: '@mcp-abap-adt/interfaces-auth',
          version: '5.0.0',
          types: 'index.d.ts',
        }),
      );
      writeFileSync(
        join(contract, 'index.d.ts'),
        'export interface IAuthRefusal { readonly reason: string }\n',
      );
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: 'node16',
            moduleResolution: 'node16',
          },
          include: ['src'],
        }),
      );
      mkdirSync(join(root, 'src'));
      writeFileSync(
        join(root, 'src', 'old.ts'),
        "import type { IAuthRefusal } from '@mcp-abap-adt/interfaces-auth';\nexport const r = {} as IAuthRefusal;\n",
      );
      const options = {
        typescript,
        root,
        project: join(root, 'tsconfig.json'),
        sites: null,
      };
      for (const rules of [[4], [5]] as const) {
        assert.ok(
          onOneLine(
            usage(checkProviderShape({ ...options, rules })),
            'need the brands ',
            ' not found: minted',
          ),
        );
      }
      assert.deepEqual(
        reportLines(checkProviderShape({ ...options, rules: [6] })),
        [],
      );
    },
  );

  it('refuses a program that does not type-check', perTest, () => {
    const root = scratch('shape-broken-');
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
    );
    mkdirSync(join(root, 'src'));
    writeFileSync(
      join(root, 'src', 'broken.ts'),
      "export const n: number = 'a';\n",
    );
    const report = checkProviderShape({
      typescript,
      rules: [4],
      root,
      project: join(root, 'tsconfig.json'),
      sites: null,
    });
    assert.equal(report.status, 'type-errors');
    assert.ok(reportLines(report).join('\n').includes('broken.ts'));
  });
});

describe('the shape check: no state between calls', () => {
  it(
    'decides on a package by its name as it is when the check runs',
    perTest,
    () => {
      const root = scratch('shape-state-');
      const installed = realpathSync(
        join(repo, 'node_modules', '@mcp-abap-adt', 'interfaces-auth'),
      );
      const copy = join(
        root,
        'node_modules',
        '@mcp-abap-adt',
        'interfaces-auth',
      );
      mkdirSync(dirname(copy), { recursive: true });
      cpSync(installed, copy, { recursive: true, dereference: true });
      mkdirSync(join(root, 'src'));
      writeFileSync(
        join(root, 'src', 'forged.ts'),
        "import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';\nexport const forged = {} as IAuthProviderError;\n",
      );
      const options: ShapeCheckOptions = {
        typescript,
        rules: [4],
        root,
        project: null,
        sites: null,
      };
      const first = findings(checkProviderShape(options));
      assert.deepEqual(
        first.map((finding) => [finding.file, finding.rule]),
        [['src/forged.ts', 4]],
      );
      const manifest = join(copy, 'package.json');
      writeFileSync(
        manifest,
        JSON.stringify({
          ...(JSON.parse(readFileSync(manifest, 'utf8')) as object),
          name: '@example/not-interfaces-auth',
        }),
      );
      assert.equal(
        usage(checkProviderShape(options)),
        'rules 4 and 5 need the brands of @mcp-abap-adt/interfaces-auth 6.0.0 or later; not found: minted, httpStatusBrand, countBrand, portBrand',
      );
    },
  );
});

describe('the shape check: the published command', () => {
  it('is in the package, without its fixtures or site lists', perTest, () => {
    const output = execFileSync(
      'npm',
      ['pack', '--dry-run', '--json', '--ignore-scripts'],
      { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const [pack] = JSON.parse(output) as [
      { readonly files: readonly { readonly path: string }[] },
    ];
    const tools = pack.files
      .map((file) => file.path)
      .filter((path) => path.startsWith('tools/'));
    assert.deepEqual(tools, ['tools/check-provider-shape.mjs']);
  });
});

describe('the shape check: the publishing gate', () => {
  const scripts = (
    JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    }
  ).scripts;

  it('test:shape runs this file', perTest, () => {
    assert.equal(
      scripts['test:shape'],
      'npm run --silent test:build && node --test .test-build/__tests__/shapeCheck.test.js',
    );
  });

  it('prepublishOnly names npm run test:shape', perTest, () => {
    assert.ok(scripts.prepublishOnly?.includes('npm run test:shape'));
  });

  it('lint:check is Biome alone: it runs no other command', perTest, () => {
    const lint = scripts['lint:check'] ?? '';
    assert.equal(lint.startsWith('biome check '), true);
    for (const joiner of ['&', ';', '|']) {
      assert.equal(lint.includes(joiner), false);
    }
  });
});
