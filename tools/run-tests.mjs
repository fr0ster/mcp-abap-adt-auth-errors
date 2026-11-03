// Runs `node --test` over the compiled tests in `.test-build/`, on every platform the
// package supports.
//
//   node tools/run-tests.mjs [--env NAME=VALUE]... [node --test options]... [files]...
//
// - With no file, it runs every `*.test.js` under `.test-build/`. Finding none is an error:
//   `node --test` with a pattern that matches nothing exits 0, so a broken build would pass.
// - A file named is run as named, and must exist.
// - Options go to `node --test` before the files: after a file, `node --test` ignores them.
// - `--env NAME=VALUE` sets a variable for the run; a shell prefix (`NAME=1 npm …`) does not
//   work on Windows.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.test-build';
const env = { ...process.env };
const options = [];
const files = [];

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--env') {
    const pair = args[i + 1] ?? '';
    i += 1;
    const eq = pair.indexOf('=');
    if (eq < 1) {
      console.error(`run-tests: --env takes NAME=VALUE, got "${pair}"`);
      process.exit(2);
    }
    env[pair.slice(0, eq)] = pair.slice(eq + 1);
  } else if (arg.endsWith('.test.js')) {
    files.push(arg);
  } else {
    options.push(arg);
  }
}

function testFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...testFiles(path));
    else if (entry.name.endsWith('.test.js')) found.push(path);
  }
  return found;
}

if (files.length === 0) {
  if (!existsSync(ROOT)) {
    console.error(
      `run-tests: ${ROOT}/ does not exist — run the test build first`,
    );
    process.exit(1);
  }
  files.push(...testFiles(ROOT).sort());
  if (files.length === 0) {
    console.error(
      `run-tests: no *.test.js under ${ROOT}/ — the test build produced none`,
    );
    process.exit(1);
  }
}
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`run-tests: ${file} does not exist`);
    process.exit(1);
  }
}

const run = spawnSync(process.execPath, ['--test', ...options, ...files], {
  stdio: 'inherit',
  env,
});
process.exit(run.status ?? 1);
