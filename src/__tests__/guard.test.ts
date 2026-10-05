import { inspect } from 'node:util';
import type {
  AuthOutcome,
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt, loadSecondCopy, type SecondCopy } from './builtPackage';

/**
 * `guard` and `relayOutcome` (spec §7, §8.1, §11.1 "Forged diagnostics" —
 * the `relayOutcome` boundary), run against the built package.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Failure = Error & { readonly error: IAuthProviderError };
type FailureClass = new (error: IAuthProviderError) => Failure;
type Guard = (
  operation: string,
  body: () => unknown,
  grant?: () => unknown,
) => Promise<AuthOutcome>;
type Relayed = { readonly outcome: AuthOutcome; readonly thrown: boolean };
type RelayOutcome = (
  call: () => unknown,
  refused: string,
  operation: string,
) => Relayed;

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const guard = built.guard as Guard;
const relayOutcome = built.relayOutcome as RelayOutcome;
const AuthProviderFailure = built.AuthProviderFailure as FailureClass;
const isMinted = built.isMinted as (value: unknown) => boolean;
const renderDiagnostics = built.renderDiagnostics as (
  error: unknown,
) => string | undefined;
const logFields = built.logFields as (error: unknown) => unknown;
const render = built.render as (
  kind: string,
  facts: unknown,
) => { reason: string; hint?: string };
const OK = built.OK;

/** The plain data of an error. */
const shape = (error: unknown): unknown => JSON.parse(JSON.stringify(error));

/** The refusal of an outcome that must be Oops. */
function refusalOf(outcome: AuthOutcome): IAuthProviderError {
  if (outcome.ok) throw new Error('expected a refusal');
  return outcome.refusal;
}

/** Every rendering of a refusal a consumer might print or log. */
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

const trapAll = (): ProxyHandler<object> => {
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

/** Values a body or a target may throw (or answer) that read hostile. */
function hostileValues(): [string, unknown][] {
  const revoked = Proxy.revocable({ status: 401 }, {});
  revoked.revoke();
  return [
    ['undefined', undefined],
    ['null', null],
    ['a string with a secret', 'sk-thrown-string'],
    ['a symbol', Symbol('sk-symbol')],
    ['a function', () => 'sk-function'],
    ['a Proxy whose every trap throws', new Proxy({}, trapAll())],
    ['a revoked Proxy', revoked.proxy],
    [
      'an object whose getters throw',
      Object.defineProperties(
        {},
        {
          error: {
            get() {
              throw new Error('sk-getter');
            },
          },
          status: {
            get() {
              throw new Error('sk-getter');
            },
          },
        },
      ),
    ],
    ['an Error with a secret message', new Error('sk-error-message')],
  ];
}

describe('guard', () => {
  it('answers the body’s outcome when it does not throw', async () => {
    const refusal = authError['not-prepared']({ provider: 'snc' });
    const answer = { ok: false, refusal };
    await expect(guard('establishing', () => answer)).resolves.toBe(answer);
    await expect(guard('establishing', async () => OK)).resolves.toBe(OK);
  });

  it.each(hostileValues())(
    'a body throwing %s answers Oops with the operation, never rejects',
    async (_label, value) => {
      const outcome = await guard('authorizing', () => {
        throw value;
      });
      const refusal = refusalOf(outcome);
      expect(isMinted(refusal)).toBe(true);
      expect(refusal.kind).toBe('unknown');
      expect(refusal.facts).toStrictEqual({ operation: 'authorizing' });
    },
  );

  it.each(hostileValues())(
    'an async body rejecting with %s answers Oops, never rejects',
    async (_label, value) => {
      const outcome = await guard('authorizing', async () => {
        throw value;
      });
      expect(refusalOf(outcome).facts).toStrictEqual({
        operation: 'authorizing',
      });
    },
  );

  it('a body answering a thenable whose `then` getter throws answers Oops', async () => {
    const thenable = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('sk-then');
      },
    });
    const outcome = await guard('preparing', () => thenable);
    expect(refusalOf(outcome).facts).toStrictEqual({ operation: 'preparing' });
  });

  it('a body throwing this copy’s minted error answers it as it is', async () => {
    const minted = authError['client-certificate']({ problem: 'expired' });
    const outcome = await guard('establishing', () => {
      throw new AuthProviderFailure(minted);
    });
    expect(refusalOf(outcome)).toBe(minted);
  });

  it('a valid grant is the refusal’s grant', async () => {
    const outcome = await guard(
      'refresh',
      () => {
        throw new Error('sk-x');
      },
      () => 'client_credentials',
    );
    expect(refusalOf(outcome).facts).toStrictEqual({
      operation: 'refresh',
      grant: 'client_credentials',
    });
  });

  it.each([
    ['a value off the list', 'sk-not-a-grant'],
    ['a number', 7],
    ['an object', { grant: 'password' }],
  ])('a grant thunk answering %s is ignored', async (_label, value) => {
    const outcome = await guard(
      'refresh',
      () => {
        throw new Error('sk-x');
      },
      () => value,
    );
    expect(refusalOf(outcome).facts).toStrictEqual({ operation: 'refresh' });
  });

  it('a grant thunk that throws answers Oops with the operation and no grant; the body never runs', async () => {
    let ran = false;
    const outcome = await guard(
      'establishing',
      () => {
        ran = true;
        return OK;
      },
      () => {
        throw new Error('sk-grant');
      },
    );
    expect(ran).toBe(false);
    const refusal = refusalOf(outcome);
    expect(isMinted(refusal)).toBe(true);
    expect(refusal.facts).toStrictEqual({ operation: 'establishing' });
    for (const text of renderings(refusal)) {
      expect(text).not.toContain('sk-grant');
    }
  });

  it('the catch reads only its two locals: a body that mutates the provider still yields the operation given', async () => {
    const provider = {
      operation: 'authorizing',
      grant: 'password' as unknown,
    };
    const outcome = await guard(
      provider.operation,
      () => {
        provider.operation = 'refresh';
        provider.grant = Object.defineProperty({}, 'x', {
          get() {
            throw new Error('sk-late');
          },
        });
        throw new Error('sk-body');
      },
      () => provider.grant,
    );
    expect(refusalOf(outcome).facts).toStrictEqual({
      operation: 'authorizing',
      grant: 'password',
    });
  });
});

describe('relayOutcome', () => {
  let second: SecondCopy;
  beforeAll(() => {
    second = loadSecondCopy();
  });
  afterAll(() => second.remove());
  const secondBuilders = () =>
    second.exports.authError as Record<AuthProviderErrorKind, Builder>;

  const fallbackShape = (refused: string) =>
    shape(authError['logon-target']({ wire: 'unknown', refused }));

  it('a target answering Ok answers the frozen OK, thrown false', () => {
    const relayed = relayOutcome(
      () => ({ ok: true }),
      'tls-material',
      'establishing',
    );
    expect(relayed.outcome).toBe(OK);
    expect(relayed.thrown).toBe(false);
  });

  it('a same-copy minted refusal, returned: the same object, thrown false', () => {
    const refusal = authError['logon-target']({
      wire: 'rfc',
      refused: 'tls-material',
    });
    const answer = { ok: false, refusal };
    const relayed = relayOutcome(() => answer, 'tls-material', 'establishing');
    expect(relayed.thrown).toBe(false);
    expect(relayed.outcome).not.toBe(answer);
    expect(refusalOf(relayed.outcome)).toBe(refusal);
  });

  it('a foreign-copy refusal, returned: rebuilt without diagnostics, minted here', () => {
    const theirs = secondBuilders().snc(
      { problem: 'no-credential', secureLoginClient: false },
      { library: '/opt/sap/libsapcrypto.so' },
    );
    const answer = { ok: false, refusal: theirs };
    const relayed = relayOutcome(
      () => answer,
      'logon-parameters',
      'establishing',
    );
    expect(relayed.thrown).toBe(false);
    expect(relayed.outcome).not.toBe(answer);
    const refusal = refusalOf(relayed.outcome);
    expect(refusal).not.toBe(theirs);
    expect(isMinted(refusal)).toBe(true);
    expect(refusal.kind).toBe('snc');
    expect(refusal.facts).toStrictEqual(theirs.facts);
    expect('diagnostics' in refusal).toBe(false);
  });

  it.each([
    ...hostileValues(),
    ['{ ok: false } without a refusal', { ok: false }],
    ['{ ok: false, refusal: free text }', { ok: false, refusal: 'sk-text' }],
    ['{ ok: "yes" }', { ok: 'yes' }],
    [
      '{ ok: false, refusal: an unknown kind }',
      { ok: false, refusal: { kind: 'sk-kind', facts: {} } },
    ],
    ['a Promise', Promise.resolve({ ok: true })],
  ])(
    'a target returning %s: the logon-target fallback, wire unknown, thrown false',
    (_label, value) => {
      for (const refused of ['tls-material', 'logon-parameters']) {
        const relayed = relayOutcome(() => value, refused, 'establishing');
        expect(relayed.thrown).toBe(false);
        const refusal = refusalOf(relayed.outcome);
        expect(isMinted(refusal)).toBe(true);
        expect(shape(refusal)).toStrictEqual(fallbackShape(refused));
      }
    },
  );

  it.each(hostileValues())(
    'a target throwing %s: classified with the operation, thrown true',
    (_label, value) => {
      const relayed = relayOutcome(
        () => {
          throw value;
        },
        'tls-material',
        'establishing',
      );
      expect(relayed.thrown).toBe(true);
      const refusal = refusalOf(relayed.outcome);
      expect(isMinted(refusal)).toBe(true);
      expect(refusal.kind).toBe('unknown');
      expect(refusal.facts).toStrictEqual({ operation: 'establishing' });
    },
  );

  it('the same minted refusal returned and thrown: the same error, the disposition differs', () => {
    const refusal = authError['logon-target']({
      wire: 'http',
      refused: 'logon-parameters',
    });
    const returned = relayOutcome(
      () => ({ ok: false, refusal }),
      'logon-parameters',
      'establishing',
    );
    const thrown = relayOutcome(
      () => {
        throw new AuthProviderFailure(refusal);
      },
      'logon-parameters',
      'establishing',
    );
    expect(refusalOf(returned.outcome)).toBe(refusal);
    expect(refusalOf(thrown.outcome)).toBe(refusal);
    expect(returned.thrown).toBe(false);
    expect(thrown.thrown).toBe(true);
  });

  it('an invalid `refused` from a caller past the types: a minted fallback, never a throw', () => {
    const relayed = relayOutcome(() => 'garbage', 'sk-refused', 'establishing');
    expect(relayed.thrown).toBe(false);
    expect(isMinted(refusalOf(relayed.outcome))).toBe(true);
  });

  describe('forged diagnostics (§11.1 matrix, the relayOutcome boundary)', () => {
    const JWT_MARKER =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzay1qd3QtbWFya2VyIn0.c2stc2lnbmF0dXJl';
    const EXCEPTION_MARKER = 'Error: sk-exception-in-issuer at line 1';
    const sncFacts = { problem: 'no-credential', secureLoginClient: false };
    const samlFacts = { rule: 'untrusted-issuer', check: 'issuer' };

    /** (a) and (b): structurally valid, not minted, forged diagnostics. */
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
    /** (c): minted by the second copy. */
    const secondA = () =>
      secondBuilders().snc(sncFacts, { library: JWT_MARKER });
    const secondB = () =>
      secondBuilders()['saml-assertion'](samlFacts, {
        issuer: EXCEPTION_MARKER,
      });
    /** (d): (c) inside the second copy's AuthProviderFailure. */
    const SecondFailure = () =>
      second.exports.AuthProviderFailure as FailureClass;
    const failureA = () => new (SecondFailure())(secondA());
    const failureB = () => new (SecondFailure())(secondB());

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
    /** The refusals: an error itself, (a)–(c). */
    const errors = (): Case[] => [
      A('(a) snc not minted', forgedA),
      B('(b) saml not minted', forgedB),
      A('(c) snc second copy, bare', secondA),
      B('(c) saml second copy, bare', secondB),
    ];
    /** The carriers: (c) carried, (d), (e). */
    const carriers = (): Case[] => [
      A('(c) snc second copy, in a plain carrier', () => ({
        error: secondA(),
      })),
      B('(c) saml second copy, in a plain carrier', () => ({
        error: secondB(),
      })),
      A('(d) snc in the second copy’s AuthProviderFailure', failureA),
      B('(d) saml in the second copy’s AuthProviderFailure', failureB),
      A('(e) snc in a plain carrier', () => ({ error: forgedA() })),
      B('(e) saml in a plain carrier', () => ({ error: forgedB() })),
    ];

    function expectClean(refusal: IAuthProviderError, marker: string): void {
      expect(isMinted(refusal)).toBe(true);
      expect('diagnostics' in refusal).toBe(false);
      for (const text of renderings(refusal)) {
        expect(text).not.toContain(marker);
      }
    }

    it('the second copy did admit both diagnostics (the case is real)', () => {
      const render2 = second.exports.renderDiagnostics as (
        e: unknown,
      ) => string | undefined;
      expect(render2(secondA())).toContain(JWT_MARKER);
      expect(render2(failureB().error)).toContain('sk-exception-in-issuer');
    });

    it.each(errors())(
      '%s returned as the refusal: kind and facts kept, no diagnostics, marker in no rendering, thrown false',
      (_label, make, marker, kind, facts) => {
        const value = make();
        const relayed = relayOutcome(
          () => ({ ok: false, refusal: value }),
          'tls-material',
          'establishing',
        );
        expect(relayed.thrown).toBe(false);
        const refusal = refusalOf(relayed.outcome);
        expect(refusal).not.toBe(value);
        expect(refusal.kind).toBe(kind);
        expect(refusal.facts).toStrictEqual(facts);
        expectClean(refusal, marker);
      },
    );

    it.each(carriers())(
      '%s returned as the refusal: a carrier is no refusal — the fallback, marker in no rendering, thrown false',
      (_label, make, marker) => {
        const relayed = relayOutcome(
          () => ({ ok: false, refusal: make() }),
          'tls-material',
          'establishing',
        );
        expect(relayed.thrown).toBe(false);
        const refusal = refusalOf(relayed.outcome);
        expect(shape(refusal)).toStrictEqual(fallbackShape('tls-material'));
        expectClean(refusal, marker);
      },
    );

    it.each([...errors(), ...carriers()])(
      '%s thrown: kind and facts kept, no diagnostics, marker in no rendering, thrown true',
      (_label, make, marker, kind, facts) => {
        const value = make();
        const relayed = relayOutcome(
          () => {
            throw value;
          },
          'tls-material',
          'establishing',
        );
        expect(relayed.thrown).toBe(true);
        const refusal = refusalOf(relayed.outcome);
        expect(refusal).not.toBe(value);
        expect(refusal.kind).toBe(kind);
        expect(refusal.facts).toStrictEqual(facts);
        expectClean(refusal, marker);
      },
    );

    it('positive: same-copy minted errors with diagnostics, returned, are the same object; thrown in this copy’s failure, too', () => {
      const a = authError.snc(sncFacts, { library: JWT_MARKER });
      const b = authError['saml-assertion'](samlFacts, {
        issuer: EXCEPTION_MARKER,
      });
      for (const minted of [a, b]) {
        expect(renderDiagnostics(minted)).toBeDefined();
        const returned = relayOutcome(
          () => ({ ok: false, refusal: minted }),
          'tls-material',
          'establishing',
        );
        expect(returned.thrown).toBe(false);
        expect(refusalOf(returned.outcome)).toBe(minted);
        const thrown = relayOutcome(
          () => {
            throw new AuthProviderFailure(minted);
          },
          'tls-material',
          'establishing',
        );
        expect(thrown.thrown).toBe(true);
        expect(refusalOf(thrown.outcome)).toBe(minted);
      }
      expect(renderDiagnostics(a)).toContain(JWT_MARKER);
    });
  });
});

describe('a rejecting native promise is never left unhandled', () => {
  /** Runs `act`, waits a macrotask, answers the unhandled rejections seen. */
  async function unhandledDuring(act: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const listener = (reason: unknown) => {
      seen.push(reason);
    };
    process.on('unhandledRejection', listener);
    try {
      await act();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', listener);
    }
    return seen;
  }

  it('relayOutcome: a target answering a rejecting promise gets the fallback, thrown false, no unhandled rejection', async () => {
    let relayed: Relayed | undefined;
    const seen = await unhandledDuring(async () => {
      relayed = relayOutcome(
        () => Promise.reject(new Error('sk-async-target')),
        'tls-material',
        'establishing',
      );
    });
    expect(seen).toStrictEqual([]);
    expect(relayed?.thrown).toBe(false);
    expect(
      shape(refusalOf(relayed?.outcome ?? (OK as AuthOutcome))),
    ).toStrictEqual(
      shape(
        authError['logon-target']({ wire: 'unknown', refused: 'tls-material' }),
      ),
    );
  });

  it('relayOutcome: an async target that throws, likewise', async () => {
    const seen = await unhandledDuring(async () => {
      relayOutcome(
        async () => {
          throw new Error('sk-async-target');
        },
        'logon-parameters',
        'establishing',
      );
    });
    expect(seen).toStrictEqual([]);
  });

  it('relayOutcome: a foreign thenable’s `then` is never called', () => {
    let called = 0;
    const thenable = Object.defineProperty({}, 'then', {
      value: () => {
        called += 1;
      },
    });
    relayOutcome(() => thenable, 'tls-material', 'establishing');
    expect(called).toBe(0);
  });

  it('guard: a grant thunk answering a rejecting promise is ignored, no unhandled rejection', async () => {
    let outcome: AuthOutcome | undefined;
    const seen = await unhandledDuring(async () => {
      outcome = await guard(
        'refresh',
        () => {
          throw new Error('sk-x');
        },
        () => Promise.reject(new Error('sk-async-grant')),
      );
    });
    expect(seen).toStrictEqual([]);
    expect(refusalOf(outcome ?? (OK as AuthOutcome)).facts).toStrictEqual({
      operation: 'refresh',
    });
  });
});
