/**
 * Diagnostics admission (spec §5.3) — the second boundary of goal
 * invariant 4. Each check takes `unknown`, never throws, and answers the
 * admitted value or `undefined` ("drop"): a value that fails is dropped, not
 * repaired, except where the spec cuts (`DocumentValue`, `XmlId`) or keeps a
 * part (`ConfigUri`). An admitted value is safe to print as it is: the
 * characters that could forge a log line are refused, not escaped.
 *
 * Which field a variant may carry comes from the diagnostics maps of
 * `@mcp-abap-adt/interfaces-auth` — `SAML_RULE_DIAGNOSTIC`,
 * `SNC_PROBLEM_DIAGNOSTICS`, `CONFIG_CASE_DIAGNOSTICS` — the same maps the
 * types read, so the runtime table and the types have one source.
 *
 * Built-ins this module calls on its input are captured at load, so a later
 * patch of `String.prototype` or `Reflect` changes no answer.
 */
import {
  CONFIG_CASE_DIAGNOSTICS,
  type ConfigDiagnosticField,
  type ConfigDiagnosticValues,
  type ConfigUri,
  type DocumentTime,
  type DocumentValue,
  type LocalPath,
  SAML_RULE_DIAGNOSTIC,
  type SamlDiagnosticField,
  type SamlDiagnosticValues,
  SNC_PROBLEM_DIAGNOSTICS,
  type SncDiagnosticValues,
  type XmlId,
  type XmlName,
} from '@mcp-abap-adt/interfaces-auth';
import { isAssertionRule, isConfigCase, isSncProblem } from './allowlists';

const charCodeAt: (text: string, index: number) => number =
  Function.prototype.call.bind(String.prototype.charCodeAt);
const sliceText: (text: string, start: number, end: number) => string =
  Function.prototype.call.bind(String.prototype.slice);
const getOwnDescriptor = Reflect.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const isInteger = Number.isInteger;
const freeze = Object.freeze;
const UrlClass = URL;

/** `LocalPath`: 1–1 024 code points, never truncated. */
const LOCAL_PATH_MAX = 1024;
/** `DocumentValue` / `XmlId`: cut to 64 code points (today's `quoteUntrusted` cap). */
const DOCUMENT_VALUE_MAX = 64;
const ELLIPSIS = '…';
/** `XmlName`: one start character and at most 63 more. */
const XML_NAME_MAX = 64;
/** `DocumentTime`: 1–40 characters. */
const DOCUMENT_TIME_MAX = 40;
/** `ConfigUri`: `origin + pathname`, at most 512 characters. */
const CONFIG_URI_MAX = 512;
/** `facts.candidates` of `snc` `library-not-found` holds at most 8 (§3.2). */
const SNC_CANDIDATES_MAX = 8;

/**
 * One own data property of `holder`, read once and total: a non-object, a
 * missing or inherited key, an accessor (whatever it would answer), and
 * anything that throws — a getter, a Proxy trap, a revoked Proxy — read as
 * absent.
 */
export function readOwn(holder: unknown, key: string): unknown {
  if (
    holder === null ||
    (typeof holder !== 'object' && typeof holder !== 'function')
  ) {
    return undefined;
  }
  try {
    const descriptor = getOwnDescriptor(holder, key);
    if (descriptor === undefined || !hasOwn(descriptor, 'value')) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

/**
 * A code point neither `LocalPath` nor `DocumentValue` admits: a C0 control,
 * DEL, a C1 control, U+2028 / U+2029, a bidirectional control (U+202A–U+202E,
 * U+2066–U+2069), or a surrogate (only a lone one reaches here).
 */
function isRefusedCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

/** Printable ASCII, U+0021–U+007E: the only characters of `referenceUri` / `statusCode`. */
function isPrintableAscii(codePoint: number): boolean {
  return codePoint >= 0x21 && codePoint <= 0x7e;
}

interface Scanned {
  /** The code points counted (all of them, unless the scan stopped past `stopAfter`). */
  readonly codePoints: number;
  /** The UTF-16 index just after the `limit`-th code point (the whole length when shorter). */
  readonly cutAt: number;
}

/**
 * Scans `text` code point by code point — a surrogate pair is one, a lone
 * surrogate is refused — and answers `undefined` when any is refused, or,
 * with `ascii`, when any is outside printable ASCII. The scan ends once the
 * count passes `stopAfter` (the caller drops the value then anyway).
 */
function scan(
  text: string,
  limit: number,
  ascii: boolean,
  stopAfter: number,
): Scanned | undefined {
  const length = text.length;
  let codePoints = 0;
  let cutAt = length;
  let index = 0;
  while (index < length) {
    const unit = charCodeAt(text, index);
    let codePoint = unit;
    let width = 1;
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < length) {
      const next = charCodeAt(text, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
        width = 2;
      }
    }
    if (isRefusedCodePoint(codePoint)) return undefined;
    if (ascii && !isPrintableAscii(codePoint)) return undefined;
    codePoints += 1;
    index += width;
    if (codePoints === limit) cutAt = index;
    if (codePoints > stopAfter) break;
  }
  return { codePoints, cutAt };
}

/**
 * `LocalPath`: a string of 1–1 024 code points with no refused character.
 * Never truncated — a truncated path misleads — so a longer one is dropped.
 */
export function admitLocalPath(value: unknown): LocalPath | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const scanned = scan(value, LOCAL_PATH_MAX, false, LOCAL_PATH_MAX);
  if (scanned === undefined || scanned.codePoints > LOCAL_PATH_MAX) {
    return undefined;
  }
  return value;
}

/** Non-empty, no refused character anywhere, cut at 64 code points with `…`. */
function admitCut(value: unknown, ascii: boolean): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const scanned = scan(
    value,
    DOCUMENT_VALUE_MAX,
    ascii,
    Number.POSITIVE_INFINITY,
  );
  if (scanned === undefined) return undefined;
  if (scanned.codePoints <= DOCUMENT_VALUE_MAX) return value;
  return `${sliceText(value, 0, scanned.cutAt)}${ELLIPSIS}`;
}

/**
 * `DocumentValue`: a non-empty string with no character `LocalPath` refuses
 * anywhere in it, cut to 64 code points — at a code-point boundary — with
 * `…` appended when longer.
 */
export function admitDocumentValue(value: unknown): DocumentValue | undefined {
  return admitCut(value, false);
}

/**
 * `DocumentValue` of the ASCII-only fields (`referenceUri`, `statusCode`):
 * additionally refuses anything outside U+0021–U+007E.
 */
export function admitAsciiDocumentValue(
  value: unknown,
): DocumentValue | undefined {
  return admitCut(value, true);
}

function isAsciiLetter(unit: number): boolean {
  return (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a);
}

function isAsciiDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

/** `[A-Za-z_]` */
function isNameStart(unit: number): boolean {
  return isAsciiLetter(unit) || unit === 0x5f;
}

/** `[A-Za-z0-9._-]` */
function isNameChar(unit: number): boolean {
  return (
    isNameStart(unit) || isAsciiDigit(unit) || unit === 0x2e || unit === 0x2d
  );
}

/** `^[A-Za-z_][A-Za-z0-9._-]*$`, at most `max` characters. */
function isXmlNameShape(value: string, max: number): boolean {
  const length = value.length;
  if (length === 0 || length > max) return false;
  if (!isNameStart(charCodeAt(value, 0))) return false;
  for (let index = 1; index < length; index += 1) {
    if (!isNameChar(charCodeAt(value, index))) return false;
  }
  return true;
}

/** `XmlName`: matches `^[A-Za-z_][A-Za-z0-9._-]{0,63}$`. */
export function admitXmlName(value: unknown): XmlName | undefined {
  if (typeof value !== 'string') return undefined;
  return isXmlNameShape(value, XML_NAME_MAX) ? value : undefined;
}

/** `XmlId`: matches `^[A-Za-z_][A-Za-z0-9._-]*$`, then cut as `DocumentValue`. */
export function admitXmlId(value: unknown): XmlId | undefined {
  if (typeof value !== 'string') return undefined;
  if (!isXmlNameShape(value, Number.POSITIVE_INFINITY)) return undefined;
  return admitCut(value, true);
}

/** `[0-9A-Za-z:.+-]` */
function isTimeChar(unit: number): boolean {
  return (
    isAsciiLetter(unit) ||
    isAsciiDigit(unit) ||
    unit === 0x3a ||
    unit === 0x2e ||
    unit === 0x2b ||
    unit === 0x2d
  );
}

/**
 * `DocumentTime`: matches `^[0-9A-Za-z:.+-]{1,40}$` — an `xsd:dateTime`
 * shape that failed strict parsing; the shape, not a valid time.
 */
export function admitDocumentTime(value: unknown): DocumentTime | undefined {
  if (typeof value !== 'string') return undefined;
  const length = value.length;
  if (length === 0 || length > DOCUMENT_TIME_MAX) return undefined;
  for (let index = 0; index < length; index += 1) {
    if (!isTimeChar(charCodeAt(value, index))) return undefined;
  }
  return value;
}

/**
 * `ConfigUri`: parses with `new URL`, protocol `http:` or `https:`, no
 * username or password; admitted as `origin + pathname` only (no query, no
 * fragment), at most 512 characters — longer is dropped, never truncated.
 */
export function admitConfigUri(value: unknown): ConfigUri | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new UrlClass(value);
    const protocol = url.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') return undefined;
    if (url.username !== '' || url.password !== '') return undefined;
    const admitted = `${url.origin}${url.pathname}`;
    return admitted.length <= CONFIG_URI_MAX ? admitted : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The runtime admission table: the one check per diagnostic field, module
 * private. Which fields a variant may carry is read from the interfaces-auth
 * maps, never from here.
 */
const SAML_FIELD_ADMISSION = {
  rootElement: admitXmlName,
  id: admitXmlId,
  referenceUri: admitAsciiDocumentValue,
  statusCode: admitAsciiDocumentValue,
  issuer: admitDocumentValue,
  notBefore: admitDocumentTime,
  notOnOrAfter: admitDocumentTime,
  destination: admitDocumentValue,
} satisfies {
  readonly [F in SamlDiagnosticField]: (
    value: unknown,
  ) => SamlDiagnosticValues[F] | undefined;
};

const CONFIG_FIELD_ADMISSION = {
  configuredUri: admitConfigUri,
  strategyUri: admitConfigUri,
} satisfies {
  readonly [F in ConfigDiagnosticField]: (
    value: unknown,
  ) => ConfigDiagnosticValues[F] | undefined;
};

/** Admitted `saml-assertion` diagnostics: at most the rule's one field. */
export type AdmittedSamlDiagnostics = {
  readonly [F in SamlDiagnosticField]?: SamlDiagnosticValues[F];
};
/** Admitted `snc` diagnostics. */
export type AdmittedSncDiagnostics = {
  readonly [F in keyof SncDiagnosticValues]?: SncDiagnosticValues[F];
};
/** Admitted `configuration` diagnostics. */
export type AdmittedConfigDiagnostics = {
  readonly [F in ConfigDiagnosticField]?: ConfigDiagnosticValues[F];
};

/**
 * The `saml-assertion` diagnostic rule `rule` permits
 * (`SAML_RULE_DIAGNOSTIC`), read from `input` and admitted; no other field
 * is read. `undefined` when nothing is admitted. Total.
 */
export function admitSamlDiagnostics(
  rule: unknown,
  input: unknown,
): AdmittedSamlDiagnostics | undefined {
  if (!isAssertionRule(rule)) return undefined;
  const field = SAML_RULE_DIAGNOSTIC[rule];
  if (field === null) return undefined;
  const value = SAML_FIELD_ADMISSION[field](readOwn(input, field));
  if (value === undefined) return undefined;
  const admitted: { -readonly [F in SamlDiagnosticField]?: string } = {};
  admitted[field] = value;
  return freeze(admitted);
}

/**
 * `candidatePaths`, index for index with the `candidateCount` candidates of
 * the facts: each a `LocalPath`, a dropped or missing one `null`. Not an
 * array (or unreadable), or a count outside 1–8: dropped.
 */
function admitCandidatePaths(
  value: unknown,
  candidateCount: unknown,
): readonly (LocalPath | null)[] | undefined {
  if (
    typeof candidateCount !== 'number' ||
    !isInteger(candidateCount) ||
    candidateCount < 1 ||
    candidateCount > SNC_CANDIDATES_MAX
  ) {
    return undefined;
  }
  try {
    if (!isArray(value)) return undefined;
  } catch {
    return undefined;
  }
  const paths: (LocalPath | null)[] = [];
  for (let index = 0; index < candidateCount; index += 1) {
    paths[index] = admitLocalPath(readOwn(value, `${index}`)) ?? null;
  }
  return freeze(paths);
}

/**
 * The `snc` diagnostics problem `problem` permits
 * (`SNC_PROBLEM_DIAGNOSTICS`), read from `input` and admitted;
 * `candidateCount` is the length of `facts.candidates`, so `candidatePaths`
 * stays aligned with it. `undefined` when nothing is admitted. Total.
 */
export function admitSncDiagnostics(
  problem: unknown,
  input: unknown,
  candidateCount: unknown,
): AdmittedSncDiagnostics | undefined {
  if (!isSncProblem(problem)) return undefined;
  const fields = SNC_PROBLEM_DIAGNOSTICS[problem];
  const admitted: {
    -readonly [F in keyof SncDiagnosticValues]?: SncDiagnosticValues[F];
  } = {};
  let any = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === 'library') {
      const library = admitLocalPath(readOwn(input, field));
      if (library !== undefined) {
        admitted.library = library;
        any = true;
      }
    } else if (field === 'candidatePaths') {
      const paths = admitCandidatePaths(readOwn(input, field), candidateCount);
      if (paths !== undefined) {
        admitted.candidatePaths = paths;
        any = true;
      }
    }
  }
  return any ? freeze(admitted) : undefined;
}

/**
 * The `configuration` diagnostics case `configCase` permits
 * (`CONFIG_CASE_DIAGNOSTICS`), read from `input` and admitted. `undefined`
 * when nothing is admitted. Total.
 */
export function admitConfigDiagnostics(
  configCase: unknown,
  input: unknown,
): AdmittedConfigDiagnostics | undefined {
  if (!isConfigCase(configCase)) return undefined;
  const fields = CONFIG_CASE_DIAGNOSTICS[configCase];
  const admitted: { -readonly [F in ConfigDiagnosticField]?: string } = {};
  let any = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (field === undefined) continue;
    const value = CONFIG_FIELD_ADMISSION[field](readOwn(input, field));
    if (value !== undefined) {
      admitted[field] = value;
      any = true;
    }
  }
  return any ? freeze(admitted) : undefined;
}
