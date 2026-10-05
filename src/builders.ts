/**
 * The builders (spec §5.2): one per kind, the only exported way to obtain an
 * error. A builder reads and checks the facts it is given (`factCheck.ts`:
 * own data properties only, each against its allowlist guard or maker,
 * arrays capped and `fields` deduplicated) — a required fact that fails
 * makes the call answer the unfamiliar error, an optional one is dropped —
 * admits each diagnostic its variant permits (`admission.ts`), renders
 * `reason` / `hint` from `kind` and the checked facts (`words.ts`), and mints
 * (`mint.ts`), which freezes the whole error deeply. A builder never throws.
 *
 * The types are the first check; the run-time check is for a JavaScript
 * caller past them. Each
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
import { checkFacts } from './factCheck';
import { type ErrorDraft, mint } from './mint';
import { ASSERTION_RULE_CHECK, render, type Words } from './words';

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

/**
 * The error of a builder call whose facts fail their check (a JavaScript
 * caller past the types): the unfamiliar error, `unknown` with operation
 * `unfamiliar-error`, as classification answers a value it cannot read.
 */
function unfamiliar(): IAuthProviderError {
  const facts: AuthProviderErrorFacts['unknown'] = {
    operation: 'unfamiliar-error',
  };
  return mint(
    draft('unknown', undefined, facts, render('unknown', facts), undefined),
  );
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
function buildSaml(facts: unknown, diagnostics?: unknown): IAuthProviderError {
  const kept = checkFacts('saml-assertion', facts, ASSERTION_RULE_CHECK);
  if (kept === undefined) return unfamiliar();
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
function buildSnc(facts: unknown, diagnostics?: unknown): IAuthProviderError {
  const kept = checkFacts('snc', facts, ASSERTION_RULE_CHECK);
  if (kept === undefined) return unfamiliar();
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
  facts: unknown,
  diagnostics?: unknown,
): IAuthProviderError {
  const kept = checkFacts('configuration', facts, ASSERTION_RULE_CHECK);
  if (kept === undefined) return unfamiliar();
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

/** A kind without variant or diagnostics: facts checked, words, mint. */
function plain<K extends PlainKind>(
  kind: K,
  facts: AuthProviderErrorFacts[K],
): AuthProviderErrorOf<K>;
function plain(kind: PlainKind, facts: unknown): IAuthProviderError {
  const kept = checkFacts(kind, facts, ASSERTION_RULE_CHECK);
  if (kept === undefined) return unfamiliar();
  return mint(draft(kind, undefined, kept, render(kind, kept), undefined));
}

/** The variant of a kind with diagnostics: its discriminant; else none. */
function variantOf(
  kind: AuthProviderErrorKind,
  facts: object,
): string | undefined {
  const key =
    kind === 'saml-assertion'
      ? 'rule'
      : kind === 'snc'
        ? 'problem'
        : kind === 'configuration'
          ? 'case'
          : undefined;
  if (key === undefined) return undefined;
  const value = readOwn(facts, key);
  return typeof value === 'string' ? value : undefined;
}

/**
 * The structural rebuild of classification (spec §5.4 step 3): the facts of
 * `kind` read and checked by the same per-kind validator the builders use —
 * only the declared keys kept — and re-minted with words rendered here and
 * **no diagnostics**: a rebuild never carries any. `undefined` when the
 * facts fail their check (the caller falls through). Never reads a
 * `reason`, `hint` or `diagnostics`; never throws.
 */
export function rebuild(
  kind: AuthProviderErrorKind,
  facts: unknown,
): IAuthProviderError | undefined {
  const kept = checkFacts(kind, facts, ASSERTION_RULE_CHECK);
  if (kept === undefined) return undefined;
  return mint(
    draft(kind, variantOf(kind, kept), kept, render(kind, kept), undefined),
  );
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
