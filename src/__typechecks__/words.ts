/**
 * Compiled by `npm run test:check` only (never built, never run): the words
 * table covers every kind, and a discriminant switch covers every member
 * (§11.2). Each `@ts-expect-error` line is a rule; a positive line beside it
 * proves the failure is the rule's.
 */
import type {
  AssertionCheck,
  AssertionRule,
  AssertionRuleCheck,
  AuthProviderErrorFacts,
  ClientCertificateProblem,
  IAuthProviderError,
  InteractiveLoginStrategy,
} from '@mcp-abap-adt/interfaces-auth';
import type { blamesCredential, render } from '../index';
import {
  ASSERTION_RULE_CHECK,
  unreachable,
  type Words,
  type WordsTable,
} from '../words';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const words = (): Words => ({ reason: 'r' });

/** A complete table compiles. */
export const complete: WordsTable = {
  configuration: words,
  'client-certificate': words,
  'client-authentication': words,
  'request-failed': words,
  tls: words,
  'interactive-login': words,
  'saml-assertion': words,
  snc: words,
  'credential-refused': words,
  'system-refused': words,
  'renewal-unchanged': words,
  'token-binding': words,
  'not-prepared': words,
  'logon-target': words,
  connection: words,
  unknown: words,
};

/** The same table without one kind does not. */
// @ts-expect-error the table lacks `unknown`
export const missingKind: WordsTable = {
  configuration: words,
  'client-certificate': words,
  'client-authentication': words,
  'request-failed': words,
  tls: words,
  'interactive-login': words,
  'saml-assertion': words,
  snc: words,
  'credential-refused': words,
  'system-refused': words,
  'renewal-unchanged': words,
  'token-binding': words,
  'not-prepared': words,
  'logon-target': words,
  connection: words,
};

/** A switch over every member reaches `unreachable` with `never`. */
export function everyProblem(problem: ClientCertificateProblem): Words {
  switch (problem) {
    case 'incomplete':
      return words();
    case 'unusable':
      return words();
    case 'expired':
      return words();
    default:
      return unreachable(problem);
  }
}

/** A switch missing one member does not compile. */
export function missingProblem(problem: ClientCertificateProblem): Words {
  switch (problem) {
    case 'incomplete':
      return words();
    case 'unusable':
      return words();
    default:
      // @ts-expect-error 'expired' is not handled
      return unreachable(problem);
  }
}

/** The runtime rule → check table is the interfaces' correlation. */
export const ruleCheck: AssertionRuleCheck = ASSERTION_RULE_CHECK;
export type RuleCheckKeys = Expect<
  Equal<keyof typeof ASSERTION_RULE_CHECK, AssertionRule>
>;
export type RuleCheckValues = Expect<
  Equal<
    (typeof ASSERTION_RULE_CHECK)[AssertionRule] extends AssertionCheck
      ? true
      : false,
    true
  >
>;

/** render takes a kind and that kind's facts, and answers words. */
export type RenderSignature = Expect<
  Equal<
    ReturnType<typeof render<'tls'>>,
    { readonly reason: string; readonly hint?: string }
  >
>;
export type RenderFacts = Expect<
  Equal<Parameters<typeof render<'tls'>>[1], AuthProviderErrorFacts['tls']>
>;

/** blamesCredential takes an error, never facts alone. */
export type BlameSignature = Expect<
  Equal<Parameters<typeof blamesCredential>[0], IAuthProviderError>
>;

/** An aborted login's strategy, absent included, switched over every member. */
export function everyAbortStrategy(
  strategy: InteractiveLoginStrategy | undefined,
): Words {
  switch (strategy) {
    case undefined:
    case 'browser':
      return words();
    case 'manual':
      return words();
    default:
      return unreachable(strategy);
  }
}

/** The same switch missing one strategy does not compile. */
export function missingAbortStrategy(
  strategy: InteractiveLoginStrategy | undefined,
): Words {
  switch (strategy) {
    case undefined:
    case 'browser':
      return words();
    default:
      // @ts-expect-error 'manual' is not handled
      return unreachable(strategy);
  }
}
