import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** The repository root: what is packed. */
export const repositoryRoot = resolve(__dirname, '../..');

/** A child's answer, as it wrote it. */
export interface CommandRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** A temporary consumer holding the packed package, installed by name. */
export interface PackedConsumer {
  /** The consumer's directory; its `node_modules` holds the package. */
  readonly dir: string;
  /** The installed command, by its path inside `node_modules`. */
  readonly command: string;
  /** Runs `script` with Node in the consumer directory; answers stdout, trimmed. */
  readonly run: (script: string) => string;
  /**
   * Runs `command` (the installed one unless another is named) with Node,
   * in `cwd` (the consumer directory unless another is named).
   */
  readonly runCommand: (
    args: readonly string[],
    cwd?: string,
    command?: string,
  ) => CommandRun;
  /** Removes the consumer directory. */
  readonly remove: () => void;
}

/**
 * Packs the repository (`npm run build` must have run: `dist/` is packed as
 * it is), unpacks the tarball into a temporary `node_modules`, and links the
 * repository's installed interfaces-auth beside it — and its `typescript`
 * too when asked. Test scaffolding inside a temporary directory, not a
 * dependency of any package.
 */
export function packedConsumer(options: {
  readonly withTypescript: boolean;
}): PackedConsumer {
  const dir = mkdtempSync(join(tmpdir(), 'auth-errors-consumer-'));
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }),
  ) as Array<{ filename: string }>;
  const tarball = packed[0]?.filename;
  if (tarball === undefined) throw new Error('npm pack produced nothing');
  execFileSync('tar', ['-xzf', join(dir, tarball)], { cwd: dir });
  const scope = join(dir, 'node_modules/@mcp-abap-adt');
  mkdirSync(scope, { recursive: true });
  renameSync(join(dir, 'package'), join(scope, 'auth-errors'));
  symlinkSync(
    join(repositoryRoot, 'node_modules/@mcp-abap-adt/interfaces-auth'),
    join(scope, 'interfaces-auth'),
    'dir',
  );
  if (options.withTypescript) {
    symlinkSync(
      join(repositoryRoot, 'node_modules/typescript'),
      join(dir, 'node_modules/typescript'),
      'dir',
    );
  }
  const command = join(scope, 'auth-errors/tools/check-provider-shape.mjs');
  return {
    dir,
    command,
    run: (script) =>
      execFileSync(process.execPath, ['-e', script], {
        cwd: dir,
        encoding: 'utf8',
      }).trim(),
    runCommand: (args, cwd = dir, file = command) => {
      const result = spawnSync(process.execPath, [file, ...args], {
        cwd,
        encoding: 'utf8',
      });
      return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
    remove: () => rmSync(dir, { recursive: true, force: true }),
  };
}
