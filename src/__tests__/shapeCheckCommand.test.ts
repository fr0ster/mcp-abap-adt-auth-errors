import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as typescript from 'typescript';
import {
  checkProviderShape,
  reportLines,
  type ShapeCheckOptions,
} from '../shapeCheck';
import {
  type CommandRun,
  type PackedConsumer,
  packedConsumer,
  repositoryRoot as repo,
} from './packedConsumer';

/**
 * The published command, as a consumer runs it: the packed package
 * installed into a temporary `node_modules` beside `typescript`, its
 * command run as a child. It prints what the module reports — each finding
 * on stdout, exit 1; nothing, exit 0; a usage error with the usage line, or
 * a program that does not type-check, on stderr, exit 2.
 */
const fixtures = join(repo, 'tools', '__fixtures__');
const fixtureSites = join(fixtures, 'sites');
const FIXTURE_BASE = './src/auth/AuthProviderBase#AuthProviderBase';
const ALL = '1,2,3,4,5,6,7,8';
const USAGE =
  'usage: check-provider-shape.mjs --rules <n,…> [--base <module>#AuthProviderBase] [--root <dir>] [--project <tsconfig>] [--sites <dir>] [files…]';
const TYPE_ERRORS = 'the shape check needs a program that type-checks:\n';

jest.setTimeout(120_000);

let consumer: PackedConsumer | undefined;
const trees: string[] = [];

beforeAll(() => {
  consumer = packedConsumer({ withTypescript: true });
}, 60_000);

afterAll(() => {
  consumer?.remove();
  for (const root of trees) rmSync(root, { recursive: true, force: true });
});

function installed(): PackedConsumer {
  if (consumer === undefined) throw new Error('no consumer');
  return consumer;
}

function command(args: readonly string[], cwd?: string): CommandRun {
  return installed().runCommand(args, cwd);
}

function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'shape-command-'));
  trees.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Links the repository's interfaces-auth into `root`'s `node_modules`. */
function withContract(root: string): string {
  const scope = join(root, 'node_modules', '@mcp-abap-adt');
  mkdirSync(scope, { recursive: true });
  symlinkSync(
    join(repo, 'node_modules', '@mcp-abap-adt', 'interfaces-auth'),
    join(scope, 'interfaces-auth'),
    'dir',
  );
  return root;
}

function printed(lines: readonly string[]): string {
  return lines.map((line) => `${line}\n`).join('');
}

function refused(message: string): CommandRun {
  return { status: 2, stdout: '', stderr: `${message}\n${USAGE}\n` };
}

const onFixtures = [
  '--root',
  fixtures,
  '--sites',
  fixtureSites,
  '--base',
  FIXTURE_BASE,
];

describe('the published command: what it finds', () => {
  it('prints every finding of the fixtures, as the module reports them, and exits 1', () => {
    const report = checkProviderShape({
      typescript,
      rules: [1, 2, 3, 4, 5, 6, 7, 8],
      root: fixtures,
      project: join(fixtures, 'tsconfig.json'),
      sites: fixtureSites,
      base: FIXTURE_BASE,
    });
    expect(report.status).toBe('checked');
    const lines = reportLines(report);
    expect(lines.length).toBeGreaterThan(50);
    expect(command(['--rules', ALL, ...onFixtures])).toEqual({
      status: 1,
      stdout: printed(lines),
      stderr: '',
    });
  });

  it('is clean on this repository with its own rules, and exits 0', () => {
    expect(command(['--rules', '4,6', '--root', repo])).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('resolves relative paths against the working directory', () => {
    expect(
      command(
        [
          '--rules',
          ALL,
          '--root',
          '.',
          '--sites',
          'sites',
          '--base',
          FIXTURE_BASE,
          join('src', 'rule3.ts'),
        ],
        fixtures,
      ),
    ).toEqual(
      command(
        ['--rules', ALL, ...onFixtures, join(fixtures, 'src', 'rule3.ts')],
        fixtures,
      ),
    );
  });
});

describe('the published command: a missing project or sites directory', () => {
  const forged = {
    'src/forged.ts':
      "import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';\nexport const forged = {} as IAuthProviderError;\n",
  };

  function bare(): { root: string; options: ShapeCheckOptions } {
    const root = withContract(tree(forged));
    return {
      root,
      options: { typescript, rules: [4], root, project: null, sites: null },
    };
  }

  it('a tree without tsconfig.json and tools/ is checked as the module checks it with neither', () => {
    const { root, options } = bare();
    const lines = reportLines(checkProviderShape(options));
    expect(lines).toEqual([
      expect.stringMatching(/^src\/forged\.ts:2:\d+: rule 4: /),
    ]);
    expect(command(['--rules', '4', '--root', root])).toEqual({
      status: 1,
      stdout: printed(lines),
      stderr: '',
    });
  });

  it('a --project naming a missing file is no project', () => {
    const { root, options } = bare();
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { nope: 1 } }),
    );
    const lines = reportLines(checkProviderShape(options));
    expect(
      command([
        '--rules',
        '4',
        '--root',
        root,
        '--project',
        join(root, 'missing.json'),
      ]),
    ).toEqual({ status: 1, stdout: printed(lines), stderr: '' });
  });
});

describe('the published command: what it refuses', () => {
  it.each([
    ['without --rules', [], '--rules is required'],
    ['a rule it does not know', ['--rules', '4,9'], 'unknown rule 9'],
    ['a rule that is not a number', ['--rules', '4,x'], 'unknown rule x'],
    [
      'an unknown option',
      ['--rules', '4', '--nope', 'x'],
      'unknown option --nope',
    ],
    [
      'an option without a value',
      ['--rules', '4', '--root'],
      '--root needs a value',
    ],
    [
      'rules 1–3 without --base',
      ['--rules', '2', '--root', fixtures],
      'rules 1, 2 and 3 need --base <module>#AuthProviderBase: the base, by declaration',
    ],
    [
      'a malformed --base',
      [
        '--rules',
        '1',
        '--root',
        fixtures,
        '--base',
        './src/auth/AuthProviderBase',
      ],
      '--base must be <module>#<export>: ./src/auth/AuthProviderBase',
    ],
    [
      'a base that does not resolve',
      [
        '--rules',
        '1',
        '--root',
        fixtures,
        '--base',
        './src/auth/Nope#AuthProviderBase',
      ],
      `--base: ./src/auth/Nope does not resolve from ${fixtures}`,
    ],
    [
      'a file that does not exist',
      ['--rules', '4', '--root', repo, join(repo, 'src', 'nope.ts')],
      `no such file: ${join(repo, 'src', 'nope.ts')}`,
    ],
  ] as const)('%s', (_label, args, message) => {
    expect(command(args)).toEqual(refused(message));
  });

  it('a root with nothing to check', () => {
    const root = tree({});
    expect(command(['--rules', '6', '--root', root])).toEqual(
      refused(`no file to check under ${join(root, 'src')}`),
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
      expect(command(['--rules', rules, '--root', root])).toEqual(
        refused(
          'rules 4 and 5 need the brands of @mcp-abap-adt/interfaces-auth 6.0.0 or later; not found: minted, httpStatusBrand, countBrand, portBrand',
        ),
      );
    }
  });

  it('a program that does not type-check', () => {
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
    if (report.status !== 'type-errors') throw new Error(report.status);
    const run = command(['--rules', '4', '--root', root]);
    expect(run.stderr.startsWith(TYPE_ERRORS)).toBe(true);
    expect(run).toEqual({
      status: 2,
      stdout: '',
      stderr: `${TYPE_ERRORS}${report.diagnostics}`,
    });
    expect(report.diagnostics).toMatch(/src\/broken\.ts/);
  });
});

describe('the published command: copied into another repository', () => {
  it('a copy in the consumer’s own tools/ finds the installed module and answers as the installed command', () => {
    const copy = join(installed().dir, 'tools', 'check-provider-shape.mjs');
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(installed().command, copy);
    for (const args of [
      ['--rules', ALL, ...onFixtures],
      ['--rules', '4,6', '--root', repo],
      ['--rules', '4,9'],
    ]) {
      const fromCopy = installed().runCommand(args, undefined, copy);
      expect(fromCopy).toEqual(command(args));
      expect(fromCopy.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    }
  });
});

describe('the published command: a report it does not know', () => {
  it('fails closed: one line on stderr, exit 2, nothing on stdout', () => {
    const root = tree({
      'node_modules/@mcp-abap-adt/auth-errors/package.json': JSON.stringify({
        name: '@mcp-abap-adt/auth-errors',
        exports: { './shape-check': './shape-check.js' },
      }),
      'node_modules/@mcp-abap-adt/auth-errors/shape-check.js':
        "module.exports = { checkProviderShape: () => ({ status: 'later' }), formatFinding: () => 'never' };\n",
    });
    symlinkSync(
      join(repo, 'node_modules', 'typescript'),
      join(root, 'node_modules', 'typescript'),
      'dir',
    );
    const copy = join(root, 'tools', 'check-provider-shape.mjs');
    mkdirSync(dirname(copy), { recursive: true });
    copyFileSync(installed().command, copy);
    expect(installed().runCommand(['--rules', '4'], root, copy)).toEqual({
      status: 2,
      stdout: '',
      stderr: 'the shape check answered a report this command does not know\n',
    });
  });
});

describe('the command holds no rule logic of its own', () => {
  const sources: Record<string, string> = {
    'tools/check-provider-shape.mjs': join(
      repo,
      'tools',
      'check-provider-shape.mjs',
    ),
  };

  it.each(Object.keys(sources))(
    '%s imports the module by package name and implements nothing',
    (name) => {
      const source = readFileSync(sources[name] as string, 'utf8');
      expect(source).toContain("from '@mcp-abap-adt/auth-errors/shape-check'");
      // No import of a relative or built path: the module is found by name.
      for (const line of source.split('\n')) {
        if (!line.startsWith('import ')) continue;
        expect(line).not.toContain("from '.");
        expect(line).not.toContain("from '/");
        expect(line).not.toContain('dist/');
      }
      // None of the machinery a rule needs belongs to the command.
      for (const marker of [
        'createProgram',
        'getTypeChecker',
        'SyntaxKind',
        'forEachChild',
        'readFileSync',
      ]) {
        expect(source).not.toContain(marker);
      }
      expect(source.split('\n').length).toBeLessThan(150);
    },
  );

  it('the packed command is the same file', () => {
    expect(readFileSync(installed().command, 'utf8')).toBe(
      readFileSync(sources['tools/check-provider-shape.mjs'] as string, 'utf8'),
    );
  });
});
