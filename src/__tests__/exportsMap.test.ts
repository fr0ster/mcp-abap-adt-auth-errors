import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The `exports` map (hygiene, not a security boundary: code in the process
 * that requires `dist/` by absolute path is outside the threat model). The
 * packed package, installed into a temporary `node_modules`, resolves by
 * name only its entry, `package.json` and the shape check; a deep path by
 * name is `ERR_PACKAGE_PATH_NOT_EXPORTED`.
 */
const root = resolve(__dirname, '../..');
let consumer = '';

/** Runs `script` with Node in the consumer directory; answers stdout. */
function inConsumer(script: string): string {
  return execFileSync(process.execPath, ['-e', script], {
    cwd: consumer,
    encoding: 'utf8',
  }).trim();
}

beforeAll(() => {
  consumer = mkdtempSync(join(tmpdir(), 'auth-errors-consumer-'));
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', consumer], {
      cwd: root,
      encoding: 'utf8',
    }),
  ) as Array<{ filename: string }>;
  const tarball = packed[0]?.filename;
  if (tarball === undefined) throw new Error('npm pack produced nothing');
  execFileSync('tar', ['-xzf', join(consumer, tarball)], { cwd: consumer });
  const scope = join(consumer, 'node_modules/@mcp-abap-adt');
  mkdirSync(scope, { recursive: true });
  renameSync(join(consumer, 'package'), join(scope, 'auth-errors'));
  symlinkSync(
    join(root, 'node_modules/@mcp-abap-adt/interfaces-auth'),
    join(scope, 'interfaces-auth'),
    'dir',
  );
}, 60_000);

afterAll(() => {
  if (consumer !== '') rmSync(consumer, { recursive: true, force: true });
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

  it('package.json resolves by name', () => {
    expect(
      inConsumer(
        "console.log(require('@mcp-abap-adt/auth-errors/package.json').name)",
      ),
    ).toBe('@mcp-abap-adt/auth-errors');
  });
});
