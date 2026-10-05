import { inspect } from 'node:util';
import type {
  AuthOutcome,
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadSecondCopy, type SecondCopy } from './builtPackage';

/**
 * `AuthProviderFailure`, `readFailure`, `isAuthProviderFailure` (spec §6,
 * §11.1 "Carriers from another copy", "Forged diagnostics", "Re-mint across
 * copies", §12's pino item), run against the built package. Completes the
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
  'credential-refused': { credential: 'token', at: 'request' },
  'system-refused': { verdict: 'not-authorized', status: 403, at: 'logon' },
  'renewal-unchanged': { source: 'token-provider' },
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

/** The fixed error an unminted constructor argument becomes (spec §6). */
const UNFAMILIAR = () => authError.unknown({ operation: 'unfamiliar-error' });

/** The message the spec fixes: `reason`, or `reason — hint`. */
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
    expect(typeof built.AuthProviderFailure).toBe('function');
    expect(typeof built.readFailure).toBe('function');
    expect(typeof built.isAuthProviderFailure).toBe('function');
    expect(built.OK).toStrictEqual({ ok: true });
    expect(Object.isFrozen(built.OK)).toBe(true);
  });
});

describe('AuthProviderFailure — the instance', () => {
  it.each(KINDS)('%s: message is reason, or reason — hint', (kind) => {
    const error = sample(kind);
    const failure = new AuthProviderFailure(error);
    expect(failure.message).toBe(messageOf(error));
  });

  it('the message format, with a hint and without one', () => {
    const words = KINDS.map((kind) => sample(kind));
    const withHint = words.find((e) => e.hint !== undefined);
    const withoutHint = words.find((e) => e.hint === undefined);
    if (withHint === undefined || withoutHint === undefined) {
      throw new Error('the samples must hold a kind with and without a hint');
    }
    expect(new AuthProviderFailure(withHint).message).toBe(
      `${withHint.reason} — ${withHint.hint}`,
    );
    expect(new AuthProviderFailure(withoutHint).message).toBe(
      withoutHint.reason,
    );
  });

  it('is an Error named AuthProviderFailure, without a cause', () => {
    const failure = new AuthProviderFailure(sample('tls'));
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toBeInstanceOf(AuthProviderFailure);
    expect(failure.name).toBe('AuthProviderFailure');
    expect(Object.hasOwn(failure, 'name')).toBe(true);
    expect('cause' in failure).toBe(false);
    expect(String(failure)).toBe(
      `AuthProviderFailure: ${messageOf(sample('tls'))}`,
    );
  });

  it('holds the minted error itself, as an own data property', () => {
    const error = sample('snc');
    const failure = new AuthProviderFailure(error);
    expect(failure.error).toBe(error);
    const descriptor = Object.getOwnPropertyDescriptor(failure, 'error');
    expect(descriptor).toBeDefined();
    expect(descriptor && 'value' in descriptor).toBe(true);
    // classify reads `error` only as an own data property: it gets it back.
    expect(classify(failure, 'refresh')).toBe(error);
    expect(readFailure(failure, 'refresh')).toBe(error);
  });

  it('error and message cannot be reassigned, deleted or redefined', () => {
    const error = sample('snc');
    const failure = new AuthProviderFailure(error);
    const message = failure.message;
    for (const key of ['error', 'message'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(failure, key);
      expect(descriptor).toMatchObject({
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
    const writable = failure as unknown as Record<string, unknown>;
    expect(() => {
      writable.error = sample('tls');
    }).toThrow(TypeError);
    expect(() => {
      writable.message = 'sk-assigned';
    }).toThrow(TypeError);
    expect(() => {
      delete writable.error;
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(failure, 'error', { value: sample('tls') }),
    ).toThrow(TypeError);
    expect(failure.error).toBe(error);
    expect(failure.message).toBe(message);
    expect(classify(failure, 'refresh')).toBe(error);
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
    expect(invoked).toBe(0);
    expect(Object.getOwnPropertyDescriptor(failure, 'error')?.value).toBe(
      error,
    );
    expect(failure.error).toBe(error);
    expect(classify(failure, 'refresh')).toBe(error);
  });

  it('stack: its header is the fixed words, nothing of the input', () => {
    const error = sample('tls');
    const failure = new AuthProviderFailure(error);
    expect(failure.stack?.split('\n')[0]).toBe(
      `AuthProviderFailure: ${messageOf(error)}`,
    );
    const forged = new AuthProviderFailure({
      kind: 'tls',
      reason: 'sk-stack-marker',
    } as unknown as IAuthProviderError);
    expect(forged.stack?.split('\n')[0]).toBe(
      `AuthProviderFailure: ${messageOf(UNFAMILIAR())}`,
    );
    expect(forged.stack).not.toContain('sk-stack-marker');
  });

  it('no diagnostics in the message', () => {
    const error = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sk-diag-marker/libsapcrypto.so' },
    );
    expect(renderDiagnostics(error)).toContain('sk-diag-marker');
    const failure = new AuthProviderFailure(error);
    expect(failure.message).not.toContain('sk-diag-marker');
    expect(String(failure)).not.toContain('sk-diag-marker');
  });

  it('JSON.stringify and a pino-style enumerable copy hold only name, message, error (§12, measured)', () => {
    const error = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/opt/sk-pino/libsapcrypto.so' },
    );
    const failure = new AuthProviderFailure(error);
    const json = JSON.parse(JSON.stringify(failure)) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toStrictEqual([
      'error',
      'message',
      'name',
    ]);
    expect(json.name).toBe('AuthProviderFailure');
    expect(json.message).toBe(messageOf(error));
    expect(json.error).toStrictEqual(shape(error));

    // pino's serializer copies the enumerable own properties.
    const copy: Record<string, unknown> = {};
    for (const key in failure) {
      copy[key] = (failure as unknown as Record<string, unknown>)[key];
    }
    expect(Object.keys(copy).sort()).toStrictEqual([
      'error',
      'message',
      'name',
    ]);
    expect(copy.error).toBe(error);
  });
});

describe('AuthProviderFailure — an unminted argument', () => {
  it('RF3: structuredClone of a minted error becomes the fixed unknown, operation unfamiliar-error (documented behaviour; the constructor takes no operation)', () => {
    for (const kind of KINDS) {
      const failure = new AuthProviderFailure(structuredClone(sample(kind)));
      expect(isMinted(failure.error)).toBe(true);
      expect(shape(failure.error)).toStrictEqual(shape(UNFAMILIAR()));
      expect(failure.message).toBe(messageOf(UNFAMILIAR()));
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
      expect(shape(failure.error)).toStrictEqual(shape(UNFAMILIAR()));
      for (const text of failureRenderings(failure)) {
        expect(text).not.toContain('sk-');
      }
    }
  });
});

describe('readFailure', () => {
  it('is classify with the operation', () => {
    const thrown = { status: 503, code: 'ECONNRESET' };
    expect(shape(readFailure(thrown, 'refresh'))).toStrictEqual(
      shape(classify(thrown, 'refresh')),
    );
    expect(shape(readFailure(new Error('sk-x'), 'device-poll'))).toStrictEqual(
      shape(authError.unknown({ operation: 'device-poll' })),
    );
  });

  it('a minted error, bare or in this copy’s failure, is answered as itself', () => {
    const error = sample('connection');
    expect(readFailure(error, 'refresh')).toBe(error);
    expect(readFailure(new AuthProviderFailure(error), 'refresh')).toBe(error);
  });
});

describe('isAuthProviderFailure', () => {
  let second: SecondCopy;
  beforeAll(() => {
    second = loadSecondCopy();
  });
  afterAll(() => second.remove());

  it('true for this copy’s instance', () => {
    expect(isAuthProviderFailure(new AuthProviderFailure(sample('tls')))).toBe(
      true,
    );
  });

  it('true for another copy’s instance (D2), whose instanceof here is false', () => {
    const SecondFailure = second.exports.AuthProviderFailure as FailureClass;
    const secondBuilders = second.exports.authError as Record<
      AuthProviderErrorKind,
      Builder
    >;
    for (const kind of KINDS) {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      expect(theirs).not.toBeInstanceOf(AuthProviderFailure);
      expect(isAuthProviderFailure(theirs)).toBe(true);
    }
  });

  it('true for a structural object: the name and an error that rebuilds', () => {
    expect(
      isAuthProviderFailure({
        name: 'AuthProviderFailure',
        error: shape(sample('snc')),
      }),
    ).toBe(true);
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
    expect(isAuthProviderFailure(forged)).toBe(true);
    const read = readFailure(forged, 'refresh');
    expect(isMinted(read)).toBe(true);
    expect(shape(read)).toStrictEqual(shape(authError.tls(facts)));
    for (const text of errorRenderings(read)) {
      expect(text).not.toContain('sk-forged');
    }
  });

  it('false without the name, with another name, or with an invalid error', () => {
    const error = sample('tls');
    expect(isAuthProviderFailure({ error })).toBe(false);
    expect(isAuthProviderFailure({ name: 'Error', error })).toBe(false);
    expect(
      isAuthProviderFailure({ name: 'AuthProviderFailure', error: {} }),
    ).toBe(false);
    expect(
      isAuthProviderFailure({
        name: 'AuthProviderFailure',
        error: { kind: 'tls', facts: { code: 'EVIL_CODE' } },
      }),
    ).toBe(false);
    expect(
      isAuthProviderFailure({ name: 'AuthProviderFailure', error: 'x' }),
    ).toBe(false);
    expect(isAuthProviderFailure(new Error('AuthProviderFailure'))).toBe(false);
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
      expect(isAuthProviderFailure(value)).toBe(false);
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
    expect(isAuthProviderFailure(withGetters)).toBe(false);
    expect(invoked).toBe(0);

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
    expect(isAuthProviderFailure(watched)).toBe(true);
    expect(asked).not.toContain('message');
    expect(asked).not.toContain('stack');
    expect(asked).not.toContain('cause');
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
  beforeAll(() => {
    second = loadSecondCopy();
    SecondFailure = second.exports.AuthProviderFailure as FailureClass;
    secondBuilders = second.exports.authError as Record<
      AuthProviderErrorKind,
      Builder
    >;
  });
  afterAll(() => second.remove());

  it.each(KINDS)(
    '%s through classify and readFailure: same kind and facts, re-rendered, minted here',
    (kind) => {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      for (const result of [
        classify(theirs, 'refresh'),
        readFailure(theirs, 'refresh'),
      ]) {
        expect(result).not.toBe(theirs.error);
        expect(isMinted(result)).toBe(true);
        expect(shape(result)).toStrictEqual(shape(sample(kind)));
        expect('diagnostics' in result).toBe(false);
      }
    },
  );

  it.each(KINDS)(
    '%s through classifyOutcome, the failure’s error as the refusal: same kind and facts, re-rendered',
    (kind) => {
      const theirs = new SecondFailure(secondBuilders[kind](SAMPLES[kind]));
      const result = classifyRefusal(theirs.error);
      expect(result).not.toBe(theirs.error);
      expect(isMinted(result)).toBe(true);
      expect(shape(result)).toStrictEqual(shape(sample(kind)));
    },
  );
});

describe('forged diagnostics (§11.1 matrix: c carriers, d, and the readFailure boundary)', () => {
  const JWT_MARKER =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzay1qd3QtbWFya2VyIn0.c2stc2lnbmF0dXJl';
  const EXCEPTION_MARKER = 'Error: sk-exception-in-issuer at line 1';
  const sncFacts = { problem: 'no-credential', secureLoginClient: false };
  const samlFacts = { rule: 'untrusted-issuer', check: 'issuer' };

  let second: SecondCopy;
  let SecondFailure: FailureClass;
  beforeAll(() => {
    second = loadSecondCopy();
    SecondFailure = second.exports.AuthProviderFailure as FailureClass;
  });
  afterAll(() => second.remove());

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
    expect(render2(failureA().error)).toContain(JWT_MARKER);
    expect(render2(failureB().error)).toContain('sk-exception-in-issuer');
    expect(inspect(failureA(), { depth: null })).toContain(JWT_MARKER);
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

  it.each(cases())(
    '%s thrown, read with readFailure, wrapped here: kind and facts kept, no diagnostics, marker in no rendering',
    (_label, make, marker, kind, facts) => {
      const result = readFailure(caught(make()), 'establishing');
      expect(isMinted(result)).toBe(true);
      expect(result.kind).toBe(kind);
      expect(result.facts).toStrictEqual(facts);
      expect('diagnostics' in result).toBe(false);
      for (const text of errorRenderings(result)) {
        expect(text).not.toContain(marker);
      }
      const failure = new AuthProviderFailure(result);
      expect(failure.error).toBe(result);
      for (const text of failureRenderings(failure)) {
        expect(text).not.toContain(marker);
      }
    },
  );

  it.each(cases().filter(([label]) => label.startsWith('(d)')))(
    '%s through classify and classifyOutcome (the failure’s error as the refusal): no diagnostics, marker in no rendering',
    (_label, make, marker, kind, facts) => {
      const theirs = make() as Failure;
      for (const result of [
        classify(theirs, 'establishing'),
        classifyRefusal(theirs.error),
      ]) {
        expect(result.kind).toBe(kind);
        expect(result.facts).toStrictEqual(facts);
        expect('diagnostics' in result).toBe(false);
        for (const text of errorRenderings(result)) {
          expect(text).not.toContain(marker);
        }
      }
    },
  );

  it.each([
    A('(a)', forgedA),
    B('(b)', forgedB),
    A('(c)', secondA),
    B('(c)', secondB),
  ])(
    '%s handed to the constructor directly: the fixed unknown, marker in no rendering',
    (_label, make, marker) => {
      const failure = new AuthProviderFailure(make() as IAuthProviderError);
      expect(shape(failure.error)).toStrictEqual(shape(UNFAMILIAR()));
      for (const text of failureRenderings(failure)) {
        expect(text).not.toContain(marker);
      }
    },
  );

  it('positive: a same-copy failure carrying diagnostics keeps them through readFailure, the same object', () => {
    const a = authError.snc(sncFacts, { library: JWT_MARKER });
    const b = authError['saml-assertion'](samlFacts, {
      issuer: EXCEPTION_MARKER,
    });
    for (const minted of [a, b]) {
      const failure = new AuthProviderFailure(minted);
      expect(failure.error).toBe(minted);
      expect(readFailure(caught(failure), 'establishing')).toBe(minted);
      expect(renderDiagnostics(minted)).toBeDefined();
      expect(failure.message).not.toContain(JWT_MARKER);
      expect(failure.message).not.toContain('sk-exception-in-issuer');
    }
    expect(renderDiagnostics(a)).toContain(JWT_MARKER);
  });
});
