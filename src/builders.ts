/**
 * The builders (spec §5.2): one per kind, the only exported way to obtain an
 * error. A builder normalises the facts it is given — absent keys omitted,
 * arrays copied, capped and (for `fields`) deduplicated — admits each
 * diagnostic its variant permits (`admission.ts`), renders `reason` / `hint`
 * from `kind` and the normalised facts (`words.ts`), and mints (`mint.ts`),
 * which freezes the whole error deeply.
 *
 * Facts are not re-checked at run time: their types are the check, and facts
 * from an unknown source go through classification, never a builder. Each
 * permitted diagnostic is `unknown` at the call — the builder, not the
 * caller, decides what is admitted, and only the fields the interfaces-auth
 * maps permit for the facts' discriminant are read at all: a JavaScript
 * caller passing a forbidden field gets it dropped. A refused value is
 * dropped and the error is still minted.
 */
import type {
  AssertionRule,
  AuthProviderErrorFacts,
  AuthProviderErrorKind,
  AuthProviderErrorOf,
  ConfigCase,
  ConfigDiagnosticField,
  ConfigDiagnosticOf,
  ConfigFactsOf,
  ConfigurationError,
  IAuthProviderError,
  PlainKind,
  SamlAssertionError,
  SamlDiagnosticField,
  SamlDiagnosticOf,
  SamlFactsOf,
  SncDiagnosticField,
  SncDiagnosticOf,
  SncError,
  SncFactsOf,
  SncProblem,
} from '@mcp-abap-adt/interfaces-auth';
import {
  admitConfigDiagnostics,
  admitSamlDiagnostics,
  admitSncDiagnostics,
  readOwn,
} from './admission';
import { type ErrorDraft, mint } from './mint';
import { count } from './numbers';
import { render, type Words } from './words';

/** A single member of a union, else never: the correlation needs one variant. */
export type One<T, A = T> = T extends unknown
  ? [A] extends [T]
    ? T
    : never
  : never;

/** Raw candidates, admitted by the builder: permitted fields `unknown`, the rest `never`. */
export type DiagnosticsInputOf<All extends string, Allowed extends All> = {
  readonly [F in All]?: F extends Allowed ? unknown : never;
};

/** The builders of the three kinds with diagnostics: generic over the variant. */
export interface VariantBuilders {
  'saml-assertion'<R extends AssertionRule>(
    facts: SamlFactsOf<One<R>>,
    diagnostics?: DiagnosticsInputOf<SamlDiagnosticField, SamlDiagnosticOf<R>>,
  ): Extract<SamlAssertionError, { variant: R }>;
  snc<P extends SncProblem>(
    facts: SncFactsOf<One<P>>,
    diagnostics?: DiagnosticsInputOf<SncDiagnosticField, SncDiagnosticOf<P>>,
  ): Extract<SncError, { variant: P }>;
  configuration<C extends ConfigCase>(
    facts: ConfigFactsOf<One<C>>,
    diagnostics?: DiagnosticsInputOf<
      ConfigDiagnosticField,
      ConfigDiagnosticOf<C>
    >,
  ): Extract<ConfigurationError, { variant: C }>;
}

/** Every other kind: facts only, no diagnostics parameter at all. */
export type PlainBuilders = {
  readonly [K in PlainKind]: (
    facts: AuthProviderErrorFacts[K],
  ) => AuthProviderErrorOf<K>;
};

/** `authError`: one builder per kind. */
export type AuthErrorBuilders = Readonly<VariantBuilders> & PlainBuilders;

const ownKeys = Reflect.ownKeys;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const isInteger = Number.isInteger;

/** `configuration` `fields`: at most eight, deduplicated, in the order given. */
const FIELDS_MAX = 8;
/** `saml-assertion` `candidates` (`no-bearer-qualifies`): at most five. */
const BEARER_CANDIDATES_MAX = 5;
/** `snc` `candidates` (`library-not-found`): at most eight. */
const SNC_CANDIDATES_MAX = 8;
/** At most this many elements of any array a caller hands over are read. */
const READ_MAX = 1024;
/** Nested data deeper than this is read as absent. */
const DEPTH_MAX = 8;

/** How one top-level array of a kind's facts is normalised. */
interface ArrayRule {
  readonly max: number;
  readonly deduplicate: boolean;
}
type ArrayRules = { readonly [key: string]: ArrayRule };

const NO_ARRAY_RULES: ArrayRules = Object.freeze({});
const CONFIGURATION_ARRAYS: ArrayRules = Object.freeze({
  fields: Object.freeze({ max: FIELDS_MAX, deduplicate: true }),
});
/** Every bearer candidate read is kept here; `buildSaml` cuts and counts. */
const SAML_ARRAYS: ArrayRules = Object.freeze({
  candidates: Object.freeze({ max: READ_MAX, deduplicate: false }),
});
const SNC_ARRAYS: ArrayRules = Object.freeze({
  candidates: Object.freeze({ max: SNC_CANDIDATES_MAX, deduplicate: false }),
});

/** Whether `value` is an array; a revoked Proxy (which throws) is not. */
function isArrayGuarded(value: unknown): value is readonly unknown[] {
  try {
    return isArray(value);
  } catch {
    return false;
  }
}

/** The own string keys of `value` (never `__proto__`); `undefined` when listing throws. */
function stringKeys(value: object): string[] | undefined {
  const keys: string[] = [];
  try {
    for (const key of ownKeys(value)) {
      if (typeof key === 'string' && key !== '__proto__') keys.push(key);
    }
  } catch {
    return undefined;
  }
  return keys;
}

/** How many elements of an array are read: its own `length`, at most READ_MAX. */
function readableLength(value: object): number {
  const length = readOwn(value, 'length');
  return typeof length === 'number' && isInteger(length) && length > 0
    ? Math.min(length, READ_MAX)
    : 0;
}

/**
 * A copy of plain data, read only through `readOwn`: a getter, a Proxy trap
 * that throws, a revoked Proxy, a cycle or nesting past DEPTH_MAX read as
 * absent, never as a throw. Strings, numbers and booleans are kept; any other
 * primitive or a function is absent. An array keeps its elements in order,
 * holes and absent elements dropped; an object keeps every key whose value is
 * not absent; an object whose keys cannot be listed (a revoked Proxy, an
 * `ownKeys` trap that throws) is absent. Nothing the caller holds is shared with the error.
 */
function copyData(value: unknown, ancestors: object[]): unknown {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (value === null || typeof value !== 'object') return undefined;
  if (ancestors.length >= DEPTH_MAX || ancestors.includes(value)) {
    return undefined;
  }
  ancestors.push(value);
  try {
    if (isArrayGuarded(value)) {
      const copy: unknown[] = [];
      const length = readableLength(value);
      for (let index = 0; index < length; index += 1) {
        const element = copyData(readOwn(value, `${index}`), ancestors);
        if (element !== undefined) copy.push(element);
      }
      return copy;
    }
    const keys = stringKeys(value);
    if (keys === undefined) return undefined;
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const inner = copyData(readOwn(value, key), ancestors);
      if (inner !== undefined) copy[key] = inner;
    }
    return copy;
  } finally {
    ancestors.pop();
  }
}

/**
 * An array of the facts, copied as `copyData` copies, holes and absent
 * elements dropped, deduplicated when the rule says so, capped.
 */
function copyArray(values: readonly unknown[], rule: ArrayRule): unknown[] {
  const copy: unknown[] = [];
  const length = readableLength(values);
  for (let index = 0; index < length && copy.length < rule.max; index += 1) {
    const value = copyData(readOwn(values, `${index}`), [values]);
    if (value === undefined) continue;
    if (rule.deduplicate && copy.includes(value)) continue;
    copy.push(value);
  }
  return copy;
}

/**
 * The facts as the error keeps them: every own data key whose value is not
 * absent, copied (`copyData`); each array a rule names, capped (and
 * deduplicated). Never throws. The facts' type is unchanged — a cap or a
 * dropped duplicate leaves a value of the same type; values themselves are
 * the types' to check (classification re-checks foreign ones).
 */
function normalise<T extends object>(facts: T, rules: ArrayRules): T;
function normalise(facts: object, rules: ArrayRules): object {
  const kept: Record<string, unknown> = {};
  if (facts === null || typeof facts !== 'object') return kept;
  for (const key of stringKeys(facts) ?? []) {
    const value = readOwn(facts, key);
    const rule = hasOwn(rules, key) ? rules[key] : undefined;
    const copy =
      rule !== undefined && isArrayGuarded(value)
        ? copyArray(value, rule)
        : copyData(value, [facts]);
    if (copy !== undefined) kept[key] = copy;
  }
  return kept;
}

/** The error before its brand: keys in a fixed order, absent ones omitted. */
function draft(
  kind: AuthProviderErrorKind,
  variant: string | undefined,
  facts: object,
  words: Words,
  diagnostics: object | undefined,
): ErrorDraft {
  return {
    kind,
    ...(variant === undefined ? {} : { variant }),
    facts,
    reason: words.reason,
    ...(words.hint === undefined ? {} : { hint: words.hint }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  };
}

function buildSaml<R extends AssertionRule>(
  facts: SamlFactsOf<One<R>>,
  diagnostics?: DiagnosticsInputOf<SamlDiagnosticField, SamlDiagnosticOf<R>>,
): Extract<SamlAssertionError, { variant: R }>;
function buildSaml(
  facts: AuthProviderErrorFacts['saml-assertion'],
  diagnostics?: unknown,
): IAuthProviderError {
  let kept = normalise(facts, SAML_ARRAYS);
  // Candidates past the fifth are not lost: they are counted.
  if (
    kept.rule === 'no-bearer-qualifies' &&
    kept.candidates !== undefined &&
    kept.candidates.length > BEARER_CANDIDATES_MAX
  ) {
    const more = count(
      (kept.moreCandidates ?? 0) +
        kept.candidates.length -
        BEARER_CANDIDATES_MAX,
    );
    kept = {
      ...kept,
      candidates: kept.candidates.slice(0, BEARER_CANDIDATES_MAX),
      ...(more === undefined ? {} : { moreCandidates: more }),
    };
  }
  return mint(
    draft(
      'saml-assertion',
      kept.rule,
      kept,
      render('saml-assertion', kept),
      admitSamlDiagnostics(kept.rule, diagnostics),
    ),
  );
}

function buildSnc<P extends SncProblem>(
  facts: SncFactsOf<One<P>>,
  diagnostics?: DiagnosticsInputOf<SncDiagnosticField, SncDiagnosticOf<P>>,
): Extract<SncError, { variant: P }>;
function buildSnc(
  facts: AuthProviderErrorFacts['snc'],
  diagnostics?: unknown,
): IAuthProviderError {
  const kept = normalise(facts, SNC_ARRAYS);
  // candidatePaths stays aligned with the candidates the error keeps.
  const candidateCount =
    kept.problem === 'library-not-found' ? kept.candidates?.length : undefined;
  return mint(
    draft(
      'snc',
      kept.problem,
      kept,
      render('snc', kept),
      admitSncDiagnostics(kept.problem, diagnostics, candidateCount),
    ),
  );
}

function buildConfiguration<C extends ConfigCase>(
  facts: ConfigFactsOf<One<C>>,
  diagnostics?: DiagnosticsInputOf<
    ConfigDiagnosticField,
    ConfigDiagnosticOf<C>
  >,
): Extract<ConfigurationError, { variant: C }>;
function buildConfiguration(
  facts: AuthProviderErrorFacts['configuration'],
  diagnostics?: unknown,
): IAuthProviderError {
  const kept = normalise(facts, CONFIGURATION_ARRAYS);
  return mint(
    draft(
      'configuration',
      kept.case,
      kept,
      render('configuration', kept),
      admitConfigDiagnostics(kept.case, diagnostics),
    ),
  );
}

/** A kind without variant or diagnostics: facts, words, mint. */
function plain<K extends PlainKind>(
  kind: K,
  facts: AuthProviderErrorFacts[K],
): AuthProviderErrorOf<K>;
function plain(
  kind: PlainKind,
  facts: AuthProviderErrorFacts[PlainKind],
): IAuthProviderError {
  const kept = normalise(facts, NO_ARRAY_RULES);
  return mint(draft(kind, undefined, kept, render(kind, kept), undefined));
}

/**
 * One builder per kind — the only exported way to obtain an error. Frozen:
 * no builder can be replaced.
 *
 * ```ts
 * authError['client-certificate']({ problem: 'expired' });
 * authError.snc({ problem: 'no-credential', secureLoginClient: false }, { library: path });
 * authError['saml-assertion']({ rule: 'duplicate-id', check: 'duplicateId' }, { id: value });
 * ```
 */
export const authError: AuthErrorBuilders = Object.freeze({
  'saml-assertion': buildSaml,
  snc: buildSnc,
  configuration: buildConfiguration,
  'client-certificate': (facts: AuthProviderErrorFacts['client-certificate']) =>
    plain('client-certificate', facts),
  'client-authentication': (
    facts: AuthProviderErrorFacts['client-authentication'],
  ) => plain('client-authentication', facts),
  'request-failed': (facts: AuthProviderErrorFacts['request-failed']) =>
    plain('request-failed', facts),
  tls: (facts: AuthProviderErrorFacts['tls']) => plain('tls', facts),
  'interactive-login': (facts: AuthProviderErrorFacts['interactive-login']) =>
    plain('interactive-login', facts),
  'credential-refused': (facts: AuthProviderErrorFacts['credential-refused']) =>
    plain('credential-refused', facts),
  'system-refused': (facts: AuthProviderErrorFacts['system-refused']) =>
    plain('system-refused', facts),
  'renewal-unchanged': (facts: AuthProviderErrorFacts['renewal-unchanged']) =>
    plain('renewal-unchanged', facts),
  'token-binding': (facts: AuthProviderErrorFacts['token-binding']) =>
    plain('token-binding', facts),
  'not-prepared': (facts: AuthProviderErrorFacts['not-prepared']) =>
    plain('not-prepared', facts),
  'logon-target': (facts: AuthProviderErrorFacts['logon-target']) =>
    plain('logon-target', facts),
  connection: (facts: AuthProviderErrorFacts['connection']) =>
    plain('connection', facts),
  unknown: (facts: AuthProviderErrorFacts['unknown']) =>
    plain('unknown', facts),
});
