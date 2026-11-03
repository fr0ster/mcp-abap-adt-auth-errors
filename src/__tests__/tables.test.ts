import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
    assert.deepEqual(rowsFor(['b', 'a', 'c'], { a: 1, b: 2, c: 3 }, 't'), [
      ['b', 2],
      ['a', 1],
      ['c', 3],
    ]);
  });

  it('throws an Error naming the table and the value for a value without a row', () => {
    assert.throws(() => rowsFor(['a', 'zz'], { a: 1 }, 'my-table'), Error);
    assert.throws(
      () => rowsFor(['a', 'zz'], { a: 1 }, 'my-table'),
      (thrown: unknown) =>
        thrown instanceof Error &&
        thrown.message.includes('my-table: no row for "zz"'),
    );
  });

  it('does not take an inherited property for a row', () => {
    assert.throws(
      () => rowsFor(['toString'], {}, 't'),
      (thrown: unknown) =>
        thrown instanceof Error && thrown.message.includes('"toString"'),
    );
  });

  it('ignores a row for a value outside the allowlist', () => {
    assert.deepEqual(rowsFor(['a'], { a: 1, extra: 9 }, 't'), [['a', 1]]);
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
    assert.equal(
      withRegions(text, [region('a', 'new')]),
      'before\n<!-- a -->\nnew\n<!-- /a -->\nafter\n',
    );
  });

  it('replaces several regions and leaves all other text byte-identical', () => {
    const text =
      '  x |\r\n<!-- a -->old<!-- /a -->\t mid \n<!-- b -->\n\n<!-- /b -->tail';
    assert.equal(
      withRegions(text, [region('a', 'A'), region('b', 'B')]),
      '  x |\r\n<!-- a -->\nA\n<!-- /a -->\t mid \n<!-- b -->\nB\n<!-- /b -->tail',
    );
  });

  it('uses the first open and the first close after it', () => {
    const text = '<!-- a -->1<!-- /a -->2<!-- a -->3<!-- /a -->';
    assert.equal(
      withRegions(text, [region('a', 'N')]),
      '<!-- a -->\nN\n<!-- /a -->2<!-- a -->3<!-- /a -->',
    );
  });

  it('is idempotent', () => {
    const once = withRegions('<!-- a -->x<!-- /a -->', [region('a', 'N')]);
    assert.equal(withRegions(once, [region('a', 'N')]), once);
  });

  it('throws naming the marker when open is missing', () => {
    assert.throws(
      () => withRegions('<!-- /a -->', [region('a', 'N')]),
      (thrown: unknown) =>
        thrown instanceof Error && thrown.message.includes('<!-- a -->'),
    );
  });

  it('throws naming the marker when close is missing', () => {
    assert.throws(
      () => withRegions('<!-- a -->', [region('a', 'N')]),
      (thrown: unknown) =>
        thrown instanceof Error && thrown.message.includes('<!-- /a -->'),
    );
  });

  it('throws when close precedes open', () => {
    assert.throws(
      () => withRegions('<!-- /a -->x<!-- a -->', [region('a', 'N')]),
      (thrown: unknown) =>
        thrown instanceof Error && thrown.message.includes('<!-- /a -->'),
    );
  });
});

describe('markdownCell', () => {
  it('escapes the pipe and nothing else', () => {
    assert.equal(markdownCell('a | b `c` \\'), 'a \\| b `c` \\');
  });
});

describe('tableWriteMode', () => {
  it('is false when unset', () => {
    assert.equal(tableWriteMode({}), false);
    assert.equal(tableWriteMode({ CI: 'true' }), false);
  });

  it("is true for '1'", () => {
    assert.equal(tableWriteMode({ WRITE_README_TABLES: '1' }), true);
  });

  for (const ci of ['true', 'false', '']) {
    it(`throws for '1' with CI=${JSON.stringify(ci)}`, () => {
      assert.throws(
        () => tableWriteMode({ WRITE_README_TABLES: '1', CI: ci }),
        (thrown: unknown) =>
          thrown instanceof Error && thrown.message.includes('CI'),
      );
    });
  }

  for (const value of ['', '0', 'true', 'yes']) {
    it(`throws for ${JSON.stringify(value)}`, () => {
      assert.throws(
        () => tableWriteMode({ WRITE_README_TABLES: value }),
        (thrown: unknown) =>
          thrown instanceof Error &&
          thrown.message.includes('WRITE_README_TABLES'),
      );
    });
  }

  it('reads only the given object, and only the two keys', () => {
    assert.equal(
      tableWriteMode(Object.freeze({ WRITE_README_TABLES: '1' })),
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
    assert.equal(tableWriteMode(env), false);
    assert.deepEqual(new Set(reads), new Set(['WRITE_README_TABLES']));
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
    assert.deepEqual(new Set(reads2), new Set(['WRITE_README_TABLES', 'CI']));
  });
});

describe('what the subpath re-exports', () => {
  it("render is the main entry's function object", () => {
    assert.equal(render, main.render);
  });

  it('contract is the interfaces-auth module object allowlists.ts imports', () => {
    assert.equal(contract, interfacesAuth);
  });
});
