import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it, mock } from 'node:test';
import * as typescript from 'typescript';
import {
  checkProviderShape,
  formatFinding,
  reportLines,
  type ShapeCheckOptions,
  type ShapeCheckReport,
} from '../shapeCheck';

/**
 * The shape check's API: what it refuses, and how, before any rule runs.
 * Each refusal the command reports with exit 2 is a `usage-error` carrying
 * the command's own words; the refusals only a caller of the API can meet
 * name the option; a program that does not type-check is `type-errors`.
 * The function writes to no stream and reads no environment variable.
 */
const repo = join(__dirname, '..', '..');
const fixtures = join(repo, 'tools', '__fixtures__');
const fixtureSites = join(fixtures, 'sites');
const FIXTURE_BASE = './src/auth/AuthProviderBase#AuthProviderBase';
const INSTALLED_CONTRACT = join(
  repo,
  'node_modules',
  '@mcp-abap-adt',
  'interfaces-auth',
);

/** The bound of each test and hook of this file. */
const perTest = { timeout: 120_000 };

const trees: string[] = [];

/** A temporary tree holding `files` (path relative to it → content). */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'shape-api-'));
  trees.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Links the installed interfaces-auth into `root`'s node_modules. */
function linkContract(root: string): void {
  const scope = join(root, 'node_modules', '@mcp-abap-adt');
  mkdirSync(scope, { recursive: true });
  symlinkSync(INSTALLED_CONTRACT, join(scope, 'interfaces-auth'), 'dir');
}

after(() => {
  for (const root of trees) rmSync(root, { recursive: true, force: true });
}, perTest);

/** The fixtures root, as the command resolves it, with `overrides`. */
function onFixtures(overrides: Partial<ShapeCheckOptions>): ShapeCheckOptions {
  return {
    typescript,
    rules: [6],
    root: fixtures,
    project: join(fixtures, 'tsconfig.json'),
    sites: fixtureSites,
    ...overrides,
  };
}

function usage(report: ShapeCheckReport): string {
  if (report.status !== 'usage-error') {
    throw new Error(`expected a usage error, got ${JSON.stringify(report)}`);
  }
  return report.message;
}

const STRICT_TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: 'node16',
    moduleResolution: 'node16',
  },
  include: ['src'],
});

describe('the shape check API: the command’s refusals, in its words', () => {
  it('without rules: --rules is required', perTest, () => {
    const options = { ...onFixtures({}), rules: undefined };
    assert.equal(
      usage(checkProviderShape(options as unknown as ShapeCheckOptions)),
      '--rules is required',
    );
  });

  it('a rule it does not know', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({
            rules: [4, 9] as unknown as ShapeCheckOptions['rules'],
          }),
        ),
      ),
      'unknown rule 9',
    );
  });

  it('a base that is not <module>#<export>', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({ rules: [1], base: './src/auth/AuthProviderBase' }),
        ),
      ),
      '--base must be <module>#<export>: ./src/auth/AuthProviderBase',
    );
  });

  for (const [rule] of [[1], [2], [3]] as const) {
    it(`rule ${rule} without a base`, perTest, () => {
      assert.equal(
        usage(
          checkProviderShape(
            onFixtures({ rules: [rule as 1 | 2 | 3] as const }),
          ),
        ),
        'rules 1, 2 and 3 need --base <module>#AuthProviderBase: the base, by declaration',
      );
    });
  }

  it('a base module that does not resolve', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({ rules: [1], base: './src/auth/Nope#AuthProviderBase' }),
        ),
      ),
      `--base: ./src/auth/Nope does not resolve from ${fixtures}`,
    );
  });

  it('a base package that does not resolve', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({
            rules: [1],
            base: '@mcp-abap-adt/nope#AuthProviderBase',
          }),
        ),
      ),
      `--base: @mcp-abap-adt/nope does not resolve from ${fixtures}`,
    );
  });

  it('a base export that is not there', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({ rules: [1], base: `${FIXTURE_BASE}X` }),
        ),
      ),
      `--base: ${FIXTURE_BASE}X exports no AuthProviderBaseX`,
    );
  });

  it('a base export that is not a class', perTest, () => {
    assert.equal(
      usage(
        checkProviderShape(
          onFixtures({
            rules: [1],
            base: '@mcp-abap-adt/interfaces-auth#IAuthProvider',
          }),
        ),
      ),
      '--base: IAuthProvider of @mcp-abap-adt/interfaces-auth#IAuthProvider is not a class',
    );
  });

  it('a base file that is not a module of the program', perTest, () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'base.js': 'class AuthProviderBase {}\n',
    });
    linkContract(root);
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [1],
          root,
          project: null,
          sites: null,
          base: './base.js#AuthProviderBase',
        }),
      ),
      '--base: ./base.js#AuthProviderBase is not a module',
    );
  });

  it('a file that does not exist', perTest, () => {
    const missing = join(repo, 'src', 'nope.ts');
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [4],
          root: repo,
          project: join(repo, 'tsconfig.json'),
          sites: join(repo, 'tools'),
          files: [missing],
        }),
      ),
      `no such file: ${missing}`,
    );
  });

  it('a root with nothing to check', perTest, () => {
    const root = tree({});
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: null,
        }),
      ),
      `no file to check under ${join(root, 'src')}`,
    );
  });

  it('rules 4 and 5 without the brands of interfaces-auth 6', perTest, () => {
    const root = tree({
      'node_modules/@mcp-abap-adt/interfaces-auth/package.json': JSON.stringify(
        {
          name: '@mcp-abap-adt/interfaces-auth',
          version: '5.0.0',
          types: 'index.d.ts',
        },
      ),
      'node_modules/@mcp-abap-adt/interfaces-auth/index.d.ts':
        'export interface IAuthRefusal { readonly reason: string }\n',
      'tsconfig.json': STRICT_TSCONFIG,
      'src/old.ts':
        "import type { IAuthRefusal } from '@mcp-abap-adt/interfaces-auth';\nexport const r = {} as IAuthRefusal;\n",
    });
    const options: ShapeCheckOptions = {
      typescript,
      rules: [4],
      root,
      project: join(root, 'tsconfig.json'),
      sites: null,
    };
    const refusal =
      'rules 4 and 5 need the brands of @mcp-abap-adt/interfaces-auth 6.0.0 or later; not found: minted, httpStatusBrand, countBrand, portBrand';
    assert.equal(usage(checkProviderShape(options)), refusal);
    assert.equal(
      usage(checkProviderShape({ ...options, rules: [5] })),
      refusal,
    );
    assert.deepEqual(checkProviderShape({ ...options, rules: [6] }), {
      status: 'checked',
      findings: [],
    });
  });

  it('rules 1 and 3 where interfaces-auth does not resolve', perTest, () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'base.ts': 'export class AuthProviderBase {}\n',
    });
    for (const rule of [1, 3] as const) {
      assert.equal(
        usage(
          checkProviderShape({
            typescript,
            rules: [rule],
            root,
            project: null,
            sites: null,
            base: './base#AuthProviderBase',
          }),
        ),
        `rules 1 and 3 need @mcp-abap-adt/interfaces-auth, which does not resolve from ${root}`,
      );
    }
  });

  it('a file to check that is not in the program', perTest, () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.txt': 'x',
    });
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: null,
          files: [join(root, 'src', 'a.txt')],
        }),
      ),
      'a file to check is not in the program',
    );
  });

  for (const [_label, content, expected] of [
    ['not JSON', '{', (path: string) => `${path} is not JSON`],
    ['not an array', '{}', (path: string) => `${path} is not an array`],
    [
      'an entry without a string function',
      JSON.stringify([{ file: 'src/a.ts' }]),
      (path: string) => `${path}: every entry needs a string function`,
    ],
  ] as const) {
    it(`an assertion site list that is ${_label}`, perTest, () => {
      const root = tree({
        'src/a.ts': 'export const a = 1;\n',
        'tools/assertion-sites.json': content,
      });
      const path = join(root, 'tools', 'assertion-sites.json');
      assert.equal(
        usage(
          checkProviderShape({
            typescript,
            rules: [6],
            root,
            project: null,
            sites: join(root, 'tools'),
          }),
        ),
        expected(path),
      );
    });
  }

  it('a diagnostic site list whose entry has no string field', perTest, () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'tools/diagnostic-sites.json': JSON.stringify([
        { file: 'src/a.ts', function: 'f', field: 1 },
      ]),
    });
    const path = join(root, 'tools', 'diagnostic-sites.json');
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: join(root, 'tools'),
        }),
      ),
      `${path}: every entry needs a string field`,
    );
  });

  it(
    'a project with an unknown compiler option: its diagnostics, as text',
    perTest,
    () => {
      const root = tree({
        'tsconfig.json': '{"compilerOptions":{"nope":1}}',
        'src/a.ts': 'export const a = 1;\n',
      });
      assert.equal(
        usage(
          checkProviderShape({
            typescript,
            rules: [6],
            root,
            project: join(root, 'tsconfig.json'),
            sites: null,
          }),
        ),
        "tsconfig.json(1,21): error TS5023: Unknown compiler option 'nope'.\n",
      );
    },
  );

  it('a project that cannot be read', perTest, () => {
    const root = tree({ 'src/a.ts': 'export const a = 1;\n' });
    assert.equal(
      usage(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: join(root, 'src'),
          sites: null,
        }),
      ),
      `Cannot read file '${join(root, 'src')}'.`,
    );
  });
});

describe('the shape check API: a program that does not type-check', () => {
  it('is type-errors, the diagnostics relative to the root', perTest, () => {
    const root = tree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true },
        include: ['src'],
      }),
      'src/broken.ts': "export const n: number = 'a';\n",
    });
    const report = checkProviderShape({
      typescript,
      rules: [4],
      root,
      project: join(root, 'tsconfig.json'),
      sites: null,
    });
    assert.deepEqual(report, {
      status: 'type-errors',
      diagnostics:
        "src/broken.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    });
  });
});

describe('the shape check API: refusals of its own, naming the option', () => {
  const root = fixtures;
  const base = onFixtures({});

  for (const [_label, option, overrides] of [
    ['no typescript', 'typescript', { typescript: undefined }],
    ['a typescript that is not the module', 'typescript', { typescript: {} }],
    ['an empty rule list', 'rules', { rules: [] }],
    ['rules that are not a list', 'rules', { rules: '4' }],
    ['a rule that is not a number', 'rules', { rules: [4, '6'] }],
    ['a relative root', 'root', { root: 'tools/__fixtures__' }],
    ['a root not given', 'root', { root: undefined }],
    ['a relative project', 'project', { project: 'tsconfig.json' }],
    ['a project not stated', 'project', { project: undefined }],
    [
      'a stated project that does not exist',
      'project',
      { project: join(root, 'nope.json') },
    ],
    ['a relative sites', 'sites', { sites: 'sites' }],
    ['sites not stated', 'sites', { sites: undefined }],
    [
      'a stated sites directory that does not exist',
      'sites',
      { sites: join(root, 'nope') },
    ],
    ['a relative file', 'files', { files: ['src/obeys.ts'] }],
    ['files that are not a list', 'files', { files: 'src/obeys.ts' }],
    ['a base that is not a string', 'base', { base: 1 }],
  ] as const) {
    it(`${_label}`, perTest, () => {
      const message = usage(
        checkProviderShape({ ...base, ...overrides } as ShapeCheckOptions),
      );
      assert.equal(message.startsWith(`${option}: `), true);
    });
  }

  it(
    'a stated sites directory holding one list only is checked',
    perTest,
    () => {
      const root = tree({
        'src/a.ts': 'export const a = 1;\n',
        'tools/assertion-sites.json': '[]',
      });
      assert.deepEqual(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: join(root, 'tools'),
        }),
        { status: 'checked', findings: [] },
      );
      assert.equal(
        usage(
          checkProviderShape({
            typescript,
            rules: [6],
            root,
            project: null,
            sites: join(root, 'elsewhere'),
          }),
        ),
        `sites: ${join(root, 'elsewhere')} does not exist`,
      );
    },
  );
});

describe('the shape check API: no project', () => {
  it('checks the files given, under the strict defaults', perTest, () => {
    const root = tree({
      'src/clean.ts': 'export const a = 1;\n',
      'src/implicit.ts': 'export function f(x) {\n  return x;\n}\n',
    });
    assert.deepEqual(
      checkProviderShape({
        typescript,
        rules: [6],
        root,
        project: null,
        sites: null,
        files: [join(root, 'src', 'clean.ts')],
      }),
      { status: 'checked', findings: [] },
    );
    const strict = checkProviderShape({
      typescript,
      rules: [6],
      root,
      project: null,
      sites: null,
      files: [join(root, 'src', 'implicit.ts')],
    });
    assert.equal(strict.status, 'type-errors');
    assert.ok(
      strict.status === 'type-errors' &&
        strict.diagnostics.startsWith('src/implicit.ts(1,19): error TS7006: '),
    );
  });

  it(
    'finds global types in the root’s own @types, wherever the process runs',
    perTest,
    () => {
      const root = tree({
        'node_modules/@types/foo/index.d.ts':
          'declare var fooGlobal: number;\n',
        'src/a.ts': 'export const a: number = fooGlobal;\n',
      });
      assert.notEqual(process.cwd(), root);
      assert.deepEqual(
        checkProviderShape({
          typescript,
          rules: [6],
          root,
          project: null,
          sites: null,
        }),
        { status: 'checked', findings: [] },
      );
    },
  );

  it('without files, checks every file under <root>/src', perTest, () => {
    const root = tree({
      'src/clean.ts': 'export const a = 1;\n',
      'src/deep/implicit.ts': 'export function f(x) {\n  return x;\n}\n',
      'outside.ts': 'export function g(y) {\n  return y;\n}\n',
    });
    const report = checkProviderShape({
      typescript,
      rules: [6],
      root,
      project: null,
      sites: null,
    });
    // One line: the prefix, then no line break until the final one.
    assert.ok(
      report.status === 'type-errors' &&
        report.diagnostics.startsWith(
          'src/deep/implicit.ts(1,19): error TS7006: ',
        ) &&
        report.diagnostics.indexOf('\n') === report.diagnostics.length - 1,
    );
  });
});

describe('reportLines and formatFinding', () => {
  const finding = {
    file: 'src/a.ts',
    line: 3,
    column: 7,
    rule: 4,
    what: 'a type assertion to IAuthProviderError',
  } as const;

  it('formats a finding as the command prints it', perTest, () => {
    assert.equal(
      formatFinding(finding),
      'src/a.ts:3:7: rule 4: a type assertion to IAuthProviderError',
    );
  });

  it('a checked report: one line per finding, in order', perTest, () => {
    const second = { ...finding, file: 'src/b.ts', rule: 6 as const };
    assert.deepEqual(
      reportLines({ status: 'checked', findings: [finding, second] }),
      [formatFinding(finding), formatFinding(second)],
    );
    assert.deepEqual(reportLines({ status: 'checked', findings: [] }), []);
  });

  it('a usage error: why nothing could be checked', perTest, () => {
    assert.deepEqual(
      reportLines({ status: 'usage-error', message: '--rules is required' }),
      ['cannot check: --rules is required'],
    );
  });

  it('type errors: the sentence, then each diagnostic line', perTest, () => {
    assert.deepEqual(
      reportLines({
        status: 'type-errors',
        diagnostics:
          'src/a.ts(1,1): error TS1: one.\nsrc/b.ts(2,2): error TS2: two.\n',
      }),
      [
        'cannot check: the program does not type-check',
        'src/a.ts(1,1): error TS1: one.',
        'src/b.ts(2,2): error TS2: two.',
      ],
    );
  });
});

describe('the shape check API: no stream, no environment', () => {
  it('writes nothing and reads no environment variable', perTest, () => {
    const broken = tree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true },
        include: ['src'],
      }),
      'src/broken.ts': "export const n: number = 'a';\n",
    });
    const writes: string[] = [];
    const reads: PropertyKey[] = [];
    const stdout = mock.method(process.stdout, 'write', (chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    const stderr = mock.method(process.stderr, 'write', (chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    const env = process.env;
    process.env = new Proxy(env, {
      get(target, key, receiver) {
        reads.push(key);
        return Reflect.get(target, key, receiver);
      },
      has(target, key) {
        reads.push(key);
        return Reflect.has(target, key);
      },
      ownKeys(target) {
        reads.push('<keys>');
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        reads.push(key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    let reports: ShapeCheckReport[];
    try {
      reports = [
        checkProviderShape(onFixtures({ rules: [4, 6] })),
        checkProviderShape(
          onFixtures({ rules: [1], base: `${FIXTURE_BASE}X` }),
        ),
        checkProviderShape({
          typescript,
          rules: [4],
          root: broken,
          project: join(broken, 'tsconfig.json'),
          sites: null,
        }),
      ];
    } finally {
      process.env = env;
      stdout.mock.restore();
      stderr.mock.restore();
    }
    assert.deepEqual(
      reports.map((report) => report.status),
      ['checked', 'usage-error', 'type-errors'],
    );
    assert.deepEqual(writes, []);
    assert.deepEqual(reads, []);
  });
});
