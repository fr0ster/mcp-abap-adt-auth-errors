import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

/**
 * The shape check (spec §8.2, §11.3): `tools/check-provider-shape.mjs`, run
 * as every repository runs it — a child process over a tree. Each fixture
 * under `tools/__fixtures__/src` breaks exactly one rule and must be reported
 * for exactly that rule; the obeying files must be clean. This repository's
 * own sources, with its own site lists, must be clean, and its four
 * assertion sites (§4.3) are reported once the list is empty.
 */
const repo = join(__dirname, '..', '..');
const script = join(repo, 'tools', 'check-provider-shape.mjs');
const fixtures = join(repo, 'tools', '__fixtures__');
const fixtureSites = join(fixtures, 'sites');
const ALL_RULES = '1,2,3,4,5,6,7,8';

jest.setTimeout(120_000);

interface Finding {
  readonly file: string;
  readonly rule: number;
  readonly line: string;
}

interface Run {
  readonly status: number | null;
  readonly findings: readonly Finding[];
  readonly stdout: string;
  readonly stderr: string;
}

function check(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  const findings = result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = /^(.+?):\d+:\d+: rule (\d): /.exec(line);
      if (match === null) throw new Error(`not a finding: ${line}`);
      return { file: match[1] as string, rule: Number(match[2]), line };
    });
  return {
    status: result.status,
    findings,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function fixtureFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? fixtureFiles(join(dir, entry.name))
      : [relative(fixtures, join(dir, entry.name)).split(sep).join('/')],
  );
}

/** Each fixture: the one rule it breaks, and how many findings it holds. */
const BREAKING: Readonly<Record<string, readonly [number, number]>> = {
  'src/rule1.ts': [1, 2],
  'src/rule1-structural.ts': [1, 2],
  'src/rule2.ts': [2, 7],
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
};

const OBEYING = [
  'src/obeys.ts',
  'src/numbers.ts',
  'src/auth/AuthProviderBase.ts',
  'src/auth/tokenRequest.ts',
  'src/auth/prose.ts',
  'src/credentials/BasicLike.ts',
];

describe('check-provider-shape: the fixtures', () => {
  let run: Run;

  beforeAll(() => {
    run = check([
      '--rules',
      ALL_RULES,
      '--root',
      fixtures,
      '--sites',
      fixtureSites,
    ]);
  });

  it('lists every fixture in one of the two tables', () => {
    expect(fixtureFiles(join(fixtures, 'src')).sort()).toEqual(
      [...Object.keys(BREAKING), ...OBEYING].sort(),
    );
  });

  it('exits 1 when anything is reported', () => {
    expect(run.stderr).toBe('');
    expect(run.status).toBe(1);
  });

  it.each(Object.entries(BREAKING))(
    '%s is reported for its rule only',
    (file, [rule, count]) => {
      const mine = run.findings.filter((finding) => finding.file === file);
      expect(mine.map((finding) => finding.rule)).toEqual(
        Array.from({ length: count }, () => rule),
      );
    },
  );

  it.each(OBEYING)('%s is clean', (file) => {
    expect(run.findings.filter((finding) => finding.file === file)).toEqual([]);
  });

  it('reports `500 as HttpStatus` in any file (§4.3)', () => {
    expect(
      run.findings.filter((finding) => finding.file === 'src/rule4-branded.ts'),
    ).toEqual([
      expect.objectContaining({
        line: expect.stringMatching(/^src\/rule4-branded\.ts:4:\d+: rule 4: /),
      }),
    ]);
  });

  it('tells a class beside the base to drop `implements IAuthProvider`', () => {
    const lines = run.findings
      .filter((finding) => finding.file === 'src/rule1.ts')
      .map((finding) => finding.line);
    expect(lines).toEqual([
      expect.stringMatching(/a provider extends AuthProviderBase$/),
      expect.stringMatching(
        /drop `implements IAuthProvider`: AuthProviderBase already implements it$/,
      ),
    ]);
  });

  it('runs only the rules asked for', () => {
    const only = check([
      '--rules',
      '5',
      '--root',
      fixtures,
      '--sites',
      fixtureSites,
    ]);
    expect(only.status).toBe(1);
    expect(new Set(only.findings.map((finding) => finding.rule))).toEqual(
      new Set([5]),
    );
  });

  it('checks the files it is given, and only those', () => {
    const one = check([
      '--rules',
      ALL_RULES,
      '--root',
      fixtures,
      '--sites',
      fixtureSites,
      join(fixtures, 'src', 'rule3.ts'),
      join(fixtures, 'src', 'obeys.ts'),
    ]);
    expect(one.findings.map((finding) => [finding.file, finding.rule])).toEqual(
      [['src/rule3.ts', 3]],
    );
  });
});

describe('check-provider-shape: this repository', () => {
  it('is clean with its own rules and site lists', () => {
    const run = check(['--rules', '4,6']);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('');
    expect(run.status).toBe(0);
  });

  it('is clean under every rule', () => {
    const run = check(['--rules', ALL_RULES]);
    expect(run.stdout).toBe('');
    expect(run.status).toBe(0);
  });

  it('reports the four trusted sites once the list is empty (§4.3)', () => {
    const empty = mkdtempSync(join(tmpdir(), 'shape-sites-'));
    try {
      const run = check(['--rules', '4', '--sites', empty]);
      expect(run.status).toBe(1);
      expect(
        run.findings.map((finding) => `${finding.file} ${finding.rule}`),
      ).toEqual([
        'src/mint.ts 4',
        'src/numbers.ts 4',
        'src/numbers.ts 4',
        'src/numbers.ts 4',
      ]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('check-provider-shape: usage', () => {
  it('refuses to run without --rules', () => {
    const run = check([]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
  });

  it('refuses a rule it does not know', () => {
    expect(check(['--rules', '4,9']).status).toBe(2);
  });

  it('refuses a file that does not exist', () => {
    const run = check(['--rules', '4', join(repo, 'src', 'nope.ts')]);
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no such file: .*nope\.ts/);
    expect(run.stdout).toBe('');
  });

  it('refuses a root with nothing to check', () => {
    const root = mkdtempSync(join(tmpdir(), 'shape-empty-'));
    try {
      const run = check(['--rules', '6', '--root', root]);
      expect(run.status).toBe(2);
      expect(run.stderr).toMatch(/no file to check/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses rules 4 and 5 without the brands of interfaces-auth 6', () => {
    const root = mkdtempSync(join(tmpdir(), 'shape-old-'));
    try {
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
      for (const rules of ['4', '5']) {
        const run = check(['--rules', rules, '--root', root]);
        expect(run.status).toBe(2);
        expect(run.stdout).toBe('');
        expect(run.stderr).toMatch(/need the brands .* not found: minted/);
      }
      expect(check(['--rules', '6', '--root', root]).status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a program that does not type-check', () => {
    const root = mkdtempSync(join(tmpdir(), 'shape-broken-'));
    try {
      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true }, include: ['src'] }),
      );
      const src = join(root, 'src');
      mkdirSync(src);
      writeFileSync(join(src, 'broken.ts'), "export const n: number = 'a';\n");
      const run = check(['--rules', '4', '--root', root]);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/broken\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check-provider-shape: the published file (Decision D4)', () => {
  it('is in the package, without its fixtures or site lists', () => {
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
    expect(tools).toEqual(['tools/check-provider-shape.mjs']);
  });
});
