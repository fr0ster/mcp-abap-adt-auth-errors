import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The README's kinds table is generated (spec §11.4): what
 * `scripts/generate-kinds-table.mjs` prints from the built package's
 * builders is what README.md holds between the markers, byte for byte. A
 * word changed in `words.ts` without `npm run docs:kinds` fails here.
 */
const root = resolve(__dirname, '../..');

function generated(): string {
  return execFileSync(
    process.execPath,
    [resolve(root, 'scripts/generate-kinds-table.mjs')],
    { encoding: 'utf8' },
  ).replace(/\n$/, '');
}

describe('README kinds table', () => {
  const table = generated();
  const lines = table.split('\n');
  const begin = lines[0] ?? '';
  const end = lines[lines.length - 1] ?? '';

  it('the generator prints one section per kind between two markers', () => {
    expect(begin).toMatch(/^<!-- BEGIN GENERATED: kinds table/);
    expect(end).toMatch(/^<!-- END GENERATED: kinds table/);
    expect(lines.filter((line) => line.startsWith('#### ')).length).toBe(17);
  });

  it('README.md holds exactly the generated table', () => {
    const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
    const start = readme.indexOf(begin);
    const stop = readme.indexOf(end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(start);
    expect(readme.slice(start, stop + end.length)).toBe(table);
  });
});
