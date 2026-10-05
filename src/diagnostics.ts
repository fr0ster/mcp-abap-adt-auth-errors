/**
 * The diagnostics renderer and the log fields (spec §5.6, §3.3).
 *
 * Diagnostics are kept only on an error this copy minted (`isMinted`): the
 * builder admitted each field and froze the error, so these functions render
 * what is there and re-admit nothing. An error that is not minted — a
 * structural copy, another copy's error, anything else — has its
 * diagnostics never read: `renderDiagnostics` answers `undefined`, and
 * `logFields` answers the fields of what `classify` makes of it.
 *
 * Both functions are total and read only own data properties, once each
 * (`readOwn`): no getter or `toPrimitive` of the input is invoked; of a
 * Proxy, only the `getOwnPropertyDescriptor` trap may run, and one that
 * throws reads as absent. Neither is called by `render`.
 */
import type {
  AuthProviderErrorFacts,
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { readOwn } from './admission';
import { isAuthProviderErrorKind } from './allowlists';
import { classify } from './classify';
import { checkFacts } from './factCheck';
import { isMinted } from './mint';
import { ASSERTION_RULE_CHECK, render } from './words';

const quote: (value: string) => string = JSON.stringify;
const isArray = Array.isArray;

/** Each variant kind's diagnostic fields, in the order they are rendered. */
const SAML_FIELDS = Object.freeze([
  'rootElement',
  'id',
  'referenceUri',
  'statusCode',
  'issuer',
  'notBefore',
  'notOnOrAfter',
  'destination',
] as const);
const CONFIG_FIELDS = Object.freeze(['configuredUri', 'strategyUri'] as const);

/** `name: "value"` for each listed field of `holder` that is a string. */
function stringLines(holder: unknown, fields: readonly string[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined) continue;
    const value = readOwn(holder, field);
    if (typeof value === 'string') lines.push(`${field}: ${quote(value)}`);
  }
  return lines;
}

/**
 * `candidates: SOURCE "path" (reason); …`: each candidate of the checked
 * facts with its path from `candidatePaths`, index for index. A path that is
 * `null`, absent or not a string reads `(no path)`.
 */
function candidatesLine(
  facts: AuthProviderErrorFacts['snc'],
  paths: unknown,
): string | undefined {
  if (facts.problem !== 'library-not-found') return undefined;
  const candidates = facts.candidates;
  if (candidates === undefined || candidates.length === 0) return undefined;
  if (!isArray(paths)) return undefined;
  const parts: string[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const path = readOwn(paths, `${index}`);
    const shown = typeof path === 'string' ? quote(path) : '(no path)';
    parts.push(`${candidate.source} ${shown} (${candidate.reason})`);
  }
  return parts.length === 0 ? undefined : `candidates: ${parts.join('; ')}`;
}

function sncLines(error: unknown, diagnostics: unknown): string[] {
  const lines = stringLines(diagnostics, ['library']);
  const facts = checkFacts(
    'snc',
    readOwn(error, 'facts'),
    ASSERTION_RULE_CHECK,
  );
  if (facts !== undefined) {
    const line = candidatesLine(facts, readOwn(diagnostics, 'candidatePaths'));
    if (line !== undefined) lines.push(line);
  }
  return lines;
}

/**
 * One line per diagnostic field of an error this copy minted, values
 * JSON-quoted, joined by a line feed; `undefined` when the error is not
 * minted here, carries no diagnostics, or none renders. Total.
 */
export function renderDiagnostics(
  error: IAuthProviderError,
): string | undefined {
  try {
    if (!isMinted(error)) return undefined;
    const diagnostics = readOwn(error, 'diagnostics');
    if (diagnostics === null || typeof diagnostics !== 'object') {
      return undefined;
    }
    const kind = readOwn(error, 'kind');
    let lines: string[];
    switch (kind) {
      case 'saml-assertion':
        lines = stringLines(diagnostics, SAML_FIELDS);
        break;
      case 'snc':
        lines = sncLines(error, diagnostics);
        break;
      case 'configuration':
        lines = stringLines(diagnostics, CONFIG_FIELDS);
        break;
      default:
        return undefined;
    }
    return lines.length === 0 ? undefined : lines.join('\n');
  } catch {
    return undefined;
  }
}

/** What a log line may carry of an error. */
export type LogFields = {
  readonly error: string;
  readonly kind: AuthProviderErrorKind;
  readonly status?: number;
  readonly diagnostics?: string;
};

/** The fields of the unfamiliar error: what a value this copy cannot read is. */
function unfamiliarFields(): LogFields {
  const facts: AuthProviderErrorFacts['unknown'] = {
    operation: 'unfamiliar-error',
  };
  return { error: render('unknown', facts).reason, kind: 'unknown' };
}

/**
 * What a log line may carry: `{ error: reason, kind, status?, diagnostics? }`.
 * `status` only when the error's facts hold a valid HTTP status;
 * `diagnostics` (the rendered text, as its own field so a logger can drop
 * it) only for an error this copy minted. A value that is not minted here
 * is classified first (`classify`, operation `unfamiliar-error`) and
 * answers the fields of what that gives. Total.
 */
export function logFields(error: IAuthProviderError): LogFields {
  try {
    // A value this copy did not mint is classified first: a carrier of a
    // minted error answers that error's fields, a structure its rebuild's
    // (re-rendered, no diagnostics), anything else `unknown`.
    const known = isMinted(error) ? error : classify(error, 'unfamiliar-error');
    const kind = readOwn(known, 'kind');
    const reason = readOwn(known, 'reason');
    if (!isAuthProviderErrorKind(kind) || typeof reason !== 'string') {
      return unfamiliarFields();
    }
    const facts = checkFacts(
      kind,
      readOwn(known, 'facts'),
      ASSERTION_RULE_CHECK,
    );
    const status = readOwn(facts, 'status');
    const diagnostics = renderDiagnostics(known);
    return {
      error: reason,
      kind,
      ...(typeof status === 'number' ? { status } : {}),
      ...(diagnostics === undefined ? {} : { diagnostics }),
    };
  } catch {
    return unfamiliarFields();
  }
}
