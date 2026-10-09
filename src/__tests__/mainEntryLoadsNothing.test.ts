import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import * as ts from 'typescript';
import {
  type PackedConsumer,
  packedConsumer,
  repositoryRoot,
} from './packedConsumer';

/**
 * The main entry loads nothing of the shape check or the tables. Three
 * proofs: the source imports reachable from `src/index.ts`; the packed
 * entry loaded in a consumer without `typescript`, its module cache
 * inspected; and the files the entry reads while it loads and is used.
 */
const source = join(repositoryRoot, 'src');
const forbiddenModules = [
  'typescript',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
];

/** The file a relative import names, among the sources, or undefined. */
function sourceFile(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // not this one
    }
  }
  return undefined;
}

/** Every module specifier reached from `src/index.ts`, with where it was met. */
function reachedSpecifiers(): string[] {
  const seen = new Set<string>();
  const reached: string[] = [];
  const pending = [join(source, 'index.ts')];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const specifier = imported.fileName;
      reached.push(`${file.slice(source.length + 1)} -> ${specifier}`);
      if (specifier.startsWith('.')) {
        const next = sourceFile(file, specifier);
        if (next === undefined) {
          throw new Error(`${file}: ${specifier} names no source file`);
        }
        pending.push(next);
      }
    }
  }
  return reached;
}

describe('the source graph of src/index.ts', () => {
  const reached = reachedSpecifiers();

  it('is walked (a graph of several files)', () => {
    expect(reached.length).toBeGreaterThan(10);
  });

  it('reaches neither the shape check nor the tables', () => {
    const hits = reached.filter((line) => {
      const specifier = line.slice(line.indexOf(' -> ') + 4);
      const parts = specifier.split('/');
      return parts.includes('shapeCheck') || parts.includes('tables');
    });
    expect(hits).toEqual([]);
  });

  it('reaches neither typescript nor fs', () => {
    const hits = reached.filter((line) =>
      forbiddenModules.includes(line.slice(line.indexOf(' -> ') + 4)),
    );
    expect(hits).toEqual([]);
  });
});

/** Uses the entry the way a consumer does, so lazy loads would show. */
const useEntry = `
const entry = require('@mcp-abap-adt/auth-errors');
const built = entry.authError.unknown({ operation: 'prepare' });
entry.render(built);
entry.classify(new Error('x'), 'prepare');
`;

describe('the packed main entry in a consumer without typescript', () => {
  let consumer: PackedConsumer | undefined;

  beforeAll(() => {
    consumer = packedConsumer({ withTypescript: false });
    writeFileSync(
      join(consumer.dir, 'record.js'),
      `const fs = require('node:fs');
const recorded = [];
globalThis.__recorded = recorded;
for (const name of ['readFileSync', 'openSync', 'readdirSync', 'statSync', 'existsSync']) {
  const original = fs[name];
  fs[name] = function (target, ...rest) {
    recorded.push({ name, path: String(target), phase: globalThis.__phase });
    return original.call(this, target, ...rest);
  };
}
globalThis.__phase = 'loading';
`,
    );
  }, 60_000);

  afterAll(() => {
    consumer?.remove();
  });

  function inConsumer(script: string, preload?: string): string {
    if (consumer === undefined) throw new Error('no consumer');
    if (preload === undefined) return consumer.run(script);
    return execFileSync(
      process.execPath,
      ['-r', join(consumer.dir, preload), '-e', script],
      { cwd: consumer.dir, encoding: 'utf8' },
    ).trim();
  }

  it('is installed without typescript', () => {
    expect(
      inConsumer(
        "try { require.resolve('typescript'); console.log('found'); } catch { console.log('absent'); }",
      ),
    ).toBe('absent');
  });

  it('loads none of the shape check, the tables or typescript', () => {
    const cached = JSON.parse(
      inConsumer(
        `${useEntry}console.log(JSON.stringify(Object.keys(require.cache)))`,
      ),
    ) as string[];
    const own = cached.filter((path) => path.includes('auth-errors/dist/'));
    expect(own.length).toBeGreaterThan(5);
    const forbidden = cached.filter(
      (path) =>
        path.includes('auth-errors/dist/shapeCheck/') ||
        path.includes('auth-errors/dist/tables') ||
        path.includes('/node_modules/typescript/'),
    );
    expect(forbidden).toEqual([]);
  });

  it('reads only module files, and nothing once the entry has loaded', () => {
    const answer = JSON.parse(
      inConsumer(
        `const entry = require('@mcp-abap-adt/auth-errors');
globalThis.__phase = 'loaded';
entry.render(entry.authError.unknown({ operation: 'prepare' }));
entry.classify(new Error('x'), 'prepare');
console.log(JSON.stringify({ recorded: globalThis.__recorded, cache: Object.keys(require.cache) }));`,
        'record.js',
      ),
    ) as {
      recorded: Array<{ name: string; path: string; phase: string }>;
      cache: string[];
    };
    const cache = new Set(answer.cache);
    expect(answer.cache.length).toBeGreaterThan(5);
    expect(answer.recorded.length).toBeGreaterThan(5);
    const after = answer.recorded.filter((call) => call.phase === 'loaded');
    expect(after).toEqual([]);
    const foreign = answer.recorded.filter((call) => !cache.has(call.path));
    expect(foreign).toEqual([]);
  });

  it('loads the shape-check module and the tables without typescript', () => {
    expect(
      inConsumer(
        `const check = require('@mcp-abap-adt/auth-errors/shape-check');
const tables = require('@mcp-abap-adt/auth-errors/tables');
console.log(typeof check.checkProviderShape, typeof tables.render, typeof tables.rowsFor);`,
      ),
    ).toBe('function function function');
  });
});
