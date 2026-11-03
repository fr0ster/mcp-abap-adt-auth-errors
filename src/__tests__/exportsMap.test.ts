import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  type PackedConsumer,
  packedConsumer,
  repositoryRoot as root,
} from './packedConsumer';

/**
 * The `exports` map (hygiene, not a security boundary: code in the process
 * that requires `dist/` by absolute path is outside the threat model). The
 * packed package, installed into a temporary `node_modules`, resolves by
 * name only its entry, `package.json`, the shape-check module, the tables
 * module and the shape check's command; a deep path by name is
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. Consumers compiling with
 * `moduleResolution` `node`, `node16` and `bundler` type-check an import of
 * the entry, the shape-check module and the tables module.
 */
let consumer: PackedConsumer | undefined;

/** Runs `script` with Node in the consumer directory; answers stdout. */
function inConsumer(script: string): string {
  if (consumer === undefined) throw new Error('no consumer');
  return consumer.run(script);
}

before(
  () => {
    consumer = packedConsumer({ withTypescript: true });
    // The typed consumers check every declaration, interfaces-auth's included,
    // which names Node's types: the repository's @types/node (and the
    // undici-types it holds) are linked in, as a consumer has them installed.
    mkdirSync(join(consumer.dir, 'node_modules/@types'));
    symlinkSync(
      join(root, 'node_modules/@types/node'),
      join(consumer.dir, 'node_modules/@types/node'),
      'dir',
    );
  },
  { timeout: 60_000 },
);

after(() => {
  consumer?.remove();
});

describe('the exports map', () => {
  it('the entry resolves by name and loads', () => {
    assert.equal(
      inConsumer(
        "console.log(typeof require('@mcp-abap-adt/auth-errors').classify)",
      ),
      'function',
    );
  });

  it('a deep path by name is ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
    for (const deep of [
      '@mcp-abap-adt/auth-errors/dist/allowlists',
      '@mcp-abap-adt/auth-errors/dist/allowlists.js',
      '@mcp-abap-adt/auth-errors/dist/index.js',
      '@mcp-abap-adt/auth-errors/dist/shapeCheck',
      '@mcp-abap-adt/auth-errors/dist/shapeCheck/index.js',
      '@mcp-abap-adt/auth-errors/dist/tables',
      '@mcp-abap-adt/auth-errors/dist/tables.js',
    ]) {
      assert.deepEqual(
        [
          deep,
          inConsumer(
            `try { require(${JSON.stringify(deep)}); console.log('loaded') } catch (e) { console.log(e.code) }`,
          ),
        ],
        [deep, 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
      );
    }
  });

  it('the shape check resolves by name, byte-identical to the canonical file', () => {
    const resolved = inConsumer(
      "console.log(require.resolve('@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs'))",
    );
    assert.equal(
      readFileSync(resolved, 'utf8'),
      readFileSync(join(root, 'tools/check-provider-shape.mjs'), 'utf8'),
    );
  });

  it('the shape-check module resolves by name and loads', () => {
    assert.equal(
      inConsumer(
        "const m = require('@mcp-abap-adt/auth-errors/shape-check'); console.log([typeof m.checkProviderShape, typeof m.formatFinding, typeof m.reportLines].join())",
      ),
      'function,function,function',
    );
  });

  it('the tables module resolves by name and loads', () => {
    assert.equal(
      inConsumer(
        "const m = require('@mcp-abap-adt/auth-errors/tables'); console.log([typeof m.render, typeof m.contract, typeof m.rowsFor, typeof m.markdownCell, typeof m.withRegions, typeof m.tableWriteMode].join())",
      ),
      'function,object,function,function,function,function',
    );
  });

  for (const [mode, resolution] of [
    ['node', { module: 'commonjs', moduleResolution: 'node' }],
    ['node16', { module: 'node16', moduleResolution: 'node16' }],
    ['bundler', { module: 'esnext', moduleResolution: 'bundler' }],
  ] as const) {
    it(`a consumer on moduleResolution ${mode} type-checks an import of the entry, the shape check and the tables`, () => {
      if (consumer === undefined) throw new Error('no consumer');
      const project = join(consumer.dir, `typed-${mode}`);
      mkdirSync(project);
      writeFileSync(
        join(project, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            ...resolution,
            target: 'ES2022',
            strict: true,
            noEmit: true,
            types: ['node'],
          },
          files: ['consumer.ts'],
        }),
      );
      writeFileSync(
        join(project, 'consumer.ts'),
        [
          "import { classify } from '@mcp-abap-adt/auth-errors';",
          'import {',
          '  checkProviderShape,',
          '  type ShapeCheckReport,',
          "} from '@mcp-abap-adt/auth-errors/shape-check';",
          "import { markdownCell, rowsFor } from '@mcp-abap-adt/auth-errors/tables';",
          '',
          'export const check: (',
          '  options: Parameters<typeof checkProviderShape>[0],',
          ') => ShapeCheckReport = checkProviderShape;',
          'export const read = classify;',
          'export const cell: (text: string) => string = markdownCell;',
          'export const rows = rowsFor;',
          '',
        ].join('\n'),
      );
      const tsc = spawnSync(
        process.execPath,
        [join(root, 'node_modules/typescript/bin/tsc'), '-p', project],
        { cwd: project, encoding: 'utf8' },
      );
      assert.deepEqual([mode, tsc.status, tsc.stdout], [mode, 0, '']);
    });
  }

  it('package.json resolves by name', () => {
    assert.equal(
      inConsumer(
        "console.log(require('@mcp-abap-adt/auth-errors/package.json').name)",
      ),
      '@mcp-abap-adt/auth-errors',
    );
  });
});
