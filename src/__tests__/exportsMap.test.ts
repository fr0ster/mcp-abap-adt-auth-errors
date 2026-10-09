import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type PackedConsumer,
  packedConsumer,
  repositoryRoot as root,
} from './packedConsumer';

/**
 * The `exports` map (hygiene, not a security boundary: code in the process
 * that requires `dist/` by absolute path is outside the threat model). The
 * packed package, installed into a temporary `node_modules`, resolves by
 * name only its entry, `package.json`, the shape-check module and the shape
 * check's command; a deep path by name is `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 * Consumers compiling with `moduleResolution` `node`, `node16` and `bundler`
 * type-check an import of the entry and of the shape-check module.
 */
let consumer: PackedConsumer | undefined;

/** Runs `script` with Node in the consumer directory; answers stdout. */
function inConsumer(script: string): string {
  if (consumer === undefined) throw new Error('no consumer');
  return consumer.run(script);
}

beforeAll(() => {
  consumer = packedConsumer({ withTypescript: true });
}, 60_000);

afterAll(() => {
  consumer?.remove();
});

describe('the exports map', () => {
  it('the entry resolves by name and loads', () => {
    expect(
      inConsumer(
        "console.log(typeof require('@mcp-abap-adt/auth-errors').classify)",
      ),
    ).toBe('function');
  });

  it('a deep path by name is ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
    for (const deep of [
      '@mcp-abap-adt/auth-errors/dist/allowlists',
      '@mcp-abap-adt/auth-errors/dist/allowlists.js',
      '@mcp-abap-adt/auth-errors/dist/index.js',
      '@mcp-abap-adt/auth-errors/dist/shapeCheck',
      '@mcp-abap-adt/auth-errors/dist/shapeCheck/index.js',
    ]) {
      expect([
        deep,
        inConsumer(
          `try { require(${JSON.stringify(deep)}); console.log('loaded') } catch (e) { console.log(e.code) }`,
        ),
      ]).toEqual([deep, 'ERR_PACKAGE_PATH_NOT_EXPORTED']);
    }
  });

  it('the shape check resolves by name, byte-identical to the canonical file', () => {
    const resolved = inConsumer(
      "console.log(require.resolve('@mcp-abap-adt/auth-errors/tools/check-provider-shape.mjs'))",
    );
    expect(readFileSync(resolved, 'utf8')).toBe(
      readFileSync(join(root, 'tools/check-provider-shape.mjs'), 'utf8'),
    );
  });

  it('the shape-check module resolves by name and loads', () => {
    expect(
      inConsumer(
        "const m = require('@mcp-abap-adt/auth-errors/shape-check'); console.log([typeof m.checkProviderShape, typeof m.formatFinding, typeof m.reportLines].join())",
      ),
    ).toBe('function,function,function');
  });

  it.each([
    ['node', { module: 'commonjs', moduleResolution: 'node' }],
    ['node16', { module: 'node16', moduleResolution: 'node16' }],
    ['bundler', { module: 'esnext', moduleResolution: 'bundler' }],
  ])(
    'a consumer on moduleResolution %s type-checks an import of the entry and of the shape check',
    (mode, resolution) => {
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
            skipLibCheck: true,
            types: [],
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
          '',
          'export const check: (',
          '  options: Parameters<typeof checkProviderShape>[0],',
          ') => ShapeCheckReport = checkProviderShape;',
          'export const read = classify;',
          '',
        ].join('\n'),
      );
      const tsc = spawnSync(
        process.execPath,
        [join(root, 'node_modules/typescript/bin/tsc'), '-p', project],
        { cwd: project, encoding: 'utf8' },
      );
      expect([mode, tsc.status, tsc.stdout]).toEqual([mode, 0, '']);
    },
  );

  it('package.json resolves by name', () => {
    expect(
      inConsumer(
        "console.log(require('@mcp-abap-adt/auth-errors/package.json').name)",
      ),
    ).toBe('@mcp-abap-adt/auth-errors');
  });
});
