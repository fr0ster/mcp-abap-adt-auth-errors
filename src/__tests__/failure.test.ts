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
 * `AuthProviderFailure`, `readFailure`, `isAuthProviderFailure`, run against the built package. Completes the
 * forged-diagnostics matrix at the `readFailure` boundary and its case (d),
 * a second copy's `AuthProviderFailure`, through `classify` and
 * `classifyOutcome`.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Failure = Error & { readonly error: IAuthProviderError };
type FailureClass = new (error: IAuthProviderError) => Failure;
type Classify = (
  thrown: unknown,
  operation: string,
  grant?: string,
) => IAuthProviderError;
type ClassifyOutcome = (
  value: unknown,
  fallback: IAuthProviderError,
) => AuthOutcome;

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const AuthProviderFailure = built.AuthProviderFailure as FailureClass;
const readFailure = built.readFailure as (
  thrown: unknown,
  operation: string,
) => IAuthProviderError;
const isAuthProviderFailure = built.isAuthProviderFailure as (
  value: unknown,
) => boolean;
const classify = built.classify as Classify;
const classifyOutcome = built.classifyOutcome as ClassifyOutcome;
const isMinted = built.isMinted as (value: unknown) => boolean;
const renderDiagnostics = built.renderDiagnostics as (
  error: unknown,
) => string | undefined;
const logFields = built.logFields as (error: unknown) => unknown;
const render = built.render as (
  kind: string,
  facts: unknown,
) => { reason: string; hint?: string };

/** One valid facts object per kind (as classify.test.ts). */
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

const sample = (kind: AuthProviderErrorKind): IAuthProviderError =>
  authError[kind](SAMPLES[kind]);

const shape = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The fixed error an unminted constructor argument becomes. */
const UNFAMILIAR = () => authError.unknown({ operation: 'unfamiliar-error' });

/** The message the contract fixes: `reason`, or `reason — hint`. */
const messageOf = (error: IAuthProviderError): string =>
  error.hint === undefined ? error.reason : `${error.reason} — ${error.hint}`;

/** Every rendering of an error a consumer might print or log. */
function errorRenderings(error: IAuthProviderError): string[] {
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

/** Every rendering of a failure a consumer might print or log. */
function failureRenderings(failure: Failure): string[] {
  return [
    JSON.stringify(failure),
    String(failure),
    failure.message,
    failure.stack ?? '',
    inspect(failure, { depth: null }),
    JSON.stringify({ ...failure }),
  ];
}

describe('the built package exports', () => {
  it('AuthProviderFailure, readFailure, isAuthProviderFailure, OK', () => {
    assert.equal(typeof built.AuthProviderFailure, 'function');
    assert.equal(typeof built.readFailure, 'function');
    assert.equal(typeof built.isAuthProviderFailure, 'function');
    assert.deepEqual(built.OK, { ok: true });
    assert.equal(Object.isFrozen(built.OK), true);
  });
});

describe('AuthProviderFailure — the instance', () => {
  for (const kind of KINDS) {
    it(`${kind}: message is reason, or reason — hint`, () => {
      const error = sample(kind);
      const failure = new AuthProviderFailure(error);
      assert.equal(failure.message, messageOf(error));
    });
  }

  it('the message format, with a hint and without one', () => {
    const words = KINDS.map((kind) => sample(kind));
    const withHint = words.find((e) => e.hint !== undefined);
    const withoutHint = words.find((e) => e.hint === undefined);
    if (withHint === undefined || withoutHint === undefined) {
      throw new Error('the samples must hold a kind with and without a hint');
    }
    assert.equal(
      new AuthProviderFailure(withHint).message,
      `${withHint.reason} — ${withHint.hint}`,
    );
    assert.equal(
      new AuthProviderFailure(withoutHint).message,
      withoutHint.reason,
    );
  });

  it('is an Error named AuthProviderFailure, without a cause', () => {
    const failure = new AuthProviderFailure(sample('tls'));
    assert.ok(failure instanceof Error);
    assert.ok(failure instanceof AuthProviderFailure);
    assert.equal(failure.name, 'AuthProviderFailure');
    assert.equal(Object.hasOwn(failure, 'name'), true);
    assert.equal('cause' in failure, false);
    assert.equal(
      String(failure),
      `AuthProviderFailure: ${messageOf(sample('tls'))}`,
    );
  });

  it('holds the minted error itself, as an own data property', () => {
    const error = sample('snc');
    const failure = new AuthProviderFailure(error);
    assert.equal(failure.error, error);
    const descriptor = Object.getOwnPropertyDescriptor(failure, 'error');
    assert.notEqual(descriptor, undefined);
    assert.equal(descriptor && 'value' in descriptor, true);
    // classify reads `error` only as an own data property: it gets it back.
    assert.equal(classify(failure, 'refresh'), error);
    assert.equal(readFailure(failure, 'refresh'), error);
  });

  it('error and message cannot be reassigned, deleted or redefined', () => {
    const error = sample('snc');
    const failure = new AuthProviderFailure(error);
    const message = failure.message;
    for (const key of ['error', 'message'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(failure, key);
      assert.deepEqual(
        {
          enumerable: descriptor?.enumerable,
          writable: descriptor?.writable,
          configurable: descriptor?.configurable,
        },
        { enumerable: true, writable: false, configurable: false },
      );
    }
    const writable = failure as unknown as Record<string, unknown>;
    assert.throws(() => {
      writable.error = sample('tls');
    }, TypeError);
    assert.throws(() => {
      writable.message = 'sk-assigned';
    }, TypeError);
    assert.throws(() => {
      delete writable.error;
    }, TypeError);
    assert.throws(
      () => Object.defineProperty(failure, 'error', { value: sample('tls') }),
      TypeError,
    );
    assert.equal(failure.error, error);
    assert.equal(failure.message, message);
    assert.equal(classify(failure, 'refresh'), error);
  });

  it('a subclass’s prototype accessor `error` cannot intercept the field', () => {
    const error = sample('tls');
    const forged = { kind: 'tls', reason: 'sk-accessor' };
    class Sub extends AuthProviderFailure {}
    let invoked = 0;
    Object.defineProperty(Sub.prototype, 'error', {
      get: () => {
        invoked += 1;
        return forged;
      },
      set: () => {
        invoked += 1;
      },
      configurable: true,
    });
    const failure = new Sub(error);
    assert.equal(invoked, 0);
    assert.equal(
      Object.getOwnPropertyDescriptor(failure, 'error')?.value,
      error,
    );
    assert.equal(failure.error, error);
    assert.equal(classify(failure, 'refresh'), error);
  });

  it('stack: its header is the fixed words, nothing of the input', () => {
    const error = sample('tls');
    const failure = new AuthProviderFailure(error);
    assert.equal(
      failure.stack?.split('\n')[0],
      `AuthProviderFailure: ${messageOf(error)}`,
    );
    const forged = new AuthProviderFailure({
      kind: 'tls',
      reason: 'sk-stack-marker',
    } as unknown as IAuthProviderError);
    assert.equal(
      forged.stack?.split('\n')[0],
      `AuthProviderFailure: ${messageOf(UNFAMILIAR())}`,
    );
    assert.equal(forged.stack?.includes('sk-stack-marker'), false);
  });

  it('no diagnostics in the message', () => {
    const error = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sk-diag-marker/libsapcrypto.so' },
    );
    assert.ok(renderDiagnostics(error)?.includes('sk-diag-marker'));
    const failure = new AuthProviderFailure(error);
    assert.ok(!failure.message.includes('sk-diag-marker'));
    assert.ok(!String(failure).includes('sk-diag-marker'));
  });

  it('JSON.stringify and a pino-style enumerable copy hold only name, message, error', () => {
    const error = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sk-pino/libsapcrypto.so' },
    );
    const failure = new AuthProviderFailure(error);
    const json = JSON.parse(JSON.stringify(failure)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(json).sort(), ['error', 'message', 'name']);
    assert.equal(json.name, 'AuthProviderFailure');
    assert.equal(json.message, messageOf(error));
    assert.deepEqual(json.error, shape(error));

    // pino's serializer copies the enumerable own properties.
    const copy: Record<string, unknown> = {};
    for (const key in failure) {
      copy[key] = (failure as unknown as Record<string, unknown>)[key];
    }
    assert.deepEqual(Object.keys(copy).sort(), ['error', 'message', 'name']);
    assert.equal(copy.error, error);
  });
});

describe('AuthProviderFailure — an unminted argument', () => {
  it('RF3: structuredClone of a minted error becomes the fixed unknown, operation unfamiliar-error (documented behaviour; the constructor takes no operation)', () => {
    for (const kind of KINDS) {
      const failure = new AuthProviderFailure(structuredClone(sample(kind)));
      assert.equal(isMinted(failure.error), true);
      assert.deepEqual(shape(failure.error), shape(UNFAMILIAR()));
      assert.equal(failure.message, messageOf(UNFAMILIAR()));
    }
  });

  it('a JSON copy, a plain object, a primitive, a hostile Proxy become the same', () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const throwing = new Proxy(
      {},
      {
        get: () => {
          throw new Error('sk-proxy');
        },
        getOwnPropertyDescriptor: () => {
          throw new Error('sk-proxy');
        },
        getPrototypeOf: () => {
          throw new Error('sk-proxy');
        },
      },
    );
    for (const value of [
      shape(sample('tls')),
      { kind: 'tls', reason: 'sk-free-text' },
      'sk-string',
      undefined,
      null,
      revocable.proxy,
      throwing,
    ]) {
      const failure = new AuthProviderFailure(value as IAuthProviderError);
      assert.deepEqual(shape(failure.error), shape(UNFAMILIAR()));
      for (const text of failureRenderings(failure)) {
        assert.ok(!text.includes('sk-'));
      }
    }
  });
});

describe('readFailure', () => {
  it('is classify with the operation', () => {
    const thrown = { status: 503, code: 'ECONNRESET' };
    assert.deepEqual(
      shape(readFailure(thrown, 'refresh')),
      shape(classify(thrown, 'refresh')),
    );
    assert.deepEqual(
      shape(readFailure(new Error('sk-x'), 'device-poll')),
      shape(authError.unknown({ operation: 'device-poll' })),
    );
  });

  it('a minted error, bare or in this copy’s failure, is answered as itself', () => {
    const error = sample('connection');
    assert.equal(readFailure(error, 'refresh'), error);
    assert.equal(readFailure(new AuthProviderFailure(error), 'refresh'), error);
  });
});

describe('isAuthProviderFailure', () => {
  let second: SecondCopy;
  before(() => {
    second = loadSecondCopy();
  });
  after(() => second.remove());

  it('true for this copy’s instance', () => {
    assert.equal(
      isAuthProviderFailure(new AuthProviderFailure(sample('tls'))),
      true,
    );
  });

  it('true for another copy’s instance, whose instanceof here is false', () => {
    const SecondFailure = second.exports.AuthProviderFailure as FailureClass;
    const secondBuilders = second.exports.authError as Record<
      AuthProviderErrorKind,
      Builder
    >;
    for (const kind of KINDS) {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      assert.ok(!(theirs instanceof AuthProviderFailure));
      assert.equal(isAuthProviderFailure(theirs), true);
    }
  });

  it('true for a structural object: the name and an error that rebuilds', () => {
    assert.equal(
      isAuthProviderFailure({
        name: 'AuthProviderFailure',
        error: shape(sample('snc')),
      }),
      true,
    );
  });

  it('a forged structural value passes, and readFailure answers rebuilt words, not the forged ones', () => {
    const facts = { operation: 'token-request', code: 'CERT_HAS_EXPIRED' };
    const forged = {
      name: 'AuthProviderFailure',
      message: 'sk-forged-message',
      error: {
        kind: 'tls',
        facts,
        reason: 'sk-forged-reason',
        hint: 'sk-forged-hint',
        diagnostics: { library: 'sk-forged-diagnostics' },
      },
    };
    assert.equal(isAuthProviderFailure(forged), true);
    const read = readFailure(forged, 'refresh');
    assert.equal(isMinted(read), true);
    assert.deepEqual(shape(read), shape(authError.tls(facts)));
    for (const text of errorRenderings(read)) {
      assert.ok(!text.includes('sk-forged'));
    }
  });

  it('false without the name, with another name, or with an invalid error', () => {
    const error = sample('tls');
    assert.equal(isAuthProviderFailure({ error }), false);
    assert.equal(isAuthProviderFailure({ name: 'Error', error }), false);
    assert.equal(
      isAuthProviderFailure({ name: 'AuthProviderFailure', error: {} }),
      false,
    );
    assert.equal(
      isAuthProviderFailure({
        name: 'AuthProviderFailure',
        error: { kind: 'tls', facts: { code: 'EVIL_CODE' } },
      }),
      false,
    );
    assert.equal(
      isAuthProviderFailure({ name: 'AuthProviderFailure', error: 'x' }),
      false,
    );
    assert.equal(
      isAuthProviderFailure(new Error('AuthProviderFailure')),
      false,
    );
  });

  it('false for primitives, functions, and hostile values; never throws', () => {
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    const throwing = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('trap');
        },
        get: () => {
          throw new Error('trap');
        },
      },
    );
    for (const value of [
      undefined,
      null,
      0,
      'AuthProviderFailure',
      Symbol('x'),
      () => undefined,
      revocable.proxy,
      throwing,
    ]) {
      assert.equal(isAuthProviderFailure(value), false);
    }
  });

  it('never invokes a getter, never reads message', () => {
    let invoked = 0;
    const withGetters = {};
    Object.defineProperty(withGetters, 'name', {
      get: () => {
        invoked += 1;
        return 'AuthProviderFailure';
      },
    });
    Object.defineProperty(withGetters, 'error', {
      get: () => {
        invoked += 1;
        return sample('tls');
      },
    });
    assert.equal(isAuthProviderFailure(withGetters), false);
    assert.equal(invoked, 0);

    const asked: PropertyKey[] = [];
    const target = new AuthProviderFailure(sample('tls'));
    const watched = new Proxy(target, {
      get: (t, key, receiver) => {
        asked.push(key);
        return Reflect.get(t, key, receiver);
      },
      getOwnPropertyDescriptor: (t, key) => {
        asked.push(key);
        return Reflect.getOwnPropertyDescriptor(t, key);
      },
    });
    assert.equal(isAuthProviderFailure(watched), true);
    assert.ok(!asked.includes('message'));
    assert.ok(!asked.includes('stack'));
    assert.ok(!asked.includes('cause'));
  });
});

/** `classifyOutcome` of `{ ok: false, refusal }`, answering the refusal. */
function classifyRefusal(refusal: unknown): IAuthProviderError {
  const fallback = authError['not-prepared']({ provider: 'certificate' });
  const outcome = classifyOutcome({ ok: false, refusal }, fallback);
  if (outcome.ok) throw new Error('expected a refusal');
  return outcome.refusal;
}

describe('a second copy’s AuthProviderFailure of every kind (C4)', () => {
  let second: SecondCopy;
  let SecondFailure: FailureClass;
  let secondBuilders: Record<AuthProviderErrorKind, Builder>;
  before(() => {
    second = loadSecondCopy();
    SecondFailure = second.exports.AuthProviderFailure as FailureClass;
    secondBuilders = second.exports.authError as Record<
      AuthProviderErrorKind,
      Builder
    >;
  });
  after(() => second.remove());

  for (const kind of KINDS) {
    it(`${kind} through classify and readFailure: same kind and facts, re-rendered, minted here`, () => {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      for (const result of [
        classify(theirs, 'refresh'),
        readFailure(theirs, 'refresh'),
      ]) {
        assert.notEqual(result, theirs.error);
        assert.equal(isMinted(result), true);
        assert.deepEqual(shape(result), shape(sample(kind)));
        assert.equal('diagnostics' in result, false);
      }
    });
  }

  for (const kind of KINDS) {
    it(`${kind} through classifyOutcome, the failure’s error as the refusal: same kind and facts, re-rendered`, () => {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      const result = classifyRefusal(theirs.error);
      assert.notEqual(result, theirs.error);
      assert.equal(isMinted(result), true);
      assert.deepEqual(shape(result), shape(sample(kind)));
    });
  }
});

describe('forged diagnostics', () => {
  const JWT_MARKER =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzay1qd3QtbWFya2VyIn0.c2stc2lnbmF0dXJl';
  const EXCEPTION_MARKER = 'Error: sk-exception-in-issuer at line 1';
  const sncFacts = { problem: 'no-credential', secureLoginClient: false };
  const samlFacts = { rule: 'untrusted-issuer', check: 'issuer' };

  let second: SecondCopy;
  let SecondFailure: FailureClass;
  before(() => {
    second = loadSecondCopy();
    SecondFailure = second.exports.AuthProviderFailure as FailureClass;
  });
  after(() => second.remove());

  const secondBuilders = () =>
    second.exports.authError as Record<AuthProviderErrorKind, Builder>;

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
  /** (c): the same, minted by the second copy. */
  const secondA = () => secondBuilders().snc(sncFacts, { library: JWT_MARKER });
  const secondB = () =>
    secondBuilders()['saml-assertion'](samlFacts, {
      issuer: EXCEPTION_MARKER,
    });
  /** (d): (c) inside the second copy's AuthProviderFailure. */
  const failureA = () => new SecondFailure(secondA());
  const failureB = () => new SecondFailure(secondB());

  it('the second copy’s failures do carry both diagnostics (the case is real)', () => {
    const render2 = second.exports.renderDiagnostics as (
      e: unknown,
    ) => string | undefined;
    assert.ok(render2(failureA().error)?.includes(JWT_MARKER));
    assert.ok(render2(failureB().error)?.includes('sk-exception-in-issuer'));
    assert.ok(inspect(failureA(), { depth: null }).includes(JWT_MARKER));
  });

  type Case = [string, () => unknown, string, string, object];
  const A = (label: string, make: () => unknown): Case => [
    label,
    make,
    JWT_MARKER,
    'snc',
    sncFacts,
  ];
  const B = (label: string, make: () => unknown): Case => [
    label,
    make,
    'sk-exception-in-issuer',
    'saml-assertion',
    samlFacts,
  ];
  const cases = (): Case[] => [
    A('(a) snc not minted', forgedA),
    B('(b) saml not minted', forgedB),
    A('(c) snc second copy, bare', secondA),
    B('(c) saml second copy, bare', secondB),
    A('(c) snc second copy, in a plain carrier', () => ({ error: secondA() })),
    B('(c) saml second copy, in a plain carrier', () => ({
      error: secondB(),
    })),
    A('(d) snc in the second copy’s AuthProviderFailure', failureA),
    B('(d) saml in the second copy’s AuthProviderFailure', failureB),
    A('(e) snc in a plain carrier', () => ({ error: forgedA() })),
    B('(e) saml in a plain carrier', () => ({ error: forgedB() })),
  ];

  /** Throws `value` and answers what was caught. */
  const caught = (value: unknown): unknown => {
    try {
      throw value;
    } catch (thrown) {
      return thrown;
    }
  };

  for (const [_label, make, marker, kind, facts] of cases()) {
    it(`${_label} thrown, read with readFailure, wrapped here: kind and facts kept, no diagnostics, marker in no rendering`, () => {
      const result = readFailure(caught(make()), 'establishing');
      assert.equal(isMinted(result), true);
      assert.equal(result.kind, kind);
      assert.deepEqual(result.facts, facts);
      assert.equal('diagnostics' in result, false);
      for (const text of errorRenderings(result)) {
        assert.ok(!text.includes(marker));
      }
      const failure = new AuthProviderFailure(result);
      assert.equal(failure.error, result);
      for (const text of failureRenderings(failure)) {
        assert.ok(!text.includes(marker));
      }
    });
  }

  for (const [_label, make, marker, kind, facts] of cases().filter(([label]) =>
    label.startsWith('(d)'),
  )) {
    it(`${_label} through classify and classifyOutcome (the failure’s error as the refusal): no diagnostics, marker in no rendering`, () => {
      const theirs = make() as Failure;
      for (const result of [
        classify(theirs, 'establishing'),
        classifyRefusal(theirs.error),
      ]) {
        assert.equal(result.kind, kind);
        assert.deepEqual(result.facts, facts);
        assert.equal('diagnostics' in result, false);
        for (const text of errorRenderings(result)) {
          assert.ok(!text.includes(marker));
        }
      }
    });
  }

  for (const [_label, make, marker] of [
    A('(a)', forgedA),
    B('(b)', forgedB),
    A('(c)', secondA),
    B('(c)', secondB),
  ]) {
    it(`${_label} handed to the constructor directly: the fixed unknown, marker in no rendering`, () => {
      const failure = new AuthProviderFailure(make() as IAuthProviderError);
      assert.deepEqual(shape(failure.error), shape(UNFAMILIAR()));
      for (const text of failureRenderings(failure)) {
        assert.ok(!text.includes(marker));
      }
    });
  }

  it('positive: a same-copy failure carrying diagnostics keeps them through readFailure, the same object', () => {
    const a = authError.snc(sncFacts, { library: JWT_MARKER });
    const b = authError['saml-assertion'](samlFacts, {
      issuer: EXCEPTION_MARKER,
    });
    for (const minted of [a, b]) {
      const failure = new AuthProviderFailure(minted);
      assert.equal(failure.error, minted);
      assert.equal(readFailure(caught(failure), 'establishing'), minted);
      assert.notEqual(renderDiagnostics(minted), undefined);
      assert.ok(!failure.message.includes(JWT_MARKER));
      assert.ok(!failure.message.includes('sk-exception-in-issuer'));
    }
    assert.ok(renderDiagnostics(a)?.includes(JWT_MARKER));
  });
});
