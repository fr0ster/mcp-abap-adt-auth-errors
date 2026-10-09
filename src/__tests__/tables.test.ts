import * as interfacesAuth from '@mcp-abap-adt/interfaces-auth';
import * as main from '../index';
import {
  contract,
  markdownCell,
  render,
  rowsFor,
  tableWriteMode,
  withRegions,
} from '../tables';

describe('rowsFor', () => {
  it('answers the rows in the allowlist order, not the rows order', () => {
    expect(rowsFor(['b', 'a', 'c'], { a: 1, b: 2, c: 3 }, 't')).toEqual([
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ]);
  });

  it('throws an Error naming the table and the value for a value without a row', () => {
    expect(() => rowsFor(['a', 'zz'], { a: 1 }, 'my-table')).toThrow(Error);
    expect(() => rowsFor(['a', 'zz'], { a: 1 }, 'my-table')).toThrow(
      'my-table: no row for "zz"',
    );
  });

  it('does not take an inherited property for a row', () => {
    expect(() => rowsFor(['toString'], {}, 't')).toThrow('"toString"');
  });

  it('ignores a row for a value outside the allowlist', () => {
    expect(rowsFor(['a'], { a: 1, extra: 9 }, 't')).toEqual([['a', 1]]);
  });
});

describe('withRegions', () => {
  const region = (name: string, body: string) => ({
    open: `<!-- ${name} -->`,
    close: `<!-- /${name} -->`,
    body,
  });

  it('replaces only the body between the markers, with a line break each side', () => {
    const text = 'before\n<!-- a -->\nold\n<!-- /a -->\nafter\n';
    expect(withRegions(text, [region('a', 'new')])).toBe(
      'before\n<!-- a -->\nnew\n<!-- /a -->\nafter\n',
    );
  });

  it('replaces several regions and leaves all other text byte-identical', () => {
    const text =
      '  x |\r\n<!-- a -->old<!-- /a -->\t mid \n<!-- b -->\n\n<!-- /b -->tail';
    expect(withRegions(text, [region('a', 'A'), region('b', 'B')])).toBe(
      '  x |\r\n<!-- a -->\nA\n<!-- /a -->\t mid \n<!-- b -->\nB\n<!-- /b -->tail',
    );
  });

  it('uses the first open and the first close after it', () => {
    const text = '<!-- a -->1<!-- /a -->2<!-- a -->3<!-- /a -->';
    expect(withRegions(text, [region('a', 'N')])).toBe(
      '<!-- a -->\nN\n<!-- /a -->2<!-- a -->3<!-- /a -->',
    );
  });

  it('is idempotent', () => {
    const once = withRegions('<!-- a -->x<!-- /a -->', [region('a', 'N')]);
    expect(withRegions(once, [region('a', 'N')])).toBe(once);
  });

  it('throws naming the marker when open is missing', () => {
    expect(() => withRegions('<!-- /a -->', [region('a', 'N')])).toThrow(
      '<!-- a -->',
    );
  });

  it('throws naming the marker when close is missing', () => {
    expect(() => withRegions('<!-- a -->', [region('a', 'N')])).toThrow(
      '<!-- /a -->',
    );
  });

  it('throws when close precedes open', () => {
    expect(() =>
      withRegions('<!-- /a -->x<!-- a -->', [region('a', 'N')]),
    ).toThrow('<!-- /a -->');
  });
});

describe('markdownCell', () => {
  it('escapes the pipe and nothing else', () => {
    expect(markdownCell('a | b `c` \\')).toBe('a \\| b `c` \\');
  });
});

describe('tableWriteMode', () => {
  it('is false when unset', () => {
    expect(tableWriteMode({})).toBe(false);
    expect(tableWriteMode({ CI: 'true' })).toBe(false);
  });

  it("is true for '1'", () => {
    expect(tableWriteMode({ WRITE_README_TABLES: '1' })).toBe(true);
  });

  it.each(['true', 'false', ''])("throws for '1' with CI=%j", (ci) => {
    expect(() => tableWriteMode({ WRITE_README_TABLES: '1', CI: ci })).toThrow(
      'CI',
    );
  });

  it.each(['', '0', 'true', 'yes'])('throws for %j', (value) => {
    expect(() => tableWriteMode({ WRITE_README_TABLES: value })).toThrow(
      'WRITE_README_TABLES',
    );
  });

  it('reads only the given object, and only the two keys', () => {
    expect(tableWriteMode(Object.freeze({ WRITE_README_TABLES: '1' }))).toBe(
      true,
    );
    const reads: (string | symbol)[] = [];
    const env = new Proxy(
      {},
      {
        get(_t, key) {
          reads.push(key);
          return undefined;
        },
        has(_t, key) {
          reads.push(key);
          return false;
        },
        ownKeys() {
          reads.push('ownKeys');
          return [];
        },
      },
    );
    expect(tableWriteMode(env)).toBe(false);
    expect(new Set(reads)).toEqual(new Set(['WRITE_README_TABLES']));
    const reads2: (string | symbol)[] = [];
    const env2 = new Proxy(
      {},
      {
        get(_t, key) {
          reads2.push(key);
          return key === 'WRITE_README_TABLES' ? '1' : undefined;
        },
      },
    );
    tableWriteMode(env2);
    expect(new Set(reads2)).toEqual(new Set(['WRITE_README_TABLES', 'CI']));
  });
});

describe('what the subpath re-exports', () => {
  it("render is the main entry's function object", () => {
    expect(render).toBe(main.render);
  });

  it('contract is the interfaces-auth module object allowlists.ts imports', () => {
    expect(contract).toBe(interfacesAuth);
  });
});
