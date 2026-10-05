/**
 * Diagnostics admission (spec §5.3) — the second boundary of goal
 * invariant 4. Each check takes `unknown`, never throws, and answers the
 * admitted value or `undefined` ("drop"): a value that fails is dropped, not
 * repaired — every check refuses on the value as given, before anything is
 * parsed or cut. Only an admitted value is shortened: cut at 64 code points
 * (`DocumentValue`, `XmlId`) or reduced to `origin + pathname` (`ConfigUri`).
 * An admitted value is safe to print as it is: the code points that could
 * forge a log line, hide text or reorder it are refused, not escaped.
 *
 * Which field a variant may carry comes from the diagnostics maps of
 * `@mcp-abap-adt/interfaces-auth` — `SAML_RULE_DIAGNOSTIC`,
 * `SNC_PROBLEM_DIAGNOSTICS`, `CONFIG_CASE_DIAGNOSTICS` — the same maps the
 * types read, so the runtime table and the types have one source.
 *
 * The built-in functions this module calls directly are captured at load
 * (`charCodeAt`, `slice`, `RegExp.prototype.test`, `Reflect`, `Object`,
 * `Array.isArray`, the `URL` class). That is not a defence against code in
 * the same process: `RegExp.prototype.test` looks up `exec` when it runs, and
 * the `URL` accessors (`protocol`, `origin`, …) are read live. Code that
 * patches built-ins in this process is out of scope, as the README states.
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
  type SncDiagnosticField,
  type SncDiagnosticValues,
  type XmlId,
  type XmlName,
} from '@mcp-abap-adt/interfaces-auth';
import { isAssertionRule, isConfigCase, isSncProblem } from './allowlists';

const charCodeAt: (text: string, index: number) => number =
  Function.prototype.call.bind(String.prototype.charCodeAt);
const sliceText: (text: string, start: number, end: number) => string =
  Function.prototype.call.bind(String.prototype.slice);
const regExpTest: (pattern: RegExp, text: string) => boolean =
  Function.prototype.call.bind(RegExp.prototype.test);
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
 * The General_Categories refused whole: Cc (C0, DEL, C1), Cf (format: the
 * bidirectional controls, zero-width characters, the BOM, the Unicode tag
 * characters U+E0000–U+E007F that smuggle hidden text, …), Cs (a lone
 * surrogate: in `u` mode a lone surrogate is its own code point), Zl, Zp,
 * and Co (private use). Built once, at load; no `g` or `y` flag, so it keeps
 * no `lastIndex` between calls.
 */
const REFUSED_CATEGORIES = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Co}]/u;

/**
 * Refused code points outside those categories, each listed: the
 * noncharacters (U+FDD0–U+FDEF and U+xFFFE / U+xFFFF of every plane), the
 * variation selectors (U+FE00–U+FE0F, U+E0100–U+E01EF), the combining
 * grapheme joiner U+034F, the whole tag block U+E0000–U+E007F (its
 * unassigned code points are Cn, which `\p{Cf}` misses), and the Hangul
 * fillers U+115F, U+1160, U+3164, U+FFA0 — invisible, or changing what is
 * shown without being seen.
 */
function isRefusedOutsideCategories(codePoint: number): boolean {
  return (
    (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
    (codePoint & 0xfffe) === 0xfffe ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    (codePoint >= 0xe0000 && codePoint <= 0xe007f) ||
    codePoint === 0x034f ||
    codePoint === 0x115f ||
    codePoint === 0x1160 ||
    codePoint === 0x3164 ||
    codePoint === 0xffa0
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
 * Answers `undefined` when `text` holds a refused code point anywhere — one
 * of `REFUSED_CATEGORIES`, tested over the whole value first, or one
 * `isRefusedOutsideCategories` names — or, with `ascii`, any code point
 * outside printable ASCII. Otherwise counts code points (a surrogate pair is
 * one) and finds the cut. The count stops once past `stopAfter` (the caller
 * drops the value then anyway); the category test has covered the rest.
 */
function scan(
  text: string,
  limit: number,
  ascii: boolean,
  stopAfter: number,
): Scanned | undefined {
  if (regExpTest(REFUSED_CATEGORIES, text)) return undefined;
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
    if (isRefusedOutsideCategories(codePoint)) return undefined;
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
 * `ConfigUri`: no refused code point in the value as given — checked before
 * parsing, since the URL parser would strip a tab or newline and
 * percent-encode the rest, repairing what must be dropped — then parses with
 * `new URL`, protocol `http:` or `https:`, no username or password; admitted
 * as `origin + pathname` only (no query, no fragment), at most 512
 * characters — longer is dropped, never truncated.
 */
export function admitConfigUri(value: unknown): ConfigUri | undefined {
  if (typeof value !== 'string') return undefined;
  if (scan(value, 0, false, Number.POSITIVE_INFINITY) === undefined) {
    return undefined;
  }
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

/**
 * One check per `snc` field. Annotated with a mapped type over
 * `SncDiagnosticField` rather than `satisfies` — it fails to compile in the
 * same way when a field has no entry — so that `admitSncField` can index it
 * with a generic field and keep each field's own value type.
 */
const SNC_FIELD_ADMISSION: {
  readonly [F in SncDiagnosticField]: (
    value: unknown,
    candidateCount: unknown,
  ) => SncDiagnosticValues[F] | undefined;
} = {
  library: (value) => admitLocalPath(value),
  candidatePaths: (value, candidateCount) =>
    admitCandidatePaths(value, candidateCount),
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

type MutableSncDiagnostics = {
  -readonly [F in SncDiagnosticField]?: SncDiagnosticValues[F];
};

/** Admits `field` from `input` into `admitted` through the table; `true` when kept. */
function admitSncField<F extends SncDiagnosticField>(
  admitted: MutableSncDiagnostics,
  field: F,
  input: unknown,
  candidateCount: unknown,
): boolean {
  const value = SNC_FIELD_ADMISSION[field](
    readOwn(input, field),
    candidateCount,
  );
  if (value === undefined) return false;
  admitted[field] = value;
  return true;
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
  const admitted: MutableSncDiagnostics = {};
  let any = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (
      field !== undefined &&
      admitSncField(admitted, field, input, candidateCount)
    ) {
      any = true;
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
