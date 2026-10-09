import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tableWriteMode, withRegions } from '../tables';
import { kindsTableRegion } from './helpers/kindsTable';

const README = resolve(__dirname, '../../README.md');

/**
 * Checks the table in `file`, or rewrites it when `env` asks for write mode:
 * a current file is left alone, a stale one is rewritten. Write mode is
 * decided before anything is read or written.
 */
function checkOrWrite(
  file: string,
  env: Readonly<Record<string, string | undefined>>,
): void {
  const write = tableWriteMode(env);
  const current = readFileSync(file, 'utf8');
  const expected = withRegions(current, [kindsTableRegion()]);
  if (expected === current) return;
  if (!write) throw new Error('stale');
  writeFileSync(file, expected);
}

describe('the README kinds table', () => {
  it('the README kinds table equals the rendered one (regenerate: npm run docs:kinds)', () => {
    const current = readFileSync(README, 'utf8');
    const expected = withRegions(current, [kindsTableRegion()]);
    if (tableWriteMode(process.env) && expected !== current) {
      writeFileSync(README, expected);
      return;
    }
    expect(current).toBe(expected);
  });

  it('holds one section per kind', () => {
    const { body } = kindsTableRegion();
    expect(body.split('\n').filter((l) => l.startsWith('#### ')).length).toBe(
      17,
    );
  });

  describe('refusing what cannot be rendered', () => {
    it('a kind without samples throws', () => {
      expect(() => kindsTableRegion({ kinds: ['tls'], samples: {} })).toThrow(
        'no samples for kind tls',
      );
    });

    it('a kind without a builder throws', () => {
      expect(() =>
        kindsTableRegion({ kinds: ['nonesuch'], samples: { nonesuch: [{}] } }),
      ).toThrow('no builder for nonesuch');
    });

    it('a builder answering another kind throws', () => {
      expect(() =>
        kindsTableRegion({
          kinds: ['tls'],
          samples: { tls: [{ problem: 'missing-material' }] },
          builders: {
            tls: () => ({ kind: 'unknown', facts: {}, reason: 'r' }),
          },
        }),
      ).toThrow('built unknown');
    });
  });

  describe('write mode, on a temporary copy', () => {
    let dir: string;
    let file: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'kinds-table-'));
      file = join(dir, 'README.md');
      writeFileSync(file, readFileSync(README, 'utf8'));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('does not rewrite a current file', () => {
      const old = new Date('2001-01-01T00:00:00Z');
      utimesSync(file, old, old);
      const before = readFileSync(file);
      checkOrWrite(file, { WRITE_README_TABLES: '1' });
      expect(readFileSync(file).equals(before)).toBe(true);
      expect(statSync(file).mtimeMs).toBe(old.getTime());
    });

    it('rewrites a stale file, then it equals the rendered one', () => {
      const real = readFileSync(file, 'utf8');
      writeFileSync(file, real.replace('#### `tls`', '#### `tls` stale'));
      expect(() => checkOrWrite(file, {})).toThrow('stale');
      checkOrWrite(file, { WRITE_README_TABLES: '1' });
      expect(readFileSync(file, 'utf8')).toBe(real);
    });

    it('with CI set, throws before any write', () => {
      const real = readFileSync(file, 'utf8');
      const stale = real.replace('#### `tls`', '#### `tls` stale');
      writeFileSync(file, stale);
      expect(() =>
        checkOrWrite(file, { WRITE_README_TABLES: '1', CI: 'true' }),
      ).toThrow('CI');
      expect(readFileSync(file, 'utf8')).toBe(stale);
      expect(existsSync(file)).toBe(true);
    });
  });
});
