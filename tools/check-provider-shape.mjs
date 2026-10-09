#!/usr/bin/env node
/**
 * The shape check of the MCP ABAP ADT authentication error contract, as a
 * command: the rules TypeScript alone cannot express, decided on the
 * TypeScript compiler API. The rules, what each decides and what it does not
 * see are the module's, `@mcp-abap-adt/auth-errors/shape-check`; this file
 * reads the arguments, runs the module with the `typescript` it resolves
 * from its own location, and prints the report.
 *
 *   node tools/check-provider-shape.mjs --rules 4,5,6
 *     [--base <module>#AuthProviderBase]
 *                          the base, by declaration — required by rules 1–3
 *     [--root <dir>]       the repository root (default: the working directory)
 *     [--project <file>]   its tsconfig (default: <root>/tsconfig.json)
 *     [--sites <dir>]      where assertion-sites.json and
 *                          diagnostic-sites.json live (default: <root>/tools)
 *     [files…]             check these files instead of the project's
 *
 * Relative paths are resolved against the working directory. A project file
 * or a sites directory that does not exist is none: strict defaults over
 * every file under `<root>/src`, and two empty site lists.
 *
 * Each finding is one line on stdout, `<file>:<line>:<column>: rule <n>:
 * <what>`, the file relative to the root. Exit 0: nothing found; 1: findings;
 * 2, reported on stderr: a usage error (with the usage line), a program
 * that does not type-check (with its diagnostics), or a report this command
 * does not know.
 *
 * It finds the module by name: from the installed package, from the
 * auth-errors repository itself after a build, and from a copy in another
 * repository's `tools/` through that repository's installed auth-errors.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import shapeCheck from '@mcp-abap-adt/auth-errors/shape-check';
import ts from 'typescript';

const { checkProviderShape, formatFinding } = shapeCheck;

const USAGE =
  'usage: check-provider-shape.mjs --rules <n,…> [--base <module>#AuthProviderBase] [--root <dir>] [--project <tsconfig>] [--sites <dir>] [files…]';
const KNOWN_RULES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const options = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === '--rules' ||
      arg === '--base' ||
      arg === '--root' ||
      arg === '--project' ||
      arg === '--sites'
    ) {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.rules === undefined) fail('--rules is required');
  const rules = new Set();
  for (const part of options.rules.split(',')) {
    const rule = Number(part.trim());
    if (!KNOWN_RULES.has(rule)) fail(`unknown rule ${part}`);
    rules.add(rule);
  }
  const root = resolve(options.root ?? process.cwd());
  const project = resolve(options.project ?? join(root, 'tsconfig.json'));
  const sites = resolve(options.sites ?? join(root, 'tools'));
  return {
    typescript: ts,
    rules: [...rules],
    root,
    project: existsSync(project) ? project : null,
    sites: existsSync(sites) ? sites : null,
    base: options.base,
    files: options.files.map((file) => resolve(file)),
  };
}

const report = checkProviderShape(parseArguments(process.argv.slice(2)));
switch (report.status) {
  case 'usage-error':
    fail(report.message);
    break;
  case 'type-errors':
    process.stderr.write(
      `the shape check needs a program that type-checks:\n${report.diagnostics}`,
    );
    process.exit(2);
    break;
  case 'checked':
    for (const finding of report.findings) {
      process.stdout.write(`${formatFinding(finding)}\n`);
    }
    process.exit(report.findings.length > 0 ? 1 : 0);
    break;
  default:
    // A report this command does not know is not a pass.
    process.stderr.write(
      'the shape check answered a report this command does not know\n',
    );
    process.exit(2);
}
