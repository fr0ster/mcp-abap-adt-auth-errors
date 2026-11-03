import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { inspect } from 'node:util';
import type {
  AuthOutcome,
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadSecondCopy, type SecondCopy } from './builtPackage';

/**
 * `classify` and `classifyOutcome`, run against the built
 * package. Carriers here are plain objects: the `AuthProviderFailure` cases
 * are in failure.test.ts.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Exports = Record<string, unknown>;
type Classify = (
  thrown: unknown,
  operation: string,
  grant?: string,
) => IAuthProviderError;
type ClassifyOutcome = (
  value: unknown,
  fallback: IAuthProviderError,
) => AuthOutcome;
type Fields = {
  error: string;
  kind: string;
  status?: number;
  diagnostics?: string;
};

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const classify = built.classify as Classify;
const classifyOutcome = built.classifyOutcome as ClassifyOutcome;
const isMinted = built.isMinted as (value: unknown) => boolean;
const renderDiagnostics = built.renderDiagnostics as (
  error: unknown,
) => string | undefined;
const logFields = built.logFields as (error: unknown) => Fields;
const render = built.render as (
  kind: string,
  facts: unknown,
) => { reason: string; hint?: string };
const OK = built.OK;

/** One valid facts object per kind. */
const SAMPLES: { readonly [K in AuthProviderErrorKind]: object } = {
  configuration: { case: 'required-fields-missing', fields: ['clientId'] },
  'client-certificate': { problem: 'expired' },
  'client-authentication': { problem: 'signing-key-unusable' },
  'request-failed': {
    operation: 'client-credentials',
    problem: 'refused',
    status: 403,
    oauthError: 'invalid_client',
  },
  tls: { operation: 'token-request', code: 'CERT_HAS_EXPIRED' },
  'interactive-login': { outcome: 'port-in-use', port: 61001 },
  'saml-assertion': { rule: 'duplicate-id', check: 'duplicateId' },
  snc: {
    problem: 'library-not-found',
    searched: true,
    candidates: [{ source: 'SNC_LIB', reason: 'missing' }],
  },
  spnego: { problem: 'no-credential', operation: 'obtaining-negotiate-token' },
  'credential-refused': { credential: 'token', at: 'request' },
  'system-refused': { verdict: 'not-authorized', status: 403, at: 'logon' },
  'renewal-unchanged': { source: 'token-provider' },
  'renewal-declined': { trigger: 'expired' },
  'token-binding': { problem: 'bound-to-unpinned' },
  'not-prepared': { provider: 'snc' },
  'logon-target': { wire: 'http', refused: 'tls-material' },
  connection: { problem: 'provider-threw', at: 'logon' },
  unknown: { operation: 'refresh', status: 500 },
};
const KINDS = Object.keys(SAMPLES) as AuthProviderErrorKind[];

/** The error this copy mints for `kind` with its sample facts. */
const sample = (kind: AuthProviderErrorKind): IAuthProviderError =>
  authError[kind](SAMPLES[kind]);

/** The plain data of an error: what a structural rebuild must reproduce. */
const shape = (error: IAuthProviderError): unknown =>
  JSON.parse(JSON.stringify(error));

/** `unknown` with the operation (and grant): steps 6 and the catch. */
const unknownWith = (operation: string, grant?: string) =>
  authError.unknown(grant === undefined ? { operation } : { operation, grant });

/** Every rendering of an error a consumer might print or log. */
function renderings(error: IAuthProviderError): string[] {
  return [
    JSON.stringify(error),
    String(error),
    inspect(error, { depth: null }),
    error.reason,
    error.hint ?? '',
    renderDiagnostics(error) ?? '',
    JSON.stringify(logFields(error)),
  ];
}

function expectNoMarker(error: IAuthProviderError, marker: string): void {
  for (const text of renderings(error)) assert.ok(!text.includes(marker));
}

describe('classify — step 1: a value minted by this copy', () => {
  it('returns it as itself, diagnostics included', () => {
    const minted = authError.snc(
      { problem: 'no-credential', secureLoginClient: true },
      { library: '/opt/sec/libsapcrypto.so' },
    );
    assert.equal(classify(minted, 'establishing'), minted);
  });
});

describe('classify — step 2: carrier extraction', () => {
  it('returns a minted error carried in `error` as itself', () => {
    const minted = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sec/libsapcrypto.so' },
    );
    const carrier = { error: minted, message: 'sk-carrier-secret' };
    assert.equal(classify(carrier, 'preparing'), minted);
    assert.ok(
      renderDiagnostics(classify(carrier, 'preparing'))?.includes(
        '/opt/sec/libsapcrypto.so',
      ),
    );
  });

  it('reads `error` once: a descriptor that changes on a second read is not used', () => {
    const valid = {
      kind: 'client-certificate',
      facts: { problem: 'expired' },
    };
    const forged = { kind: 'snc', facts: { problem: 'no-credential' } };
    let reads = 0;
    const carrier = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, key) {
          if (key !== 'error') return undefined;
          reads += 1;
          return {
            value: reads === 1 ? valid : forged,
            writable: true,
            enumerable: true,
            configurable: true,
          };
        },
      },
    );
    const result = classify(carrier, 'refresh');
    assert.equal(reads, 1);
    assert.deepEqual(shape(result), shape(sample('client-certificate')));
  });

  it('never invokes a getter on `error`: it reads as absent, falls through', () => {
    let invoked = 0;
    const carrier = {
      get error() {
        invoked += 1;
        return invoked === 1
          ? { kind: 'client-certificate', facts: { problem: 'expired' } }
          : { kind: 'snc', facts: { problem: 'no-credential' } };
      },
    };
    const result = classify(carrier, 'refresh');
    assert.equal(invoked, 0);
    assert.deepEqual(shape(result), shape(unknownWith('refresh')));
  });

  it('a carrier whose `error` is invalid falls through to steps 4–6 on the carrier', () => {
    const tls = { error: { kind: 'evil' }, code: 'CERT_HAS_EXPIRED' };
    assert.deepEqual(
      shape(classify(tls, 'token-request')),
      shape(
        authError.tls({ operation: 'token-request', code: 'CERT_HAS_EXPIRED' }),
      ),
    );
    const status = { error: 'nope', status: 502 };
    assert.deepEqual(
      shape(classify(status, 'refresh')),
      shape(authError.unknown({ operation: 'refresh', status: 502 })),
    );
    const bare = { error: { kind: 'tls', facts: { code: 'EVIL' } } };
    assert.deepEqual(
      shape(classify(bare, 'refresh')),
      shape(unknownWith('refresh')),
    );
  });
});

describe('classify — step 3: structural rebuild', () => {
  for (const kind of KINDS) {
    it(`rebuilds a bare ${kind} structure, re-minted, re-rendered`, () => {
      const structure = {
        kind,
        facts: SAMPLES[kind],
        reason: 'sk-forged-reason',
        hint: 'sk-forged-hint',
      };
      const result = classify(structure, 'refresh');
      assert.equal(isMinted(result), true);
      assert.notEqual(result, structure);
      assert.deepEqual(shape(result), shape(sample(kind)));
      assert.equal(result.reason, render(kind, SAMPLES[kind]).reason);
      expectNoMarker(result, 'sk-forged');
    });
  }

  for (const kind of KINDS) {
    it(`rebuilds a ${kind} structure carried in \`error\``, () => {
      const result = classify(
        { error: { kind, facts: SAMPLES[kind] } },
        'refresh',
      );
      assert.deepEqual(shape(result), shape(sample(kind)));
    });
  }

  it('re-mints a forged carrier without its secret reason', () => {
    const forged = {
      error: {
        kind: 'client-certificate',
        facts: { problem: 'expired' },
        reason: 'sk-forged-carrier-secret',
      },
    };
    const result = classify(forged, 'loading-certificate');
    assert.equal(result.kind, 'client-certificate');
    assert.deepEqual(result.facts, { problem: 'expired' });
    assert.equal(result.reason, sample('client-certificate').reason);
    expectNoMarker(result, 'sk-forged-carrier-secret');
  });

  it('tries the carrier first, then the value itself', () => {
    const both = {
      kind: 'token-binding',
      facts: { problem: 'bound-to-unpinned' },
      error: { kind: 'not-prepared', facts: { provider: 'snc' } },
    };
    assert.equal(classify(both, 'refresh').kind, 'not-prepared');
    const outerOnly = { ...both, error: { kind: 'evil' } };
    assert.equal(classify(outerOnly, 'refresh').kind, 'token-binding');
  });

  it('an unknown kind falls through', () => {
    const result = classify(
      { error: { kind: 'evil-kind', facts: { problem: 'expired' } } },
      'refresh',
    );
    assert.deepEqual(shape(result), shape(unknownWith('refresh')));
  });

  for (const [kind, facts] of [
    ['client-certificate', { problem: 'stolen' }],
    ['tls', { operation: 'token-request', code: 'EVIL_CODE' }],
    ['saml-assertion', { rule: 'made-up-rule', check: 'issuer' }],
    ['saml-assertion', { rule: 'duplicate-id', check: 'issuer' }],
    ['system-refused', { verdict: 'not-authorized', status: 99, at: 'logon' }],
    ['snc', { problem: 'library-not-found', candidates: [{ source: 'x' }] }],
    ['configuration', { case: 'required-fields-missing' }],
    ['renewal-declined', { trigger: 'MARKER' }],
    ['renewal-unchanged', { source: 'MARKER' }],
  ] as const) {
    it(`facts out of their sets fall through (${kind} ${JSON.stringify(facts)})`, () => {
      const result = classify({ kind, facts }, 'refresh', 'password');
      assert.deepEqual(
        shape(result),
        shape(unknownWith('refresh', 'password')),
      );
    });
  }

  it('drops an optional fact out of its set, keeps the rest', () => {
    const result = classify(
      {
        kind: 'request-failed',
        facts: {
          operation: 'refresh',
          problem: 'refused',
          status: 401,
          oauthError: 'evil_code',
          code: 'EVIL_CODE',
        },
      },
      'refresh',
    );
    assert.deepEqual(result.facts, {
      operation: 'refresh',
      problem: 'refused',
      status: 401,
    });
  });

  for (const [_name, facts, kept, reason] of [
    [
      'aborted, manual',
      { outcome: 'aborted', strategy: 'manual', ignoredCallbacks: 2 },
      { outcome: 'aborted', strategy: 'manual', ignoredCallbacks: 2 },
      'the manual login was aborted',
    ],
    [
      'aborted, browser',
      { outcome: 'aborted', strategy: 'browser' },
      { outcome: 'aborted', strategy: 'browser' },
      'the browser login was aborted',
    ],
    [
      'aborted, a strategy out of its set',
      { outcome: 'aborted', strategy: 'device', ignoredCallbacks: 2 },
      { outcome: 'aborted', ignoredCallbacks: 2 },
      'the authorization was aborted; 2 request(s) to the callback server were refused and ignored',
    ],
    [
      'failed, a registered oauthError',
      { outcome: 'failed', status: 400, oauthError: 'invalid_grant' },
      { outcome: 'failed', status: 400, oauthError: 'invalid_grant' },
      'the browser login failed (HTTP 400, invalid_grant)',
    ],
    [
      'failed, an unregistered oauthError',
      { outcome: 'failed', status: 400, oauthError: 'sk-evil-code' },
      { outcome: 'failed', status: 400 },
      'the browser login failed (HTTP 400)',
    ],
  ] as const) {
    it(`rebuilds a foreign interactive-login (${_name})`, () => {
      for (const value of [
        { kind: 'interactive-login', facts, reason: 'sk-forged' },
        { error: { kind: 'interactive-login', facts, reason: 'sk-forged' } },
      ]) {
        const result = classify(value, 'refresh');
        assert.equal(isMinted(result), true);
        assert.equal(result.kind, 'interactive-login');
        assert.deepEqual(result.facts, kept);
        assert.equal(result.reason, reason);
        expectNoMarker(result, 'sk-');
      }
    });
  }

  it('keeps only the declared keys of facts and drops diagnostics (index-signature limit)', () => {
    const facts: { [key: string]: string } = {
      rule: 'untrusted-issuer',
      check: 'issuer',
      library: 'sk-index-library',
      credential: 'token',
    };
    const diagnostics: { [key: string]: string } = {
      issuer: 'https://idp.example',
      library: 'sk-index-library',
      credential: 'token',
    };
    const structure = {
      kind: 'saml-assertion',
      variant: 'untrusted-issuer',
      facts,
      reason: 'x',
      diagnostics,
    };
    for (const result of [
      classify(structure, 'validating-assertion'),
      classifyRefusal(structure),
    ]) {
      assert.deepEqual(Object.keys(result.facts), ['rule', 'check']);
      assert.equal('diagnostics' in result, false);
      expectNoMarker(result, 'sk-index-library');
    }
  });
});

describe('classify — step 4: TLS failure', () => {
  it('a TLS failure code answers tls with the operation and grant', () => {
    const thrown = Object.assign(new Error('sk-tls-message'), {
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
      status: 500,
    });
    const result = classify(thrown, 'token-request', 'client_credentials');
    assert.equal(result.kind, 'tls');
    assert.deepEqual(result.facts, {
      operation: 'token-request',
      grant: 'client_credentials',
      code: 'ERR_TLS_CERT_ALTNAME_INVALID',
    });
    expectNoMarker(result, 'sk-tls-message');
  });
});

describe('classify — step 5: status, OAuth error, system code', () => {
  it('reads `status`', () => {
    assert.deepEqual(classify({ status: 401 }, 'refresh').facts, {
      operation: 'refresh',
      status: 401,
    });
  });

  it('reads `response.status` when `status` is absent, `status` first', () => {
    assert.deepEqual(classify({ response: { status: 503 } }, 'refresh').facts, {
      operation: 'refresh',
      status: 503,
    });
    assert.deepEqual(
      classify({ status: 401, response: { status: 503 } }, 'refresh').facts,
      { operation: 'refresh', status: 401 },
    );
    assert.deepEqual(
      classify({ status: 4011, response: { status: 503 } }, 'refresh').facts,
      { operation: 'refresh', status: 503 },
    );
  });

  it('reads `oauthError`, else `response.data.error`, registered only', () => {
    assert.deepEqual(
      classify({ oauthError: 'invalid_grant' }, 'refresh').facts,
      { operation: 'refresh', oauthError: 'invalid_grant' },
    );
    assert.deepEqual(
      classify(
        {
          response: {
            status: 400,
            data: {
              error: 'invalid_client',
              error_description: 'sk-description',
            },
          },
        },
        'refresh',
        'password',
      ).facts,
      {
        operation: 'refresh',
        grant: 'password',
        status: 400,
        oauthError: 'invalid_client',
      },
    );
    assert.deepEqual(classify({ oauthError: 'evil_error' }, 'refresh').facts, {
      operation: 'refresh',
    });
  });

  it('reads an allowlisted system `code`', () => {
    const thrown = Object.assign(new Error('sk-econnrefused'), {
      code: 'ECONNREFUSED',
    });
    const result = classify(thrown, 'oidc-discovery');
    assert.equal(result.kind, 'unknown');
    assert.deepEqual(result.facts, {
      operation: 'oidc-discovery',
      code: 'ECONNREFUSED',
    });
    assert.deepEqual(classify({ code: 'EVIL_CODE' }, 'refresh').facts, {
      operation: 'refresh',
    });
  });
});

describe('classify — step 6: anything else', () => {
  for (const [_label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'sk-string-secret'],
    ['a number', 401],
    ['a bigint', 10n],
    ['a boolean', true],
    ['a symbol', Symbol('sk-symbol')],
    ['a function', () => 'sk-function'],
    ['an empty object', {}],
    ['an array', ['sk-array']],
  ] as const) {
    it(`${_label} answers unknown with the operation and grant`, () => {
      const result = classify(value, 'browser-login', 'authorization_code');
      assert.deepEqual(
        shape(result),
        shape(unknownWith('browser-login', 'authorization_code')),
      );
      assert.equal(isMinted(result), true);
    });
  }
});

describe('classify — hostile values', () => {
  const throwing = (): ProxyHandler<object> => {
    const trap = () => {
      throw new Error('sk-trap');
    };
    return {
      get: trap,
      has: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
      defineProperty: trap,
      set: trap,
      deleteProperty: trap,
      apply: trap,
      construct: trap,
      isExtensible: trap,
      preventExtensions: trap,
      setPrototypeOf: trap,
    };
  };

  it('a Proxy whose every trap throws', () => {
    const result = classify(new Proxy({}, throwing()), 'refresh');
    assert.deepEqual(shape(result), shape(unknownWith('refresh')));
  });

  it('a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({ status: 401 }, {});
    revoke();
    assert.deepEqual(
      shape(classify(proxy, 'refresh')),
      shape(unknownWith('refresh')),
    );
    assert.deepEqual(
      shape(classify({ error: proxy }, 'refresh')),
      shape(unknownWith('refresh')),
    );
  });

  it('a Proxy whose getPrototypeOf trap throws (an instanceof would)', () => {
    const value = new Proxy(
      { status: 401 },
      {
        getPrototypeOf() {
          throw new Error('sk-prototype');
        },
      },
    );
    assert.throws(
      () => value instanceof Error,
      (thrown: unknown) =>
        thrown instanceof Error && thrown.message.includes('sk-prototype'),
    );
    assert.deepEqual(classify(value, 'refresh').facts, {
      operation: 'refresh',
      status: 401,
    });
  });

  for (const key of [
    'status',
    'code',
    'response',
    'error',
    'oauthError',
    'kind',
    'facts',
  ]) {
    it(`a getter throwing on \`${key}\` is never invoked`, () => {
      let invoked = 0;
      const value = Object.defineProperty({}, key, {
        get() {
          invoked += 1;
          throw new Error('sk-getter');
        },
        enumerable: true,
      });
      const result = classify(value, 'refresh');
      assert.equal(invoked, 0);
      assert.deepEqual(shape(result), shape(unknownWith('refresh')));
    });
  }

  it('getters nested in `response` and `response.data` are never invoked', () => {
    let invoked = 0;
    const getter = {
      get() {
        invoked += 1;
        throw new Error('sk-getter');
      },
    };
    const value = {
      response: Object.defineProperty(
        { data: Object.defineProperty({}, 'error', getter) },
        'status',
        getter,
      ),
    };
    assert.deepEqual(classify(value, 'refresh').facts, {
      operation: 'refresh',
    });
    assert.equal(invoked, 0);
  });

  it('an invalid operation answers the unfamiliar error, never throws', () => {
    const result = classify(new Proxy({}, throwing()), 'evil-operation');
    assert.equal(result.kind, 'unknown');
    assert.deepEqual(result.facts, { operation: 'unfamiliar-error' });
  });
});

describe('classify — exception text excluded', () => {
  const MARKER = 'sk-exception-marker-7f3a';

  /** An Error holding the marker in every free-text place, with `kind`/`facts`. */
  function markedError(kind: AuthProviderErrorKind): Error {
    const error = new Error(MARKER, { cause: new Error(MARKER) });
    error.name = MARKER;
    error.stack = MARKER;
    return Object.assign(error, {
      kind,
      facts: SAMPLES[kind],
      reason: MARKER,
      hint: MARKER,
      diagnostics: { library: MARKER, issuer: MARKER, configuredUri: MARKER },
    });
  }

  for (const kind of KINDS) {
    it(`${kind}: an Error with the marker everywhere, bare and carried`, () => {
      for (const value of [
        markedError(kind),
        { error: markedError(kind) },
        Object.assign(new Error(MARKER), { error: markedError(kind) }),
      ]) {
        const result = classify(value, 'refresh');
        assert.deepEqual(shape(result), shape(sample(kind)));
        expectNoMarker(result, MARKER);
      }
    });
  }

  it('an Error with only free text answers unknown without it', () => {
    const error = new Error(MARKER, { cause: MARKER });
    error.name = MARKER;
    const result = classify(error, 'refresh');
    assert.deepEqual(shape(result), shape(unknownWith('refresh')));
    expectNoMarker(result, MARKER);
  });
});

describe('classify — re-mint across copies (RF3 included)', () => {
  let second: SecondCopy;
  let secondBuilders: Record<AuthProviderErrorKind, Builder>;
  let secondIsMinted: (value: unknown) => boolean;

  before(() => {
    second = loadSecondCopy();
    secondBuilders = second.exports.authError as Record<
      AuthProviderErrorKind,
      Builder
    >;
    secondIsMinted = second.exports.isMinted as (value: unknown) => boolean;
  });
  after(() => second.remove());

  it('the second copy has its own minted set', () => {
    const theirs = secondBuilders['client-certificate']({ problem: 'expired' });
    assert.equal(secondIsMinted(theirs), true);
    assert.equal(isMinted(theirs), false);
  });

  for (const kind of KINDS) {
    it(`${kind} minted by the other copy: same kind and facts, re-rendered`, () => {
      const theirs = secondBuilders[kind](SAMPLES[kind]);
      const result = classify(theirs, 'refresh');
      assert.notEqual(result, theirs);
      assert.equal(isMinted(result), true);
      assert.deepEqual(shape(result), shape(sample(kind)));
    });
  }

  for (const kind of KINDS) {
    it(`${kind}: structuredClone and a JSON round-trip classify alike, without diagnostics`, () => {
      const ours = sample(kind);
      for (const copy of [
        structuredClone(ours),
        JSON.parse(JSON.stringify(ours)),
      ]) {
        const result = classify(copy, 'refresh');
        assert.equal(isMinted(result), true);
        assert.equal(result.kind, ours.kind);
        assert.deepEqual(result.facts, ours.facts);
        assert.equal('diagnostics' in result, false);
      }
    });
  }

  it('a clone of a minted error with diagnostics loses them', () => {
    const ours = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sk-clone/libsapcrypto.so' },
    );
    assert.ok(renderDiagnostics(ours)?.includes('sk-clone'));
    for (const copy of [
      structuredClone(ours),
      JSON.parse(JSON.stringify(ours)),
    ]) {
      const result = classify(copy, 'refresh');
      assert.deepEqual(result.facts, ours.facts);
      expectNoMarker(result, 'sk-clone');
    }
  });
});

/** `classifyOutcome` of `{ ok: false, refusal }`, answering the refusal. */
function classifyRefusal(refusal: unknown): IAuthProviderError {
  const fallback = authError['not-prepared']({ provider: 'certificate' });
  const outcome = classifyOutcome({ ok: false, refusal }, fallback);
  if (outcome.ok) throw new Error('expected a refusal');
  return outcome.refusal;
}

describe('forged diagnostics', () => {
  const JWT_MARKER =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzay1qd3QtbWFya2VyIn0.c2stc2lnbmF0dXJl';
  const EXCEPTION_MARKER = 'Error: sk-exception-in-issuer at line 1';
  const sncFacts = { problem: 'no-credential', secureLoginClient: false };
  const samlFacts = { rule: 'untrusted-issuer', check: 'issuer' };

  let second: SecondCopy;
  before(() => {
    second = loadSecondCopy();
  });
  after(() => second.remove());

  /** (a) and (b): structurally valid, not minted, with forged diagnostics. */
  const forgedA = () => ({
    kind: 'snc',
    variant: 'no-credential',
    facts: sncFacts,
    reason: render('snc', sncFacts).reason,
    hint: render('snc', sncFacts).hint,
    diagnostics: { library: JWT_MARKER },
  });
  const forgedB = () => ({
    kind: 'saml-assertion',
    variant: 'untrusted-issuer',
    facts: samlFacts,
    reason: render('saml-assertion', samlFacts).reason,
    diagnostics: { issuer: EXCEPTION_MARKER },
  });
  /** (c): the same, minted by the second copy (whose builder admits them). */
  const secondA = () =>
    (second.exports.authError as Record<AuthProviderErrorKind, Builder>).snc(
      sncFacts,
      {
        library: JWT_MARKER,
      },
    );
  const secondB = () =>
    (second.exports.authError as Record<AuthProviderErrorKind, Builder>)[
      'saml-assertion'
    ](samlFacts, { issuer: EXCEPTION_MARKER });

  it('the second copy did admit both diagnostics (the case is real)', () => {
    const render2 = second.exports.renderDiagnostics as (
      e: unknown,
    ) => string | undefined;
    assert.ok(render2(secondA())?.includes(JWT_MARKER));
    assert.ok(render2(secondB())?.includes('sk-exception-in-issuer'));
  });

  type Case = [string, () => unknown, string, string, object];
  const cases = (): Case[] => [
    ['(a) snc not minted', forgedA, JWT_MARKER, 'snc', sncFacts],
    [
      '(b) saml not minted',
      forgedB,
      'sk-exception-in-issuer',
      'saml-assertion',
      samlFacts,
    ],
    ['(c) snc second copy', secondA, JWT_MARKER, 'snc', sncFacts],
    [
      '(c) saml second copy',
      secondB,
      'sk-exception-in-issuer',
      'saml-assertion',
      samlFacts,
    ],
    [
      '(e) snc in a plain carrier',
      () => ({ error: forgedA() }),
      JWT_MARKER,
      'snc',
      sncFacts,
    ],
    [
      '(e) saml in a plain carrier',
      () => ({ error: forgedB() }),
      'sk-exception-in-issuer',
      'saml-assertion',
      samlFacts,
    ],
  ];

  for (const [_label, make, marker, kind, facts] of cases()) {
    it(`${_label} through classify: kind and facts kept, no diagnostics, marker in no rendering`, () => {
      const result = classify(make(), 'establishing');
      assert.equal(result.kind, kind);
      assert.deepEqual(result.facts, facts);
      assert.equal('diagnostics' in result, false);
      expectNoMarker(result, marker);
    });
  }

  for (const [_label, make, marker, kind, facts] of cases().slice(0, 4)) {
    it(`${_label} through classifyOutcome: kind and facts kept, no diagnostics, marker in no rendering`, () => {
      const value = make();
      const result = classifyRefusal(value);
      assert.notEqual(result, value);
      assert.equal(result.kind, kind);
      assert.deepEqual(result.facts, facts);
      assert.equal('diagnostics' in result, false);
      expectNoMarker(result, marker);
    });
  }

  it('positive: the same errors minted by this copy keep their diagnostics, the same object', () => {
    const a = authError.snc(sncFacts, { library: JWT_MARKER });
    const b = authError['saml-assertion'](samlFacts, {
      issuer: EXCEPTION_MARKER,
    });
    for (const minted of [a, b]) {
      assert.notEqual(renderDiagnostics(minted), undefined);
      assert.equal(classify(minted, 'establishing'), minted);
      assert.equal(classify({ error: minted }, 'establishing'), minted);
      assert.equal(classifyRefusal(minted), minted);
    }
    assert.ok(renderDiagnostics(a)?.includes(JWT_MARKER));
  });
});

describe('classifyOutcome', () => {
  const fallback = authError['not-prepared']({ provider: 'certificate' });

  it('{ ok: true } answers the frozen OK', () => {
    assert.equal(classifyOutcome({ ok: true }, fallback), OK);
    assert.equal(classifyOutcome(OK, fallback), OK);
  });

  it('a minted refusal is answered as itself, in a fresh frozen outcome', () => {
    const refusal = sample('credential-refused');
    const input = { ok: false, refusal };
    const outcome = classifyOutcome(input, fallback);
    assert.notEqual(outcome, input);
    assert.deepEqual(outcome, { ok: false, refusal });
    assert.equal(outcome.ok === false && outcome.refusal, refusal);
    assert.equal(Object.isFrozen(outcome), true);
  });

  it('a structural refusal is rebuilt, its reason never read', () => {
    const outcome = classifyOutcome(
      {
        ok: false,
        refusal: {
          kind: 'client-certificate',
          facts: { problem: 'expired' },
          reason: 'sk-outcome-secret',
        },
      },
      fallback,
    );
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.deepEqual(
      shape(outcome.refusal),
      shape(sample('client-certificate')),
    );
    expectNoMarker(outcome.refusal, 'sk-outcome-secret');
  });

  for (const [_label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ok'],
    ['ok as a string', { ok: 'true' }],
    ['ok: 1', { ok: 1 }],
    ['no refusal', { ok: false }],
    ['an invalid refusal', { ok: false, refusal: { kind: 'evil' } }],
    ['a thrown-value refusal', { ok: false, refusal: { status: 401 } }],
    [
      'a carrier as refusal (no carrier extraction)',
      { ok: false, refusal: { error: { kind: 'tls', facts: SAMPLES.tls } } },
    ],
    ['a function', () => ({ ok: true })],
    ['a symbol', Symbol('ok')],
  ] as const) {
    it(`${_label} answers the fallback`, () => {
      const outcome = classifyOutcome(value, fallback);
      assert.deepEqual(outcome, { ok: false, refusal: fallback });
      assert.equal(outcome.ok === false && outcome.refusal, fallback);
    });
  }

  describe('the fallback itself is classified', () => {
    let second: SecondCopy;
    before(() => {
      second = loadSecondCopy();
    });
    after(() => second.remove());
    const sncFacts = { problem: 'no-credential', secureLoginClient: false };

    it('a forged fallback is rebuilt: its reason and diagnostics are dropped', () => {
      const forged = {
        kind: 'snc',
        variant: 'no-credential',
        facts: sncFacts,
        reason: 'sk-fallback-reason',
        diagnostics: { library: 'sk-fallback-diagnostics' },
      } as unknown as IAuthProviderError;
      const outcome = classifyOutcome(null, forged);
      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.notEqual(outcome.refusal, forged);
      assert.equal(isMinted(outcome.refusal), true);
      assert.equal(outcome.refusal.kind, 'snc');
      assert.equal(outcome.refusal.diagnostics, undefined);
      expectNoMarker(outcome.refusal, 'sk-fallback');
    });

    it('a fallback minted by a second copy is rebuilt without diagnostics', () => {
      const foreign = (
        second.exports.authError as Record<AuthProviderErrorKind, Builder>
      ).snc(sncFacts, { library: 'sk-second-copy-diagnostics' });
      const outcome = classifyOutcome({ ok: 'no' }, foreign);
      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.notEqual(outcome.refusal, foreign);
      assert.equal(isMinted(outcome.refusal), true);
      assert.equal(outcome.refusal.diagnostics, undefined);
      expectNoMarker(outcome.refusal, 'sk-second-copy');
    });

    it('a garbage fallback answers unknown, unfamiliar-error', () => {
      const outcome = classifyOutcome(undefined, {
        reason: 'sk-garbage',
      } as unknown as IAuthProviderError);
      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.deepEqual(
        shape(outcome.refusal),
        shape(unknownWith('unfamiliar-error')),
      );
      expectNoMarker(outcome.refusal, 'sk-garbage');
    });

    it('a fallback minted by this copy is kept as itself, diagnostics included', () => {
      const own = authError.snc(sncFacts, {
        library: '/usr/lib/libsapcrypto.so',
      });
      const outcome = classifyOutcome(null, own);
      assert.equal(outcome.ok === false && outcome.refusal, own);
    });
  });

  it('getters on `ok` and `refusal` are never invoked', () => {
    let invoked = 0;
    const getter = {
      get() {
        invoked += 1;
        throw new Error('sk-getter');
      },
    };
    const onOk = Object.defineProperty({}, 'ok', getter);
    const onRefusal = Object.defineProperty({ ok: false }, 'refusal', getter);
    assert.deepEqual(classifyOutcome(onOk, fallback), {
      ok: false,
      refusal: fallback,
    });
    assert.deepEqual(classifyOutcome(onRefusal, fallback), {
      ok: false,
      refusal: fallback,
    });
    assert.equal(invoked, 0);
  });

  it('a Proxy whose every trap throws, and a revoked Proxy, answer the fallback', () => {
    const trap = () => {
      throw new Error('sk-trap');
    };
    const hostile = new Proxy(
      {},
      {
        get: trap,
        has: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
      },
    );
    const { proxy, revoke } = Proxy.revocable({ ok: true }, {});
    revoke();
    for (const value of [hostile, proxy, { ok: false, refusal: proxy }]) {
      assert.deepEqual(classifyOutcome(value, fallback), {
        ok: false,
        refusal: fallback,
      });
    }
  });

  it('reads `refusal` once', () => {
    let reads = 0;
    const value = new Proxy(
      {},
      {
        getOwnPropertyDescriptor(_target, key) {
          if (key === 'ok') {
            return {
              value: false,
              writable: true,
              enumerable: true,
              configurable: true,
            };
          }
          if (key !== 'refusal') return undefined;
          reads += 1;
          return {
            value:
              reads === 1
                ? { kind: 'client-certificate', facts: { problem: 'expired' } }
                : { kind: 'evil' },
            writable: true,
            enumerable: true,
            configurable: true,
          };
        },
      },
    );
    const outcome = classifyOutcome(value, fallback);
    assert.equal(reads, 1);
    assert.equal(
      outcome.ok === false && outcome.refusal.kind,
      'client-certificate',
    );
  });
});

describe('logFields and renderDiagnostics route a non-minted input through classify', () => {
  it('logFields of a structural copy is the fields of its rebuild', () => {
    const forged = {
      kind: 'snc',
      reason: 'sk-log-secret',
      status: 500,
      facts: { problem: 'library-init-failed' },
      diagnostics: { library: '/sk-log-library' },
    };
    const fields = logFields(forged);
    assert.deepEqual(
      fields,
      logFields(authError.snc({ problem: 'library-init-failed' })),
    );
    assert.ok(!JSON.stringify(fields).includes('sk-log'));
  });

  it('logFields of a carrier is the fields of what classify answers', () => {
    const minted = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sec/libsapcrypto.so' },
    );
    assert.deepEqual(logFields({ error: minted }), logFields(minted));
    assert.deepEqual(
      logFields({ status: 401 }),
      logFields(
        authError.unknown({ operation: 'unfamiliar-error', status: 401 }),
      ),
    );
  });

  it('renderDiagnostics answers undefined for a non-minted structure with diagnostics', () => {
    const forged = {
      kind: 'snc',
      facts: { problem: 'library-init-failed' },
      diagnostics: { library: '/sk-render-library' },
    };
    assert.equal(renderDiagnostics(forged), undefined);
  });
});
