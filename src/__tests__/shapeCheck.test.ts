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
/** The fixtures' base, named by declaration (relative to the fixture root). */
const FIXTURE_BASE = './src/auth/AuthProviderBase#AuthProviderBase';

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
  'src/clientAuthentication/rule8-limits.ts': [8, 2],
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
      '--base',
      FIXTURE_BASE,
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
      '--base',
      FIXTURE_BASE,
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

  it('is clean under every rule (rules 1–3 against the fixtures’ base)', () => {
    const run = check([
      '--rules',
      ALL_RULES,
      '--base',
      './tools/__fixtures__/src/auth/AuthProviderBase#AuthProviderBase',
    ]);
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

describe('check-provider-shape: the base, by declaration', () => {
  it('a same-named local class, in a file of that name, exempts nothing', () => {
    const lines = check([
      '--rules',
      '1,2,3',
      '--root',
      fixtures,
      '--base',
      FIXTURE_BASE,
      join(fixtures, 'src', 'impostor', 'AuthProviderBase.ts'),
      join(fixtures, 'src', 'impostor', 'provider.ts'),
    ]).findings.map((finding) => finding.line);
    expect(lines).toEqual([
      expect.stringMatching(
        /^src\/impostor\/AuthProviderBase\.ts:.*a class implements IAuthProvider; a provider extends AuthProviderBase$/,
      ),
      expect.stringMatching(
        /^src\/impostor\/provider\.ts:.*a class satisfies IAuthProvider without extending AuthProviderBase$/,
      ),
    ]);
  });

  it('the base named is verified: each moment only returns guard(…, () => …, () => …)', () => {
    const run = check([
      '--rules',
      '1',
      '--root',
      fixtures,
      '--base',
      './bases/AuthProviderBase#AuthProviderBase',
      join(fixtures, 'bases', 'AuthProviderBase.ts'),
    ]);
    expect(run.status).toBe(1);
    expect(run.findings.map((finding) => finding.line)).toEqual(
      ['prepare', 'establish', 'authorize', 'rejected'].map((moment) =>
        expect.stringMatching(
          new RegExp(
            `^bases/AuthProviderBase\\.ts:\\d+:\\d+: rule 1: AuthProviderBase\\.${moment} must only return guard\\(`,
          ),
        ),
      ),
    );
  });

  it('the base may not replace a verified moment: every write is refused under rule 1', () => {
    for (const rules of ['1', '2', '3']) {
      const run = check([
        '--rules',
        rules,
        '--root',
        fixtures,
        '--base',
        './bases/RewritingBase#AuthProviderBase',
        join(fixtures, 'bases', 'RewritingBase.ts'),
      ]);
      expect(run.status).toBe(1);
      expect(run.findings.map((finding) => finding.line)).toEqual([
        expect.stringMatching(
          /rule 1: AuthProviderBase assigns this\.authorize; /,
        ),
        expect.stringMatching(
          /rule 1: AuthProviderBase assigns this\.prepare; /,
        ),
        expect.stringMatching(
          /rule 1: Object\.assign writes rejected onto AuthProviderBase; /,
        ),
        expect.stringMatching(
          /rule 1: Object\.defineProperty writes establish onto AuthProviderBase; /,
        ),
        expect.stringMatching(
          /rule 1: AuthProviderBase assigns AuthProviderBase\.prototype\.prepare; /,
        ),
        expect.stringMatching(
          /rule 1: Object\.assign writes authorize onto AuthProviderBase; /,
        ),
        expect.stringMatching(
          /rule 1: Object\.defineProperty writes rejected onto AuthProviderBase; /,
        ),
      ]);
    }
  });

  it('the base’s own file is scanned for its writes even when only another file is checked', () => {
    const run = check([
      '--rules',
      '1',
      '--root',
      fixtures,
      '--base',
      './bases/RewritingBase#AuthProviderBase',
      join(fixtures, 'src', 'auth', 'prose.ts'),
    ]);
    expect(run.status).toBe(1);
    expect(run.findings).toHaveLength(7);
    for (const finding of run.findings) {
      expect(finding.file).toBe('bases/RewritingBase.ts');
      expect(finding.rule).toBe(1);
    }
  });

  it('the base may not declare a moment as a constructor parameter property', () => {
    const run = check([
      '--rules',
      '1',
      '--root',
      fixtures,
      '--base',
      './bases/ParameterBase#AuthProviderBase',
      join(fixtures, 'bases', 'ParameterBase.ts'),
    ]);
    expect(run.findings.map((finding) => finding.line)).toEqual([
      expect.stringMatching(
        /^bases\/ParameterBase\.ts:\d+:\d+: rule 1: AuthProviderBase declares establish as a constructor parameter property; /,
      ),
    ]);
  });

  it('a provider of the named base is clean; with another base named, it reaches none', () => {
    const obeys = join(fixtures, 'src', 'obeys.ts');
    const clean = check([
      '--rules',
      '1,2,3',
      '--root',
      fixtures,
      '--base',
      FIXTURE_BASE,
      obeys,
    ]);
    expect(clean.status).toBe(0);
    const other = check([
      '--rules',
      '1',
      '--root',
      fixtures,
      '--base',
      './src/impostor/AuthProviderBase#AuthProviderBase',
      obeys,
    ]);
    expect(
      other.findings.some((finding) => finding.file === 'src/obeys.ts'),
    ).toBe(true);
  });

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
  ])('exits 2 on %s', (_label, args) => {
    const run = check([...args, '--root', fixtures, '--sites', fixtureSites]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/--base/);
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
