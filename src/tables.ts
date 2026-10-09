/**
 * The pieces a repository needs to keep a README table equal to what the
 * package says: the renderer, the allowlists' own module, and pure helpers
 * for rows and generated regions. Nothing here touches a file, the
 * environment or the compiler; the main entry does not load this module.
 */
import * as interfacesAuth from '@mcp-abap-adt/interfaces-auth';

export { render } from './words';

/** interfaces-auth as this package resolves it: the instance its guards are copied from. */
export const contract: typeof interfacesAuth = interfacesAuth;

/**
 * The row for each value, in the order of `values`. A value without an own
 * row throws, naming the table and the value; a row for a value not listed is
 * ignored.
 */
export function rowsFor<V extends string, R>(
  values: readonly V[],
  rows: Readonly<Record<string, R>>,
  table: string,
): readonly (readonly [V, R])[] {
  return values.map((value): readonly [V, R] => {
    if (!Object.hasOwn(rows, value)) {
      throw new Error(`${table}: no row for ${JSON.stringify(value)}`);
    }
    return [value, rows[value] as R];
  });
}

/** Text safe inside a Markdown table cell: `|` escaped. */
export function markdownCell(text: string): string {
  return text.replaceAll('|', '\\|');
}

/** A generated region: the markers and the body that goes between them. */
export interface GeneratedRegion {
  readonly open: string;
  readonly close: string;
  readonly body: string;
}

/**
 * `text` with each region's body between its first `open` and the first
 * `close` after it replaced by `\n<body>\n`. Everything else is untouched.
 * A missing marker, or a `close` only before the `open`, throws naming it.
 */
export function withRegions(
  text: string,
  regions: readonly GeneratedRegion[],
): string {
  let out = text;
  for (const region of regions) {
    const start = out.indexOf(region.open);
    if (start < 0) {
      throw new Error(
        `no region: the opening marker ${region.open} is missing`,
      );
    }
    const from = start + region.open.length;
    const end = out.indexOf(region.close, from);
    if (end < 0) {
      throw new Error(
        `no region: the closing marker ${region.close} is missing after ${region.open}`,
      );
    }
    out = `${out.slice(0, from)}\n${region.body}\n${out.slice(end)}`;
  }
  return out;
}

/**
 * Whether a run may rewrite README tables: `WRITE_README_TABLES` is `'1'`.
 * Unset is false; `'1'` with `CI` set, or any other value, throws. Reads only
 * the two keys of the object it is given.
 */
export function tableWriteMode(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const mode = env.WRITE_README_TABLES;
  if (mode === undefined) return false;
  if (mode !== '1') {
    throw new Error(
      `WRITE_README_TABLES must be unset or '1', not ${JSON.stringify(mode)}`,
    );
  }
  if (env.CI !== undefined) {
    throw new Error('WRITE_README_TABLES=1 is refused when CI is set');
  }
  return true;
}
