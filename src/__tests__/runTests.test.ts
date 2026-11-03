import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

// `node --test` with a pattern that matches nothing exits 0, so a test run must not rest
// on it: tools/run-tests.mjs finds the compiled tests itself and refuses to find none.
const runner = join(__dirname, '..', '..', 'tools', 'run-tests.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'run-tests-'));

after(() => rmSync(scratch, { recursive: true, force: true }));

function runIn(cwd: string, args: readonly string[] = []) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('tools/run-tests.mjs', () => {
  it('fails when there is no test build', () => {
    const cwd = join(scratch, 'no-build');
    mkdirSync(cwd);
    const run = runIn(cwd);
    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes('.test-build/ does not exist'));
  });

  it('fails when the test build holds no test file', () => {
    const cwd = join(scratch, 'empty-build');
    mkdirSync(join(cwd, '.test-build'), { recursive: true });
    const run = runIn(cwd);
    assert.equal(run.status, 1);
    assert.ok(run.stderr.includes('no *.test.js under .test-build/'));
  });

  it('fails when a named file does not exist', () => {
    const cwd = join(scratch, 'named');
    mkdirSync(join(cwd, '.test-build'), { recursive: true });
    const run = runIn(cwd, ['.test-build/missing.test.js']);
    assert.equal(run.status, 1);
    assert.ok(
      run.stderr.includes('.test-build/missing.test.js does not exist'),
    );
  });

  it('refuses an --env without NAME=VALUE', () => {
    const run = runIn(scratch, ['--env', 'NOVALUE']);
    assert.equal(run.status, 2);
    assert.ok(run.stderr.includes('--env takes NAME=VALUE'));
  });
});
