import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
 * Transitional: the 2.1.1 script, held under `tools/previous/`, and the
 * module, run on the same arguments, decide the same. Removed together with
 * the held script once the command is the module's.
 */
const repo = join(__dirname, '..', '..');
const previous = join(repo, 'tools', 'previous', 'check-provider-shape.mjs');
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

function runPrevious(args: readonly string[]): ScriptRun {
  const result = spawnSync(process.execPath, [previous, ...args], {
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
  const script = runPrevious(args);
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
      expect(
        script.stdout.split('\n').filter((line) => line.length > 0),
      ).toEqual(reportLines(report));
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
