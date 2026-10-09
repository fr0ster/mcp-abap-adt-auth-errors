import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const README = readFileSync(resolve(__dirname, '../../README.md'), 'utf8');
const PACKAGE = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
) as {
  readonly name: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly dependencies: Readonly<Record<string, string>>;
};

/** The text of a `## ` section, up to the next one. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`no section ${heading}`);
  const from = start + 1;
  const end = README.indexOf('\n## ', from + 1);
  return README.slice(from, end < 0 ? undefined : end);
}

describe('the README', () => {
  it('Install names every path of the exports map, by name', () => {
    const install = section('Install');
    const paths = Object.keys(PACKAGE.exports);
    expect(paths).toHaveLength(5);
    for (const path of paths) {
      const name =
        path === '.' ? PACKAGE.name : `${PACKAGE.name}/${path.slice(2)}`;
      expect(install).toContain(`\`${name}\``);
    }
  });

  it('states the interfaces-auth range of package.json wherever it states one', () => {
    const range = PACKAGE.dependencies['@mcp-abap-adt/interfaces-auth'];
    expect(section('Install')).toContain(
      `\`@mcp-abap-adt/interfaces-auth\` \`${range}\``,
    );
    expect(section('Versioning')).toContain(`depends on \`${range}\``);
  });

  it('cites no document and no copy of the command', () => {
    expect(README).not.toContain('§');
    expect(README).not.toContain('byte for byte');
  });
});
