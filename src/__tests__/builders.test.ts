import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUTH_PROVIDER_ERROR_KINDS,
  type AuthProviderErrorKind,
  type IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt } from './builtPackage';

/**
 * The builders: one per kind, the only exported way to obtain an
 * error. Each normalises the facts, admits the diagnostics its variant
 * permits, renders the words and mints a deeply frozen error.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const isMinted = built.isMinted as (value: unknown) => boolean;
const httpStatus = built.httpStatus as (value: unknown) => number;
const count = built.count as (value: unknown) => number;
const port = built.port as (value: unknown) => number;

/** Every key of `value`, own and at any depth, holding `undefined`. */
function undefinedKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const key of Object.keys(value)) {
    const inner = (value as Record<string, unknown>)[key];
    if (inner === undefined) found.push(`${path}${key}`);
    found.push(...undefinedKeys(inner, `${path}${key}.`));
  }
  return found;
}

/** Every object and array reachable from `value` is frozen. */
function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deeplyFrozen);
}

/** One builder call per kind: plain kinds and the three with a variant. */
const ONE_PER_KIND: Record<string, () => IAuthProviderError> = {
  configuration: () =>
    authError.configuration({
      case: 'required-fields-missing',
      fields: ['clientId'],
    }),
  'client-certificate': () =>
    authError['client-certificate']({ problem: 'expired' }),
  'client-authentication': () =>
    authError['client-authentication']({ problem: 'result-unsendable' }),
  'request-failed': () =>
    authError['request-failed']({
      operation: 'client-credentials',
      problem: 'refused',
      status: httpStatus(401),
    }),
  tls: () =>
    authError.tls({ operation: 'code-exchange', code: 'CERT_HAS_EXPIRED' }),
  'interactive-login': () =>
    authError['interactive-login']({ outcome: 'busy' }),
  'saml-assertion': () =>
    authError['saml-assertion']({ rule: 'expired', check: 'notOnOrAfter' }),
  snc: () => authError.snc({ problem: 'locator-returned-no-path' }),
  spnego: () =>
    authError.spnego({
      problem: 'no-credential',
      operation: 'obtaining-negotiate-token',
    }),
  'credential-refused': () =>
    authError['credential-refused']({ credential: 'token', at: 'request' }),
  'system-refused': () =>
    authError['system-refused']({ verdict: 'unknown', at: 'logon' }),
  'renewal-unchanged': () =>
    authError['renewal-unchanged']({ source: 'token-source' }),
  'renewal-declined': () =>
    authError['renewal-declined']({ trigger: 'expired' }),
  'token-binding': () =>
    authError['token-binding']({ problem: 'bound-to-unpinned' }),
  'not-prepared': () => authError['not-prepared']({ provider: 'snc' }),
  'logon-target': () =>
    authError['logon-target']({ wire: 'rfc', refused: 'tls-material' }),
  connection: () => authError.connection({ problem: 'no-credential' }),
  unknown: () => authError.unknown({ operation: 'refresh' }),
};

describe('authError', () => {
  it('has one builder per kind, and nothing else', () => {
    assert.deepEqual(
      Object.keys(authError).sort(),
      [...AUTH_PROVIDER_ERROR_KINDS].sort(),
    );
    for (const kind of AUTH_PROVIDER_ERROR_KINDS) {
      assert.equal(typeof authError[kind], 'function');
    }
    assert.deepEqual(
      Object.keys(ONE_PER_KIND).sort(),
      [...AUTH_PROVIDER_ERROR_KINDS].sort(),
    );
  });

  it('is frozen: no builder can be replaced', () => {
    assert.equal(Object.isFrozen(authError), true);
    assert.throws(() => {
      authError.unknown = () => ({}) as IAuthProviderError;
    }, TypeError);
  });

  for (const kind of AUTH_PROVIDER_ERROR_KINDS) {
    describe(`kind ${kind}`, () => {
      const make = (): IAuthProviderError => {
        const builder = ONE_PER_KIND[kind];
        if (builder === undefined) throw new Error(`no case for ${kind}`);
        return builder();
      };

      it('mints an error of that kind, with words', () => {
        const error = make();
        assert.equal(error.kind, kind);
        assert.equal(isMinted(error), true);
        assert.equal(typeof error.reason, 'string');
        assert.ok(error.reason.length > 0);
      });

      it('is frozen deeply', () => {
        assert.equal(deeplyFrozen(make()), true);
      });

      it('carries no undefined-valued key', () => {
        assert.deepEqual(undefinedKeys(make()), []);
      });

      it('mints a new object on each call', () => {
        assert.notEqual(make(), make());
        assert.deepEqual(make(), make());
      });
    });
  }

  it('sets variant from the facts for the kinds that carry one', () => {
    const saml = authError['saml-assertion']({
      rule: 'duplicate-id',
      check: 'duplicateId',
    });
    assert.equal(saml.variant, 'duplicate-id');
    const snc = authError.snc({ problem: 'logon-refused' });
    assert.equal(snc.variant, 'logon-refused');
    const config = authError.configuration({
      case: 'snc-qop-invalid',
      fields: ['qop'],
      allowed: 'snc-qop',
    });
    assert.equal(config.variant, 'snc-qop-invalid');
  });

  it('gives a plain kind no variant key', () => {
    const error = authError['client-certificate']({ problem: 'incomplete' });
    assert.ok(!Object.keys(error).includes('variant'));
    assert.ok(!Object.keys(error).includes('diagnostics'));
  });

  it('omits an absent fact, and a fact given as undefined', () => {
    const error = authError['request-failed']({
      operation: 'token-request',
      grant: undefined,
      problem: 'no-response',
      status: undefined,
      oauthError: undefined,
      code: 'ECONNREFUSED',
    });
    assert.deepEqual(error.facts, {
      operation: 'token-request',
      problem: 'no-response',
      code: 'ECONNREFUSED',
    });
  });

  it('omits hint when the words have none', () => {
    const error = authError['logon-target']({
      wire: 'http',
      refused: 'logon-parameters',
    });
    assert.ok(!Object.keys(error).includes('hint'));
  });

  it('keeps the facts it was given, copied', () => {
    const facts = { problem: 'expired' };
    const error = authError['client-certificate'](facts);
    assert.deepEqual(error.facts, { problem: 'expired' });
    assert.notEqual(error.facts, facts);
    assert.equal(Object.isFrozen(facts), false);
  });

  describe('configuration fields', () => {
    it('deduplicates in the order given', () => {
      const error = authError.configuration({
        case: 'required-fields-missing',
        fields: ['uaaUrl', 'clientId', 'uaaUrl', 'clientSecret', 'clientId'],
      });
      assert.deepEqual(error.facts, {
        case: 'required-fields-missing',
        fields: ['uaaUrl', 'clientId', 'clientSecret'],
      });
    });

    it('caps at eight, after deduplicating', () => {
      const names = [
        'acsUrl',
        'acsUrl',
        'audience',
        'clientId',
        'clientSecret',
        'encoding',
        'idpEntityId',
        'issuerUrl',
        'partnerName',
        'qop',
        'scope',
      ];
      const error = authError.configuration({
        case: 'required-fields-missing',
        fields: names,
      });
      const facts = error.facts as { fields: readonly string[] };
      assert.deepEqual(facts.fields, [
        'acsUrl',
        'audience',
        'clientId',
        'clientSecret',
        'encoding',
        'idpEntityId',
        'issuerUrl',
        'partnerName',
      ]);
    });

    it('does not share the array it was given', () => {
      const fields = ['clientId'];
      const error = authError.configuration({
        case: 'required-fields-missing',
        fields,
      });
      fields.push('clientSecret');
      assert.deepEqual((error.facts as { fields: string[] }).fields, [
        'clientId',
      ]);
    });
  });

  describe('candidates', () => {
    const bearer = (n: number) =>
      Array.from({ length: n }, () => ({ reason: 'method-not-bearer' }));
    const snc = (n: number) =>
      Array.from({ length: n }, () => ({
        source: 'SNC_LIB',
        reason: 'missing',
      }));

    it('keeps at most five bearer candidates, counting the rest', () => {
      const error = authError['saml-assertion']({
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: bearer(7),
      });
      const facts = error.facts as {
        candidates: readonly unknown[];
        moreCandidates?: number;
      };
      assert.equal(facts.candidates.length, 5);
      assert.equal(facts.moreCandidates, 2);
    });

    it('adds the cut candidates to a moreCandidates given', () => {
      const error = authError['saml-assertion']({
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: bearer(6),
        moreCandidates: count(3),
      });
      assert.equal(
        (error.facts as { moreCandidates?: number }).moreCandidates,
        4,
      );
    });

    it('keeps five bearer candidates as they are', () => {
      const error = authError['saml-assertion']({
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: bearer(5),
      });
      assert.ok(!Object.keys(error.facts).includes('moreCandidates'));
      assert.equal(
        (error.facts as { candidates: readonly unknown[] }).candidates.length,
        5,
      );
    });

    it('keeps at most eight SNC candidates', () => {
      const error = authError.snc({
        problem: 'library-not-found',
        searched: true,
        candidates: snc(11),
      });
      assert.equal(
        (error.facts as { candidates: readonly unknown[] }).candidates.length,
        8,
      );
    });

    it('aligns candidatePaths with the capped candidates', () => {
      const paths = Array.from({ length: 11 }, (_, i) => `/opt/lib${i}.so`);
      const error = authError.snc(
        { problem: 'library-not-found', searched: true, candidates: snc(11) },
        { candidatePaths: paths },
      );
      assert.deepEqual(error.diagnostics, {
        candidatePaths: paths.slice(0, 8),
      });
    });

    it('copies and freezes each candidate', () => {
      const archs = ['x64'];
      const candidate = {
        source: 'registry',
        reason: 'wrong architecture',
        archs,
      };
      const error = authError.snc({
        problem: 'library-not-found',
        candidates: [candidate],
      });
      archs.push('arm64');
      const [kept] = (
        error.facts as { candidates: readonly { archs: string[] }[] }
      ).candidates;
      assert.notEqual(kept, candidate);
      assert.deepEqual(kept?.archs, ['x64']);
      assert.equal(Object.isFrozen(kept), true);
      assert.equal(Object.isFrozen(kept?.archs), true);
    });
  });

  describe('diagnostics', () => {
    it('keeps a permitted, admitted diagnostic', () => {
      const error = authError['saml-assertion'](
        { rule: 'untrusted-issuer', check: 'issuer' },
        { issuer: 'https://idp.example/' },
      );
      assert.deepEqual(error.diagnostics, {
        issuer: 'https://idp.example/',
      });
      assert.equal(isMinted(error), true);
    });

    it('drops a field the variant does not permit (a JavaScript caller)', () => {
      const error = authError['saml-assertion'](
        { rule: 'duplicate-id', check: 'duplicateId' },
        { issuer: 'https://idp.example/', id: '_a1' },
      );
      assert.deepEqual(error.diagnostics, { id: '_a1' });
    });

    it('drops every field of a variant that permits none', () => {
      const error = authError.snc(
        { problem: 'logon-refused' },
        { library: '/opt/libsapcrypto.so' },
      );
      assert.ok(!Object.keys(error).includes('diagnostics'));
      assert.equal(isMinted(error), true);
    });

    it('drops a diagnostic of a plain kind (a JavaScript caller)', () => {
      const error = authError['client-certificate'](
        { problem: 'expired' },
        { library: '/opt/libsapcrypto.so' },
      );
      assert.ok(!Object.keys(error).includes('diagnostics'));
    });

    it('drops a refused value and still mints the error', () => {
      const error = authError['saml-assertion'](
        { rule: 'untrusted-issuer', check: 'issuer' },
        { issuer: 'https://idp.example/\nforged: line' },
      );
      assert.ok(!Object.keys(error).includes('diagnostics'));
      assert.equal(isMinted(error), true);
      assert.equal(error.kind, 'saml-assertion');
    });

    it('keeps the admitted ones of several and drops the refused', () => {
      const error = authError.configuration(
        {
          case: 'redirect-mismatch',
          fields: ['authorizationUrl'],
        },
        {
          configuredUri: 'https://user:pw@idp.example/cb',
          strategyUri: 'http://localhost:61001/callback?code=secret',
        },
      );
      assert.deepEqual(error.diagnostics, {
        strategyUri: 'http://localhost:61001/callback',
      });
    });

    it('survives a diagnostics argument that throws on every read', () => {
      const hostile = new Proxy(
        {},
        {
          get() {
            throw new Error('secret');
          },
          getOwnPropertyDescriptor() {
            throw new Error('secret');
          },
        },
      );
      const error = authError.snc({ problem: 'no-credential' }, hostile);
      assert.ok(!Object.keys(error).includes('diagnostics'));
      assert.equal(isMinted(error), true);
    });

    it('freezes the diagnostics', () => {
      const error = authError.snc(
        { problem: 'library-not-found', candidates: [] },
        { candidatePaths: [] },
      );
      assert.equal(deeplyFrozen(error), true);
    });
  });

  describe('RF3: a minted error cannot be changed', () => {
    it('refuses an assignment to reason', () => {
      const error = authError['client-certificate']({ problem: 'expired' });
      assert.throws(() => {
        (error as { reason: string }).reason = 'forged';
      }, TypeError);
      assert.equal(error.reason, 'the client certificate has expired');
    });

    it('refuses a change to a nested facts array', () => {
      const error = authError.configuration({
        case: 'required-fields-missing',
        fields: ['clientId'],
      });
      const fields = (error.facts as { fields: string[] }).fields;
      assert.throws(() => {
        fields.push('clientSecret');
      }, TypeError);
      assert.throws(() => {
        fields[0] = 'password';
      }, TypeError);
      assert.deepEqual(fields, ['clientId']);
    });

    it('refuses a new key on the error and on its facts', () => {
      const error = authError.unknown({ operation: 'refresh' });
      assert.throws(() => {
        (error as unknown as Record<string, unknown>).message = 'secret';
      }, TypeError);
      assert.throws(() => {
        (error.facts as Record<string, unknown>).status = 500;
      }, TypeError);
    });
  });
});

describe('a builder never throws on what a caller hands it', () => {
  const hostile = () =>
    new Proxy(
      {},
      {
        get() {
          throw new Error('secret');
        },
        getOwnPropertyDescriptor() {
          throw new Error('secret');
        },
        ownKeys() {
          throw new Error('secret');
        },
      },
    );

  it('reads a getter as absent', () => {
    const facts = {
      operation: 'refresh',
      get code() {
        throw new Error('secret');
      },
    };
    const error = authError.unknown(facts);
    assert.deepEqual(error.facts, { operation: 'refresh' });
    assert.equal(isMinted(error), true);
  });

  it('facts whose every trap throws lack their required facts: the unfamiliar error', () => {
    const error = authError.unknown(hostile());
    assert.equal(error.kind, 'unknown');
    assert.deepEqual(error.facts, { operation: 'unfamiliar-error' });
    assert.equal(isMinted(error), true);
  });

  it('reads a revoked Proxy as absent', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const error = authError.snc({
      problem: 'library-not-found',
      candidates: proxy,
    });
    assert.deepEqual(error.facts, { problem: 'library-not-found' });
  });

  it('reads a hostile array element as absent', () => {
    const error = authError.configuration({
      case: 'required-fields-missing',
      fields: ['clientId', hostile(), 'uaaUrl'],
    });
    assert.deepEqual((error.facts as { fields: unknown[] }).fields, [
      'clientId',
      'uaaUrl',
    ]);
  });

  it('reads a cycle as absent', () => {
    const candidate: Record<string, unknown> = {
      source: 'SNC_LIB',
      reason: 'missing',
    };
    candidate.self = candidate;
    const error = authError.snc({
      problem: 'library-not-found',
      candidates: [candidate],
    });
    assert.deepEqual((error.facts as { candidates: unknown[] }).candidates, [
      { source: 'SNC_LIB', reason: 'missing' },
    ]);
    assert.equal(Object.isFrozen(error), true);
  });

  it('drops holes and undefined elements from fields and candidates', () => {
    // biome-ignore lint/suspicious/noSparseArray: the hole is the case
    const fields = ['clientId', , undefined, 'uaaUrl'];
    const config = authError.configuration({
      case: 'required-fields-missing',
      fields,
    });
    assert.deepEqual((config.facts as { fields: unknown[] }).fields, [
      'clientId',
      'uaaUrl',
    ]);
    const saml = authError['saml-assertion']({
      rule: 'no-bearer-qualifies',
      check: 'bearerConfirmation',
      // biome-ignore lint/suspicious/noSparseArray: the hole is the case
      candidates: [, undefined, { reason: 'method-not-bearer' }],
    });
    assert.deepEqual((saml.facts as { candidates: unknown[] }).candidates, [
      { reason: 'method-not-bearer' },
    ]);
  });

  it('reads an array claiming a huge length only so far', () => {
    const fields = new Proxy(['clientId'], {
      get(target, key) {
        return key === 'length' ? 1e9 : Reflect.get(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        return key === 'length'
          ? {
              value: 1e9,
              writable: true,
              enumerable: false,
              configurable: false,
            }
          : Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const error = authError.configuration({
      case: 'required-fields-missing',
      fields,
    });
    assert.deepEqual((error.facts as { fields: unknown[] }).fields, [
      'clientId',
    ]);
  });

  it('a __proto__ key never reaches the prototype of the facts', () => {
    const facts = JSON.parse('{"operation":"refresh","__proto__":{"x":1}}');
    const error = authError.unknown(facts);
    assert.equal(Object.getPrototypeOf(error.facts), Object.prototype);
    assert.deepEqual(error.facts, { operation: 'refresh' });
  });
});

const UNFAMILIAR_REASON =
  'an authentication error of a kind this version does not know';

/** An object whose `toString` and `Symbol.toPrimitive` record a call. */
function spy(calls: string[]): object {
  return {
    [Symbol.toPrimitive]() {
      calls.push('toPrimitive');
      return 'MARKER';
    },
    toString() {
      calls.push('toString');
      return 'MARKER';
    },
  };
}

describe('F1: every fact value is read own and checked, in builders and render', () => {
  const render = built.render as (
    kind: unknown,
    facts: unknown,
  ) => {
    reason: string;
    hint?: string;
  };

  /** [label, kind, facts with one bad optional value, the facts kept]. */
  const OPTIONAL: readonly (readonly [string, string, unknown, unknown])[] = [
    [
      'grant with free text',
      'request-failed',
      {
        operation: 'token-request',
        grant: 'MARKER secret',
        problem: 'refused',
      },
      { operation: 'token-request', problem: 'refused' },
    ],
    [
      'status an object',
      'unknown',
      { operation: 'refresh', status: {} },
      { operation: 'refresh' },
    ],
    [
      'status out of range',
      'unknown',
      { operation: 'refresh', status: 700 },
      { operation: 'refresh' },
    ],
    [
      'status a numeric string',
      'unknown',
      { operation: 'refresh', status: '500' },
      { operation: 'refresh' },
    ],
    [
      'oauthError unregistered',
      'unknown',
      { operation: 'refresh', oauthError: 'MARKER' },
      { operation: 'refresh' },
    ],
    [
      'code not a system code',
      'unknown',
      { operation: 'refresh', code: 'MARKER' },
      { operation: 'refresh' },
    ],
    [
      'code a TLS code in unknown',
      'unknown',
      { operation: 'refresh', code: 'CERT_HAS_EXPIRED' },
      { operation: 'refresh' },
    ],
    [
      'rfcKey unknown',
      'snc',
      { problem: 'logon-refused', rfcKey: 'MARKER' },
      { problem: 'logon-refused' },
    ],
    [
      'statusCode unregistered',
      'saml-assertion',
      { rule: 'declined', check: 'status', statusCode: 'MARKER' },
      { rule: 'declined', check: 'status' },
    ],
    [
      'count of a counted rule below two',
      'saml-assertion',
      { rule: 'several-issuers', check: 'issuer', count: 1 },
      { rule: 'several-issuers', check: 'issuer' },
    ],
    [
      'count a string',
      'saml-assertion',
      { rule: 'several-issuers', check: 'issuer', count: '3' },
      { rule: 'several-issuers', check: 'issuer' },
    ],
    [
      'count on a rule that carries none',
      'saml-assertion',
      { rule: 'expired', check: 'notOnOrAfter', count: 3 },
      { rule: 'expired', check: 'notOnOrAfter' },
    ],
    [
      'aborted strategy not a strategy',
      'interactive-login',
      { outcome: 'aborted', strategy: 'device' },
      { outcome: 'aborted' },
    ],
    [
      'failed oauthError unregistered',
      'interactive-login',
      { outcome: 'failed', status: 400, oauthError: 'MARKER' },
      { outcome: 'failed', status: 400 },
    ],
    [
      'ignoredCallbacks negative',
      'interactive-login',
      { outcome: 'aborted', ignoredCallbacks: -1 },
      { outcome: 'aborted' },
    ],
    [
      'moreCandidates a string',
      'saml-assertion',
      {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        moreCandidates: '7',
      },
      { rule: 'no-bearer-qualifies', check: 'bearerConfirmation' },
    ],
    [
      'candidate count below two',
      'saml-assertion',
      {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: [{ reason: 'several-confirmation-data', count: 1 }],
      },
      {
        rule: 'no-bearer-qualifies',
        check: 'bearerConfirmation',
        candidates: [{ reason: 'several-confirmation-data' }],
      },
    ],
    [
      'fields a string',
      'configuration',
      {
        case: 'required-fields-missing',
        fields: ['clientId', 'abc', 'MARKER'],
      },
      { case: 'required-fields-missing', fields: ['clientId'] },
    ],
    [
      'libraryArchs elements',
      'snc',
      { problem: 'library-init-failed', libraryArchs: ['x64', 'MARKER', 7] },
      { problem: 'library-init-failed', libraryArchs: ['x64'] },
    ],
    [
      'processArch unknown',
      'snc',
      { problem: 'library-not-found', processArch: 'MARKER' },
      { problem: 'library-not-found' },
    ],
    [
      'searched not true',
      'snc',
      { problem: 'library-not-found', searched: 'yes' },
      { problem: 'library-not-found' },
    ],
    [
      'secureLoginClient not a boolean',
      'snc',
      { problem: 'no-credential', secureLoginClient: 'MARKER' },
      { problem: 'no-credential' },
    ],
    [
      'at unknown on a credential',
      'credential-refused',
      { credential: 'token', at: 'MARKER' },
      { credential: 'token' },
    ],
    [
      'allowed of another case',
      'configuration',
      { case: 'snc-qop-invalid', fields: ['qop'], allowed: 'basic-encoding' },
      { case: 'snc-qop-invalid', fields: ['qop'] },
    ],
    [
      'a key no kind carries',
      'unknown',
      { operation: 'refresh', message: 'MARKER' },
      { operation: 'refresh' },
    ],
  ];

  for (const [_label, kind, facts, kept] of OPTIONAL) {
    it(`${_label}: dropped`, () => {
      const error = authError[kind as AuthProviderErrorKind](facts);
      assert.equal(error.kind, kind);
      assert.deepEqual(error.facts, kept);
      assert.ok(!JSON.stringify(error).includes('MARKER'));
      assert.deepEqual(render(kind, facts), render(kind, kept));
    });
  }

  /** [label, kind, facts with one bad required value]. */
  const REQUIRED: readonly (readonly [string, string, unknown])[] = [
    [
      'port out of range',
      'interactive-login',
      { outcome: 'port-in-use', port: 70000 },
    ],
    [
      'port a string',
      'interactive-login',
      { outcome: 'port-in-use', port: '61001' },
    ],
    [
      'status of a status verdict',
      'system-refused',
      { verdict: 'redirected', status: {}, at: 'logon' },
    ],
    [
      'rfcKey of an rfc verdict',
      'system-refused',
      { verdict: 'rfc-failure', rfcKey: 'MARKER', at: 'logon' },
    ],
    [
      'tls code a system code',
      'tls',
      { operation: 'refresh', code: 'ECONNRESET' },
    ],
    ['a foreign renewal trigger', 'renewal-declined', { trigger: 'MARKER' }],
    ['a foreign renewal source', 'renewal-unchanged', { source: 'MARKER' }],
    [
      'fields not an array',
      'configuration',
      { case: 'required-fields-missing', fields: 'abc' },
    ],
    [
      'an SNC candidate source',
      'snc',
      {
        problem: 'library-not-found',
        candidates: [{ source: 'MARKER', reason: 'missing' }],
      },
    ],
  ];

  for (const [_label, kind, facts] of REQUIRED) {
    it(`${_label}: the unfamiliar error`, () => {
      const error = authError[kind as AuthProviderErrorKind](facts);
      assert.equal(error.kind, 'unknown');
      assert.deepEqual(error.facts, { operation: 'unfamiliar-error' });
      assert.equal(error.reason, UNFAMILIAR_REASON);
      assert.deepEqual(render(kind, facts), { reason: UNFAMILIAR_REASON });
    });
  }

  it('never invokes a getter, toString or Symbol.toPrimitive', () => {
    const calls: string[] = [];
    const facts = {
      operation: 'token-request',
      grant: spy(calls),
      status: spy(calls),
      oauthError: spy(calls),
      code: spy(calls),
      get problem() {
        calls.push('getter');
        return 'refused';
      },
    };
    const error = authError['request-failed'](facts);
    render('request-failed', facts);
    assert.deepEqual(calls, []);
    assert.equal(error.reason, UNFAMILIAR_REASON);
    const fields = authError.configuration({
      case: 'required-fields-missing',
      fields: [spy(calls), 'clientId'],
    });
    assert.deepEqual(calls, []);
    assert.deepEqual((fields.facts as { fields: unknown[] }).fields, [
      'clientId',
    ]);
  });
});

describe('F3: every bearer candidate not listed is counted', () => {
  it('counts candidates past the read limit from the array length', () => {
    const candidates = Array.from({ length: 3000 }, () => ({
      reason: 'method-not-bearer',
    }));
    const error = authError['saml-assertion']({
      rule: 'no-bearer-qualifies',
      check: 'bearerConfirmation',
      candidates,
      moreCandidates: count(10),
    });
    const facts = error.facts as {
      candidates: unknown[];
      moreCandidates: number;
    };
    assert.equal(facts.candidates.length, 5);
    assert.equal(facts.moreCandidates, 3005);
  });

  it('caps the tally at 1 000 000', () => {
    const candidates = new Proxy([{ reason: 'method-not-bearer' }], {
      getOwnPropertyDescriptor(target, key) {
        return key === 'length'
          ? {
              value: 5e9,
              writable: true,
              enumerable: false,
              configurable: false,
            }
          : Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const error = authError['saml-assertion']({
      rule: 'no-bearer-qualifies',
      check: 'bearerConfirmation',
      candidates,
    });
    assert.ok(
      (error.facts as { moreCandidates: number }).moreCandidates <= 1_000_000,
    );
  });
});

describe('isMinted', () => {
  it('is true for an error a builder minted', () => {
    assert.equal(isMinted(authError.unknown({ operation: 'refresh' })), true);
  });

  it('is false for a structural copy of a minted error', () => {
    const error = authError.unknown({ operation: 'refresh' });
    assert.equal(isMinted({ ...error }), false);
    assert.equal(isMinted(JSON.parse(JSON.stringify(error))), false);
  });

  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['0', 0],
    [
      '"the client certificate has expired"',
      'the client certificate has expired',
    ],
    ['Symbol(x)', Symbol('x')],
    ['[Function anonymous]', () => undefined],
    ['{}', {}],
    ['[]', []],
  ] as const) {
    it(`is false for ${label}`, () => {
      assert.equal(isMinted(value), false);
    });
  }

  it('is false for the facts or the diagnostics of a minted error', () => {
    const error = authError.snc(
      { problem: 'no-credential' },
      { library: '/opt/libsapcrypto.so' },
    );
    assert.equal(isMinted(error.facts), false);
    assert.equal(isMinted(error.diagnostics), false);
  });
});

describe('the branded makers in facts', () => {
  it('a port and a count reach the facts as numbers', () => {
    const inUse = authError['interactive-login']({
      outcome: 'port-in-use',
      port: port(61001),
    });
    assert.deepEqual(inUse.facts, {
      outcome: 'port-in-use',
      port: 61001,
    });
    const aborted = authError['interactive-login']({
      outcome: 'aborted',
      ignoredCallbacks: count(2),
    });
    assert.deepEqual(aborted.facts, {
      outcome: 'aborted',
      ignoredCallbacks: 2,
    });
  });

  it('aborted keeps its strategy, failed its registered oauthError, in a fixed order', () => {
    const aborted = authError['interactive-login']({
      ignoredCallbacks: count(2),
      strategy: 'browser',
      outcome: 'aborted',
    });
    assert.deepEqual(aborted.facts, {
      outcome: 'aborted',
      strategy: 'browser',
      ignoredCallbacks: 2,
    });
    assert.deepEqual(Object.keys(aborted.facts), [
      'outcome',
      'strategy',
      'ignoredCallbacks',
    ]);
    const failed = authError['interactive-login']({
      oauthError: 'invalid_grant',
      status: httpStatus(400),
      code: 'EPROTO',
      outcome: 'failed',
    });
    assert.deepEqual(Object.keys(failed.facts), [
      'outcome',
      'code',
      'status',
      'oauthError',
    ]);
    assert.deepEqual(failed.facts, {
      outcome: 'failed',
      code: 'EPROTO',
      status: 400,
      oauthError: 'invalid_grant',
    });
  });
});
