import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import * as typescript from 'typescript';
import {
  checkProviderShape,
  reportLines,
  type ShapeCheckOptions,
  type ShapeCheckReport,
} from '../shapeCheck';

/**
 * Transitional: the 2.1.1 script, held under `tools/previous/`, the module
 * and the command over it (`npm run build` first: the command loads the
 * built module by name), run on the same arguments, decide the same — the
 * command byte for byte. Removed together with the held script.
 */
const repo = join(__dirname, '..', '..');
const previous = join(repo, 'tools', 'previous', 'check-provider-shape.mjs');
const command = join(repo, 'tools', 'check-provider-shape.mjs');
const fixtures = join(repo, 'tools', '__fixtures__');
const fixtureSites = join(fixtures, 'sites');
const FIXTURE_BASE = './src/auth/AuthProviderBase#AuthProviderBase';
const USAGE =
  'usage: check-provider-shape.mjs --rules <n,…> [--base <module>#AuthProviderBase] [--root <dir>] [--project <tsconfig>] [--sites <dir>] [files…]';
const TYPE_ERRORS = 'the shape check needs a program that type-checks:\n';

jest.setTimeout(180_000);

interface ScriptRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function run(file: string, args: readonly string[]): ScriptRun {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** The script's arguments as the command resolves them (cwd: the repo). */
function resolved(args: readonly string[]): ShapeCheckOptions {
  const named: Record<string, string> = {};
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg.startsWith('--')) {
      named[arg.slice(2)] = args[i + 1] as string;
      i += 1;
    } else {
      files.push(resolve(repo, arg));
    }
  }
  const root = resolve(repo, named.root ?? '.');
  const project = resolve(repo, named.project ?? join(root, 'tsconfig.json'));
  const sites = resolve(repo, named.sites ?? join(root, 'tools'));
  const rules =
    named.rules === undefined
      ? undefined
      : named.rules.split(',').map((part) => Number(part.trim()));
  return {
    typescript,
    rules,
    root,
    project: existsSync(project) ? project : null,
    sites: existsSync(sites) ? sites : null,
    base: named.base,
    files,
  } as unknown as ShapeCheckOptions;
}

function expectSame(args: readonly string[]): ShapeCheckReport {
  const script = run(previous, args);
  expect(run(command, args)).toEqual(script);
  const report = checkProviderShape(resolved(args));
  switch (report.status) {
    case 'usage-error':
      expect(script.stdout).toBe('');
      expect(script.status).toBe(2);
      expect(script.stderr).toBe(`${report.message}\n${USAGE}\n`);
      break;
    case 'type-errors':
      expect(script.stdout).toBe('');
      expect(script.status).toBe(2);
      expect(script.stderr).toBe(`${TYPE_ERRORS}${report.diagnostics}`);
      break;
    case 'checked':
      expect(script.stderr).toBe('');
      expect(script.status).toBe(report.findings.length > 0 ? 1 : 0);
      expect(script.stdout).toBe(
        reportLines(report)
          .map((line) => `${line}\n`)
          .join(''),
      );
      break;
  }
  return report;
}

const trees: string[] = [];

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'shape-equivalence-'));
  trees.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterAll(() => {
  for (const root of trees) rmSync(root, { recursive: true, force: true });
});

describe('the held 2.1.1 script', () => {
  it('is the 2.1.1 file, byte for byte', () => {
    expect(
      createHash('sha256').update(readFileSync(previous)).digest('hex'),
    ).toBe('681d8cbdc6177d2436955e172d9aded58ea67e8b9a604d1fbaf1f81c70715603');
  });

  it('is not the command compared with it', () => {
    expect(readFileSync(command)).not.toEqual(readFileSync(previous));
  });
});

describe('the module refuses as the 2.1.1 script does', () => {
  const onFixtures = ['--root', fixtures, '--sites', fixtureSites];

  it.each([
    ['rules 1–3 without --base', ['--rules', '1']],
    ['rule 2 without --base', ['--rules', '2']],
    ['rule 3 without --base', ['--rules', '3']],
    [
      'a base without #export',
      ['--rules', '1', '--base', './src/auth/AuthProviderBase'],
    ],
    [
      'a module that does not resolve',
      ['--rules', '1', '--base', './src/auth/Nope#AuthProviderBase'],
    ],
    [
      'a package that does not resolve',
      ['--rules', '1', '--base', '@mcp-abap-adt/nope#AuthProviderBase'],
    ],
    [
      'an export that is not there',
      ['--rules', '1', '--base', `${FIXTURE_BASE}X`],
    ],
    [
      'an export that is not a class',
      ['--rules', '1', '--base', '@mcp-abap-adt/interfaces-auth#IAuthProvider'],
    ],
  ])('%s', (_label, args) => {
    expect(expectSame([...args, ...onFixtures]).status).toBe('usage-error');
  });

  it('without --rules', () => {
    expect(expectSame([]).status).toBe('usage-error');
  });

  it('a rule it does not know', () => {
    expect(expectSame(['--rules', '4,9']).status).toBe('usage-error');
  });

  it('a file that does not exist', () => {
    expect(
      expectSame(['--rules', '4', join(repo, 'src', 'nope.ts')]).status,
    ).toBe('usage-error');
  });

  it('a root with nothing to check', () => {
    const root = tree({});
    expect(expectSame(['--rules', '6', '--root', root]).status).toBe(
      'usage-error',
    );
  });

  it('rules 4 and 5 without the brands of interfaces-auth 6', () => {
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
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'node16',
          moduleResolution: 'node16',
        },
        include: ['src'],
      }),
      'src/old.ts':
        "import type { IAuthRefusal } from '@mcp-abap-adt/interfaces-auth';\nexport const r = {} as IAuthRefusal;\n",
    });
    for (const rules of ['4', '5']) {
      expect(expectSame(['--rules', rules, '--root', root]).status).toBe(
        'usage-error',
      );
    }
    expect(expectSame(['--rules', '6', '--root', root]).status).toBe('checked');
  });

  it('a program that does not type-check', () => {
    const root = tree({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true },
        include: ['src'],
      }),
      'src/broken.ts': "export const n: number = 'a';\n",
    });
    expect(expectSame(['--rules', '4', '--root', root]).status).toBe(
      'type-errors',
    );
  });

  it('a base file that is not a module of the program', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'base.js': 'class AuthProviderBase {}\n',
    });
    const scope = join(root, 'node_modules', '@mcp-abap-adt');
    mkdirSync(scope, { recursive: true });
    symlinkSync(
      join(repo, 'node_modules', '@mcp-abap-adt', 'interfaces-auth'),
      join(scope, 'interfaces-auth'),
      'dir',
    );
    expect(
      expectSame([
        '--rules',
        '1',
        '--root',
        root,
        '--base',
        './base.js#AuthProviderBase',
      ]).status,
    ).toBe('usage-error');
  });

  it('rules 1 and 3 where interfaces-auth does not resolve', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'base.ts': 'export class AuthProviderBase {}\n',
    });
    for (const rules of ['1', '3']) {
      expect(
        expectSame([
          '--rules',
          rules,
          '--root',
          root,
          '--base',
          './base#AuthProviderBase',
        ]).status,
      ).toBe('usage-error');
    }
  });

  it('a file to check that is not in the program', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'src/a.txt': 'x',
    });
    expect(
      expectSame(['--rules', '6', '--root', root, join(root, 'src', 'a.txt')])
        .status,
    ).toBe('usage-error');
  });

  it.each([
    ['assertion-sites.json', '{'],
    ['assertion-sites.json', '{}'],
    ['assertion-sites.json', JSON.stringify([{ file: 'src/a.ts' }])],
    [
      'diagnostic-sites.json',
      JSON.stringify([{ file: 'src/a.ts', function: 'f', field: 1 }]),
    ],
  ])('a site list %s holding %s', (name, content) => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      [`tools/${name}`]: content,
    });
    expect(expectSame(['--rules', '6', '--root', root]).status).toBe(
      'usage-error',
    );
  });

  it('a project with an unknown compiler option', () => {
    const root = tree({
      'tsconfig.json': '{"compilerOptions":{"nope":1}}',
      'src/a.ts': 'export const a = 1;\n',
    });
    expect(expectSame(['--rules', '6', '--root', root]).status).toBe(
      'usage-error',
    );
  });

  it('a project that cannot be read', () => {
    const root = tree({ 'src/a.ts': 'export const a = 1;\n' });
    expect(
      expectSame([
        '--rules',
        '6',
        '--root',
        root,
        '--project',
        join(root, 'src'),
      ]).status,
    ).toBe('usage-error');
  });

  it('a stated sites directory holding one list only', () => {
    const root = tree({
      'src/a.ts': 'export const a = 1;\n',
      'tools/assertion-sites.json': '[]',
    });
    expect(expectSame(['--rules', '6', '--root', root]).status).toBe('checked');
  });
});

/** The commit before the module: the own tree's file set the script knew. */
const BEFORE_THE_MODULE = '3cbf6a4';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
const TEST_DIRECTORIES = [
  '__tests__',
  '__typechecks__',
  '__fixtures__',
  '__mocks__',
];

/** Whether the command would select `path` (relative to the repo) itself. */
function selectedByDefault(path: string): boolean {
  if (!path.startsWith('src/')) return false;
  if (!SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (path.split('/').some((part) => TEST_DIRECTORIES.includes(part)))
    return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.includes('.test.') || name.includes('.spec.')) return false;
  if (name.includes('.d.')) return false;
  return true;
}

/** The own tree's files as of the commit before the module, absolute. */
function ownFilesBefore(): string[] {
  return execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', BEFORE_THE_MODULE, '--', 'src'],
    { cwd: repo, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path.length > 0 && selectedByDefault(path))
    .map((path) => join(repo, path));
}

function fixtureSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtureSources(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

function findingCount(report: ShapeCheckReport): number {
  if (report.status !== 'checked') {
    throw new Error(`not checked: ${reportLines(report).join('\n')}`);
  }
  return report.findings.length;
}

describe('the module finds what the 2.1.1 script finds', () => {
  const ALL = '1,2,3,4,5,6,7,8';
  const own = ownFilesBefore();
  const onFixtures = ['--root', fixtures, '--sites', fixtureSites];
  const withBase = [...onFixtures, '--base', FIXTURE_BASE];

  it('selects the own tree as it was before the module', () => {
    expect(own.length).toBeGreaterThan(10);
    expect(own.some((file) => file.includes('shapeCheck'))).toBe(false);
  });

  it('the own tree, rules 4 and 6', () => {
    expect(findingCount(expectSame(['--rules', '4,6', ...own]))).toBe(0);
  });

  it('the own tree, rule 4, with an empty sites directory', () => {
    const empty = tree({});
    expect(
      findingCount(expectSame(['--rules', '4', '--sites', empty, ...own])),
    ).toBe(4);
  });

  it('the own tree, every rule, against the fixtures’ base', () => {
    expectSame([
      '--rules',
      ALL,
      '--base',
      './tools/__fixtures__/src/auth/AuthProviderBase#AuthProviderBase',
      ...own,
    ]);
  });

  it('the fixtures, every rule, their sites and base', () => {
    expect(
      findingCount(expectSame(['--rules', ALL, ...withBase])),
    ).toBeGreaterThan(50);
  });

  const fixture = (...path: string[]): string => join(fixtures, ...path);

  it.each([
    ['rule 5 only', ['--rules', '5', ...onFixtures]],
    [
      'given files',
      [
        '--rules',
        ALL,
        ...withBase,
        fixture('src', 'rule3.ts'),
        fixture('src', 'obeys.ts'),
      ],
    ],
    [
      'the impostor pair',
      [
        '--rules',
        '1,2,3',
        ...withBase,
        fixture('src', 'impostor', 'AuthProviderBase.ts'),
        fixture('src', 'impostor', 'provider.ts'),
      ],
    ],
    [
      'bases/AuthProviderBase',
      [
        '--rules',
        '1',
        ...onFixtures,
        '--base',
        './bases/AuthProviderBase#AuthProviderBase',
        fixture('bases', 'AuthProviderBase.ts'),
      ],
    ],
    ...['1', '2', '3'].map(
      (rules) =>
        [
          `bases/RewritingBase, rule ${rules}`,
          [
            '--rules',
            rules,
            ...onFixtures,
            '--base',
            './bases/RewritingBase#AuthProviderBase',
            fixture('bases', 'RewritingBase.ts'),
          ],
        ] as const,
    ),
    [
      'bases/ParameterBase',
      [
        '--rules',
        '1',
        ...onFixtures,
        '--base',
        './bases/ParameterBase#AuthProviderBase',
        fixture('bases', 'ParameterBase.ts'),
      ],
    ],
    [
      'prose.ts with RewritingBase',
      [
        '--rules',
        '1',
        ...onFixtures,
        '--base',
        './bases/RewritingBase#AuthProviderBase',
        fixture('src', 'auth', 'prose.ts'),
      ],
    ],
    [
      'obeys.ts with the fixtures’ base',
      ['--rules', '1,2,3', ...withBase, fixture('src', 'obeys.ts')],
    ],
    [
      'obeys.ts with the impostor base',
      [
        '--rules',
        '1',
        ...onFixtures,
        '--base',
        './src/impostor/AuthProviderBase#AuthProviderBase',
        fixture('src', 'obeys.ts'),
      ],
    ],
  ] as const)('%s', (_label, args) => {
    expect(expectSame(args).status).toBe('checked');
  });

  it('two findings at one place, found in the other order, sorted by rule', () => {
    const root = tree({
      'src/base.ts': 'export abstract class AuthProviderBase {}\n',
      'src/provider.ts': [
        "import type { IAuthProvider } from '@mcp-abap-adt/interfaces-auth';",
        '',
        'const ok = async () => ({ ok: true }) as const;',
        "export const provider = { kind: 'literal', prepare: ok, establish: ok, authorize: ok, rejected: ok } as IAuthProvider;",
        '',
      ].join('\n'),
    });
    const scope = join(root, 'node_modules', '@mcp-abap-adt');
    mkdirSync(scope, { recursive: true });
    symlinkSync(
      join(repo, 'node_modules', '@mcp-abap-adt', 'interfaces-auth'),
      join(scope, 'interfaces-auth'),
      'dir',
    );
    const report = expectSame([
      '--rules',
      '3,4',
      '--root',
      root,
      '--base',
      './src/base#AuthProviderBase',
    ]);
    expect(
      reportLines(report).filter((line) => line.startsWith('src/provider.ts')),
    ).toEqual([
      expect.stringMatching(/^src\/provider\.ts:4:25: rule 3: /),
      expect.stringMatching(/^src\/provider\.ts:4:25: rule 4: /),
    ]);
  });

  it.each(
    [
      ...fixtureSources(join(fixtures, 'src')),
      ...fixtureSources(join(fixtures, 'bases')),
    ].map((file) => [file.slice(fixtures.length + 1), file]),
  )('%s alone, every rule', (_label, file) => {
    expect(expectSame(['--rules', ALL, ...withBase, file]).status).toBe(
      'checked',
    );
  });
});
