/**
 * Compiled by `npm run test:check` only (never built, never run):
 * `matchKind` and `unreachableKind` compile only when every kind is handled
 * (spec §9, §11.2), and `guard` / `relayOutcome` take what §7 and §8.1
 * name. Each `@ts-expect-error` line is a rule; an unused directive fails
 * the check.
 */
import type {
  AuthOutcome,
  IAuthProviderError,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import {
  guard,
  type KindHandlers,
  matchKind,
  type RelayedOutcome,
  relayOutcome,
  unreachableKind,
} from '../index';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

declare const error: IAuthProviderError;

const all: KindHandlers<string> = {
  configuration: (e) => e.facts.case,
  'client-certificate': (e) => e.facts.problem,
  'client-authentication': (e) => e.facts.problem,
  'request-failed': (e) => e.facts.operation,
  tls: (e) => e.facts.code,
  'interactive-login': (e) => e.facts.outcome,
  'saml-assertion': (e) => e.facts.rule,
  snc: (e) => e.facts.problem,
  'credential-refused': (e) => e.facts.credential,
  'system-refused': (e) => e.facts.verdict,
  'renewal-unchanged': (e) => e.facts.source,
  'renewal-declined': (e) => e.facts.trigger,
  'token-binding': (e) => e.facts.problem,
  'not-prepared': (e) => e.facts.provider,
  'logon-target': (e) => e.facts.refused,
  connection: (e) => e.facts.problem,
  unknown: (e) => e.facts.operation,
};
// Positive: every kind handled.
export const text: string = matchKind(error, all);

// One handler missing does not compile.
const { unknown: _dropped, ...withoutUnknown } = all;
// @ts-expect-error the `unknown` handler is missing
matchKind(error, withoutUnknown);

// A handler takes the error of its own kind.
matchKind(error, {
  ...all,
  // @ts-expect-error a tls error carries no `problem` (it is `?: never`)
  tls: (e) => e.facts.problem.length,
});

// A switch over every kind: `default` sees `never`.
export function described(e: IAuthProviderError): string {
  switch (e.kind) {
    case 'configuration':
    case 'client-certificate':
    case 'client-authentication':
    case 'request-failed':
    case 'tls':
    case 'interactive-login':
    case 'saml-assertion':
    case 'snc':
    case 'credential-refused':
    case 'system-refused':
    case 'renewal-unchanged':
    case 'renewal-declined':
    case 'token-binding':
    case 'not-prepared':
    case 'logon-target':
    case 'connection':
    case 'unknown':
      return e.kind;
    default:
      return unreachableKind(e).kind;
  }
}

// A switch over all but one kind: `default` sees that kind, not `never`.
export function missingOne(e: IAuthProviderError): string {
  switch (e.kind) {
    case 'configuration':
    case 'client-certificate':
    case 'client-authentication':
    case 'request-failed':
    case 'tls':
    case 'interactive-login':
    case 'saml-assertion':
    case 'snc':
    case 'credential-refused':
    case 'system-refused':
    case 'renewal-unchanged':
    case 'renewal-declined':
    case 'token-binding':
    case 'not-prepared':
    case 'logon-target':
    case 'connection':
      return e.kind;
    default:
      // @ts-expect-error `unknown` is not handled: the error is not `never`
      return unreachableKind(e).kind;
  }
}

export type UnreachableSignature = Expect<
  Equal<typeof unreachableKind, (error: never) => IAuthProviderError>
>;
export type GuardSignature = Expect<
  Equal<
    typeof guard,
    (
      operation: Operation,
      body: () => AuthOutcome | Promise<AuthOutcome>,
      grant?: () => unknown,
    ) => Promise<AuthOutcome>
  >
>;
export type RelaySignature = Expect<
  Equal<
    typeof relayOutcome,
    (
      call: () => unknown,
      refused: 'tls-material' | 'logon-parameters',
      operation: Operation,
    ) => RelayedOutcome
  >
>;

// @ts-expect-error guard takes an operation from the list, not free text
guard('sk-free-text', async () => ({ ok: true }));
// @ts-expect-error relayOutcome refuses only what a target can refuse
relayOutcome(() => undefined, 'cookies', 'establishing');
