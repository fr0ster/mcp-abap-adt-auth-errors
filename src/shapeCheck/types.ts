import type * as ts from 'typescript';

/** A rule of the shape check, by its number. */
export type ShapeRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * What to check, each option the command's argument of the same name,
 * already resolved: nothing is read from the working directory and nothing
 * is defaulted. `project` and `sites` are stated even when absent (`null`):
 * `project: null` checks under strict defaults, every file under
 * `<root>/src` when no files are given; `sites: null` is two empty lists.
 */
export interface ShapeCheckOptions {
  /** The caller's own TypeScript module: it decides the rules. */
  readonly typescript: typeof ts;
  readonly rules: readonly ShapeRule[];
  /** The repository root, absolute. */
  readonly root: string;
  /** Its tsconfig, absolute; `null` when there is none. */
  readonly project: string | null;
  /** The directory of the site lists, absolute; `null` when there is none. */
  readonly sites: string | null;
  /** The base, by declaration: `<module>#<export>`. */
  readonly base?: string | undefined;
  /** The files to check instead of the project's, absolute. */
  readonly files?: readonly string[] | undefined;
}

export interface ShapeFinding {
  /** Relative to the root, `/`-separated. */
  readonly file: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  readonly rule: ShapeRule;
  readonly what: string;
}

export type ShapeCheckReport =
  | { readonly status: 'checked'; readonly findings: readonly ShapeFinding[] }
  | { readonly status: 'usage-error'; readonly message: string }
  | { readonly status: 'type-errors'; readonly diagnostics: string };
