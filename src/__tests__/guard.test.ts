import { execFileSync } from 'node:child_process';
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
  it('a body’s answer of this copy passes: OK as itself, a minted refusal as itself', async () => {
    const refusal = authError['not-prepared']({ provider: 'snc' });
    const answer = { ok: false, refusal };
    const outcome = await guard('establishing', () => answer);
    expect(refusalOf(outcome)).toBe(refusal);
    expect(Object.isFrozen(outcome)).toBe(true);
    await expect(guard('establishing', async () => OK)).resolves.toBe(OK);
    await expect(guard('establishing', () => ({ ok: true }))).resolves.toBe(OK);
  });

  describe('a non-throwing body’s answer is classified', () => {
    let second: SecondCopy;
    beforeAll(() => {
      second = loadSecondCopy();
    });
    afterAll(() => second.remove());

    it('a forged refusal is rebuilt: its reason and diagnostics are dropped', async () => {
      const forged = {
        ok: false,
        refusal: {
          kind: 'client-certificate',
          facts: { problem: 'expired' },
          reason: 'sk-forged-reason',
          diagnostics: { library: 'sk-forged-diagnostics' },
        },
      };
      const refusal = refusalOf(await guard('token-request', () => forged));
      expect(isMinted(refusal)).toBe(true);
      expect(refusal.kind).toBe('client-certificate');
      expect(refusal.diagnostics).toBeUndefined();
      for (const text of renderings(refusal)) {
        expect(text).not.toContain('sk-forged');
      }
    });

    it('a refusal minted by a second copy is rebuilt without diagnostics', async () => {
      const theirs = (
        second.exports.authError as Record<AuthProviderErrorKind, Builder>
      ).snc(
        { problem: 'no-credential', secureLoginClient: false },
        { library: 'sk-second-copy-library' },
      );
      const refusal = refusalOf(
        await guard('authorizing', async () => ({
          ok: false,
          refusal: theirs,
        })),
      );
      expect(refusal).not.toBe(theirs);
      expect(isMinted(refusal)).toBe(true);
      expect(refusal.kind).toBe('snc');
      expect(refusal.diagnostics).toBeUndefined();
      for (const text of renderings(refusal)) {
        expect(text).not.toContain('sk-second-copy');
      }
    });

    it.each([
      ['a string', 'SECRET-STRING'],
      ['an unforgeable refusal', { ok: false, refusal: { reason: 'SECRET' } }],
      ['a getter on ok', Object.defineProperty({}, 'ok', { get: () => true })],
      ['undefined', undefined],
    ])(
      '%s answers the fallback: unknown with the operation and the kept grant',
      async (_label, answer) => {
        const outcome = await guard(
          'token-request',
          () => answer as never,
          () => 'client_credentials',
        );
        const refusal = refusalOf(outcome);
        expect(isMinted(refusal)).toBe(true);
        expect(refusal.kind).toBe('unknown');
        expect(refusal.facts).toStrictEqual({
          operation: 'token-request',
          grant: 'client_credentials',
        });
        expect(JSON.stringify(outcome)).not.toContain('SECRET');
      },
    );

    it('a thenable resolving to a non-outcome answers the fallback', async () => {
      const outcome = await guard('preparing', () =>
        Promise.resolve('SECRET-STRING' as never),
      );
      expect(refusalOf(outcome).facts).toStrictEqual({
        operation: 'preparing',
      });
    });
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

/**
 * Unhandled rejections are observed in a child process: Jest installs its own
 * `unhandledRejection` handling around a test, so a listener inside the test
 * neither sees every event nor can absorb one. The child loads the built
 * package, runs one scenario — the value answered by a logon target to
 * `relayOutcome` and by a grant thunk to `guard` — waits a macrotask, and
 * prints what happened.
 */
interface ChildReport {
  readonly unhandled: number;
  readonly calls: string[];
  readonly threw: boolean;
  readonly relayThrown: boolean;
  readonly relayKind: string;
  readonly relayWire: string;
  readonly guardFacts: unknown;
}

const SCENARIOS = `
const E = require(${JSON.stringify(require.resolve('../../dist/index.js'))});
let unhandled = 0;
process.on('unhandledRejection', () => { unhandled += 1; });
// Recorded only while the package runs: the harness's own awaits read
// \`constructor\` too. Both calls below do all their work synchronously.
let inside = false;
const recorded = [];
const calls = { push: (call) => { if (inside) recorded.push(call); }, set length(n) { recorded.length = n; } };
const scenarios = {
  plain: () => Promise.reject(new Error('sk-plain')),
  async: () => (async () => { throw new Error('sk-async'); })(),
  subclass: () => {
    class Sub extends Promise {
      static get [Symbol.species]() { calls.push('species'); return Promise; }
      constructor(executor) { calls.push('constructor'); super(executor); }
    }
    const sub = Sub.reject(new Error('sk-sub'));
    calls.length = 0;
    return sub;
  },
  speciesThrows: () => {
    class Throwing extends Promise {
      static get [Symbol.species]() { calls.push('species'); throw new Error('sk-species'); }
    }
    return Throwing.reject(new Error('sk-throwing'));
  },
  ownConstructor: () => {
    const p = Promise.reject(new Error('sk-own'));
    Object.defineProperty(p, 'constructor', {
      get() { calls.push('own constructor'); return Promise; },
    });
    return p;
  },
  proxy: () => new Proxy(Promise.reject(new Error('sk-proxy')), new Proxy({}, {
    get(_t, trap) { calls.push('trap ' + String(trap)); return undefined; },
  })),
  patchedConstructor: () => {
    Object.defineProperty(Promise.prototype, 'constructor', {
      configurable: true,
      get() { calls.push('prototype constructor'); return Promise; },
    });
    return Promise.reject(new Error('sk-patched-constructor'));
  },
  patchedSpecies: () => {
    Object.defineProperty(Promise, Symbol.species, {
      configurable: true,
      get() { calls.push('patched species'); return Promise; },
    });
    return Promise.reject(new Error('sk-patched-species'));
  },
};
(async () => {
  const make = scenarios[process.argv[1]];
  let threw = false;
  let relayed, outcome;
  let pending;
  try {
    const value = make();
    inside = true;
    relayed = E.relayOutcome(() => value, 'tls-material', 'establishing');
    pending = E.guard('refresh', () => { throw new Error('sk-x'); }, () => value);
    inside = false;
    outcome = await pending;
  } catch { threw = true; }
  inside = false;
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write(JSON.stringify({
    unhandled, calls: recorded, threw,
    relayThrown: relayed && relayed.thrown,
    relayKind: relayed && relayed.outcome.refusal.kind,
    relayWire: relayed && relayed.outcome.refusal.facts.wire,
    guardFacts: outcome && outcome.refusal.facts,
  }));
})();
`;

function runScenario(name: string): ChildReport {
  const out = execFileSync(process.execPath, ['-e', SCENARIOS, name], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  return JSON.parse(out) as ChildReport;
}

/** What every scenario answers: the fallback, not thrown; guard's grant ignored. */
function expectFallback(report: ChildReport): void {
  expect(report.threw).toBe(false);
  expect(report.relayThrown).toBe(false);
  expect(report.relayKind).toBe('logon-target');
  expect(report.relayWire).toBe('unknown');
  expect(report.guardFacts).toStrictEqual({ operation: 'refresh' });
}

describe('a rejecting plain native promise is never left unhandled', () => {
  it.each([
    ['a target / grant answering Promise.reject', 'plain'],
    ['an async target / grant that throws', 'async'],
  ])('%s: the fallback, no unhandled rejection', (_label, name) => {
    const report = runScenario(name);
    expectFallback(report);
    expect(report.unhandled).toBe(0);
  });

  it('a foreign thenable’s `then` is never called', () => {
    let called = 0;
    const thenable = Object.defineProperty({}, 'then', {
      value: () => {
        called += 1;
      },
    });
    relayOutcome(() => thenable, 'tls-material', 'establishing');
    expect(called).toBe(0);
  });
});

describe('no foreign code runs while a promise is handled (the limit)', () => {
  it('a Promise subclass: neither its species getter nor its constructor runs; its rejection stays unhandled (the limit)', () => {
    const report = runScenario('subclass');
    expectFallback(report);
    expect(report.calls).toStrictEqual([]);
    expect(report.unhandled).toBeGreaterThan(0);
  });

  it('a Promise subclass whose species getter throws: nothing thrown out, never run', () => {
    const report = runScenario('speciesThrows');
    expectFallback(report);
    expect(report.calls).toStrictEqual([]);
    expect(report.unhandled).toBeGreaterThan(0);
  });

  it('a native promise with an own `constructor` getter: the getter never runs', () => {
    const report = runScenario('ownConstructor');
    expectFallback(report);
    expect(report.calls).toStrictEqual([]);
  });

  it('a Proxy around a promise: no trap runs but classifyOutcome’s guarded own-property reads', () => {
    const report = runScenario('proxy');
    expectFallback(report);
    expect(
      report.calls.filter((call) => call !== 'trap getOwnPropertyDescriptor'),
    ).toStrictEqual([]);
  });

  it.each([
    ['Promise.prototype.constructor', 'patchedConstructor'],
    ['Promise[Symbol.species]', 'patchedSpecies'],
  ])('a patched %s: never run', (_label, name) => {
    const report = runScenario(name);
    expectFallback(report);
    expect(report.calls).toStrictEqual([]);
  });
});
