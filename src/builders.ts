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

const keysOf = Object.keys;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const getProperty = Reflect.get;

/** `configuration` `fields`: at most eight, deduplicated, in the order given. */
const FIELDS_MAX = 8;
/** `saml-assertion` `candidates` (`no-bearer-qualifies`): at most five. */
const BEARER_CANDIDATES_MAX = 5;
/** `snc` `candidates` (`library-not-found`): at most eight. */
const SNC_CANDIDATES_MAX = 8;

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
const SAML_ARRAYS: ArrayRules = Object.freeze({
  candidates: Object.freeze({ max: BEARER_CANDIDATES_MAX, deduplicate: false }),
});
const SNC_ARRAYS: ArrayRules = Object.freeze({
  candidates: Object.freeze({ max: SNC_CANDIDATES_MAX, deduplicate: false }),
});

/**
 * A copy of plain data: an array element by element, an object key by key
 * with every `undefined`-valued key omitted, anything else as it is. Nothing
 * the caller holds is shared with the error.
 */
function copyData(value: unknown): unknown {
  if (isArray(value)) {
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      copy.push(copyData(value[index]));
    }
    return copy;
  }
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const key of keysOf(value)) {
      const inner: unknown = getProperty(value, key);
      if (inner !== undefined) copy[key] = copyData(inner);
    }
    return copy;
  }
  return value;
}

/** An array of the facts, copied, deduplicated when the rule says so, capped. */
function copyArray(values: readonly unknown[], rule: ArrayRule): unknown[] {
  const copy: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (copy.length >= rule.max) break;
    const value = values[index];
    if (rule.deduplicate && copy.includes(value)) continue;
    copy.push(copyData(value));
  }
  return copy;
}

/**
 * The facts as the error keeps them: every key whose value is not
 * `undefined`, copied; each array a rule names, capped (and deduplicated).
 * The facts' type is unchanged — a cap or a dropped duplicate leaves a value
 * of the same type.
 */
function normalise<T extends object>(facts: T, rules: ArrayRules): T;
function normalise(facts: object, rules: ArrayRules): object {
  const kept: Record<string, unknown> = {};
  for (const key of keysOf(facts)) {
    const value: unknown = getProperty(facts, key);
    if (value === undefined) continue;
    const rule = hasOwn(rules, key) ? rules[key] : undefined;
    kept[key] =
      rule !== undefined && isArray(value)
        ? copyArray(value, rule)
        : copyData(value);
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
    facts.rule === 'no-bearer-qualifies' &&
    kept.rule === 'no-bearer-qualifies'
  ) {
    const given = facts.candidates?.length ?? 0;
    const cut = given - BEARER_CANDIDATES_MAX;
    if (cut > 0) {
      const more = count((kept.moreCandidates ?? 0) + cut);
      if (more !== undefined) kept = { ...kept, moreCandidates: more };
    }
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
