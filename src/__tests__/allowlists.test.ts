import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as contract from '@mcp-abap-adt/interfaces-auth';
import { builtFunction, loadBuilt } from './builtPackage';

/**
 * One membership guard per allowlist array of interfaces-auth: the arrays come from the published contract, never redefined here.
 */
const GUARDS: ReadonlyArray<[string, string]> = [
  ['isAuthProviderErrorKind', 'AUTH_PROVIDER_ERROR_KINDS'],
  ['isConfigField', 'CONFIG_FIELDS'],
  ['isConfigCase', 'CONFIG_CASES'],
  ['isAllowedValueSet', 'ALLOWED_VALUE_SETS'],
  ['isSncQop', 'SNC_QOP_VALUES'],
  ['isBasicEncoding', 'BASIC_ENCODINGS'],
  ['isOperation', 'OPERATIONS'],
  ['isRequestProblem', 'REQUEST_PROBLEMS'],
  ['isSystemCode', 'SYSTEM_CODES'],
  ['isTlsFailureCode', 'TLS_FAILURE_CODES'],
  ['isOAuthErrorCode', 'OAUTH_ERROR_CODES'],
  ['isRfcKey', 'RFC_KEYS'],
  ['isAssertionCheck', 'ASSERTION_CHECKS'],
  ['isAssertionRule', 'ASSERTION_RULES'],
  ['isBearerCandidateReason', 'BEARER_CANDIDATE_REASONS'],
  ['isSamlStatusCode', 'SAML_STATUS_CODES'],
  ['isSncProblem', 'SNC_PROBLEMS'],
  ['isSpnegoProblem', 'SPNEGO_PROBLEMS'],
  ['isNegotiateSourceProblem', 'NEGOTIATE_SOURCE_PROBLEMS'],
  ['isSncCandidateSource', 'SNC_CANDIDATE_SOURCES'],
  ['isSncUnusableReason', 'SNC_UNUSABLE_REASONS'],
  ['isSncArch', 'SNC_ARCHS'],
  ['isInteractiveOutcome', 'INTERACTIVE_OUTCOMES'],
  ['isInteractiveLoginStrategy', 'INTERACTIVE_LOGIN_STRATEGIES'],
  ['isCredentialKind', 'CREDENTIAL_KINDS'],
  ['isClientCertificateProblem', 'CLIENT_CERTIFICATE_PROBLEMS'],
  ['isClientAuthenticationProblem', 'CLIENT_AUTHENTICATION_PROBLEMS'],
  ['isRejectionMoment', 'REJECTION_MOMENTS'],
  ['isSystemRefusedVerdict', 'SYSTEM_REFUSED_VERDICTS'],
  ['isRenewalUnchangedSource', 'RENEWAL_UNCHANGED_SOURCES'],
  ['isRenewalTrigger', 'RENEWAL_TRIGGERS'],
  ['isTokenBindingProblem', 'TOKEN_BINDING_PROBLEMS'],
  ['isNotPreparedProvider', 'NOT_PREPARED_PROVIDERS'],
  ['isLogonTargetWire', 'LOGON_TARGET_WIRES'],
  ['isLogonTargetRefusal', 'LOGON_TARGET_REFUSALS'],
  ['isConnectionProblem', 'CONNECTION_PROBLEMS'],
  ['isConnectionMoment', 'CONNECTION_MOMENTS'],
];

/**
 * Arrays of interfaces-auth that are not allowlists of the error contract:
 * the renewal strategy's moments, steps and readings belong to the token
 * renewal contract (`RENEWAL_TRIGGERS` is the exception: `renewal-declined`
 * carries it). `ANSWER_REFUSALS` is the part contract's: the provider's
 * listener words each refused answer itself, in fixed words.
 */
const NOT_ALLOWLISTS: ReadonlySet<string> = new Set([
  'ANSWER_REFUSALS',
  'RENEWAL_MOMENTS',
  'RENEWAL_STEPS',
  'REJECTION_READINGS',
]);

/** The runtime exports of interfaces-auth, read by name. */
const CONTRACT_EXPORTS: ReadonlyMap<string, unknown> = new Map(
  Object.entries(contract),
);

function members(arrayName: string): readonly string[] {
  const array: unknown = CONTRACT_EXPORTS.get(arrayName);
  if (!Array.isArray(array) || !array.every((m) => typeof m === 'string')) {
    throw new Error(`${arrayName} is not an array of strings`);
  }
  return array;
}

/** `text` with the case of its first ASCII letter flipped; unchanged without one. */
function flipFirstLetter(text: string): string {
  for (let at = 0; at < text.length; at += 1) {
    const c = text.charAt(at);
    const lower = c >= 'a' && c <= 'z';
    if (lower || (c >= 'A' && c <= 'Z')) {
      const other = lower ? c.toUpperCase() : c.toLowerCase();
      return `${text.slice(0, at)}${other}${text.slice(at + 1)}`;
    }
  }
  return text;
}

/** Strings one edit away from a member, none of them a member. */
function nearMisses(member: string, all: readonly string[]): string[] {
  const flipped = flipFirstLetter(member);
  return [
    `${member} `,
    ` ${member}`,
    `${member}\u0000`,
    member.slice(0, -1),
    flipped,
    `${member}x`,
  ].filter((candidate) => candidate !== '' && !all.includes(candidate));
}

const NON_STRINGS: ReadonlyArray<[string, (member: string) => unknown]> = [
  ['undefined', () => undefined],
  ['null', () => null],
  ['a number', () => 1],
  ['a boolean', () => true],
  ['a symbol', (m) => Symbol(m)],
  ['a boxed string', (m) => Object(m)],
  ['an array holding the member', (m) => [m]],
  ['an object whose toString is the member', (m) => ({ toString: () => m })],
];

describe('every allowlist array of interfaces-auth has a guard', () => {
  it('lists each array once', () => {
    const arrays = [...CONTRACT_EXPORTS]
      .filter(([, value]) => Array.isArray(value))
      .map(([name]) => name)
      .filter((name) => !NOT_ALLOWLISTS.has(name))
      .sort();
    assert.deepEqual(GUARDS.map(([, array]) => array).sort(), arrays);
  });
});

for (const [guardName, arrayName] of GUARDS) {
  describe(`${guardName} (${arrayName})`, () => {
    const guard = builtFunction(guardName);
    const all = members(arrayName);

    it('answers true for every member', () => {
      assert.ok(all.length > 0);
      for (const member of all) {
        assert.deepEqual([member, guard(member)], [member, true]);
      }
    });

    it('answers false for a near miss of every member', () => {
      for (const member of all) {
        for (const miss of nearMisses(member, all)) {
          assert.deepEqual([miss, guard(miss)], [miss, false]);
        }
      }
    });

    it('answers false for the empty string and a foreign word', () => {
      assert.equal(guard(''), false);
      assert.equal(guard('NOT_ON_ANY_LIST'), false);
    });

    for (const [_label, make] of NON_STRINGS) {
      it(`answers false for ${_label}`, () => {
        for (const member of all) {
          assert.equal(guard(make(member)), false);
        }
      });
    }

    it('answers false for a name of an Object.prototype member', () => {
      for (const name of [
        'constructor',
        '__proto__',
        'toString',
        'hasOwnProperty',
      ]) {
        assert.equal(guard(name), false);
      }
    });
  });
}

describe('the sets are reachable only through the guards', () => {
  it('the built package exports no Set, Map or array', () => {
    for (const [name, value] of Object.entries(loadBuilt())) {
      const mutable =
        value instanceof Set || value instanceof Map || Array.isArray(value);
      assert.deepEqual([name, mutable], [name, false]);
    }
  });

  it('a guard is a plain function: its properties hold no set', () => {
    for (const [guardName] of GUARDS) {
      const guard = builtFunction(guardName);
      for (const key of Reflect.ownKeys(guard)) {
        const value: unknown = Reflect.get(guard, key);
        assert.equal(value instanceof Set, false);
      }
    }
  });
});

describe('Set.prototype.has patched after load (C5)', () => {
  const originalHas = Set.prototype.has;

  afterEach(() => {
    Set.prototype.has = originalHas;
  });

  it('changes no guard answer: a foreign code is still refused, a member still admitted', () => {
    // Load before patching: the guards captured `has` at module load.
    const loaded = GUARDS.map(
      ([guardName, arrayName]) =>
        [guardName, builtFunction(guardName), members(arrayName)] as const,
    );
    Set.prototype.has = function alwaysTrue(): boolean {
      return true;
    };
    assert.equal(new Set<string>().has('anything'), true);
    for (const [guardName, guard, all] of loaded) {
      assert.deepEqual(
        [guardName, guard('NOT_ON_ANY_LIST')],
        [guardName, false],
      );
      assert.deepEqual([guardName, guard(all[0])], [guardName, true]);
    }
  });

  it('Set.prototype.has patched to refuse everything does not refuse a member', () => {
    const loaded = GUARDS.map(
      ([guardName, arrayName]) =>
        [guardName, builtFunction(guardName), members(arrayName)] as const,
    );
    Set.prototype.has = function alwaysFalse(): boolean {
      return false;
    };
    for (const [guardName, guard, all] of loaded) {
      assert.deepEqual([guardName, guard(all[0])], [guardName, true]);
    }
  });
});
