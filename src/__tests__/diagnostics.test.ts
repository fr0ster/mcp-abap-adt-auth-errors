import type {
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt } from './builtPackage';

/**
 * `renderDiagnostics` and `logFields` (spec §5.6, §3.3): one JSON-quoted line
 * per diagnostic field of an error this copy minted; `undefined` for any
 * other; never invoked by `render`; total, and no getter or trap of the
 * input runs.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Fields = {
  error: string;
  kind: string;
  status?: number;
  diagnostics?: string;
};

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const renderDiagnostics = built.renderDiagnostics as (
  error: unknown,
) => string | undefined;
const httpStatus = built.httpStatus as (value: unknown) => number;
const logFields = built.logFields as (error: unknown) => Fields;
const render = built.render as (
  kind: string,
  facts: unknown,
) => { reason: string; hint?: string };

const sncNotFound = (): IAuthProviderError =>
  authError.snc(
    {
      problem: 'library-not-found',
      searched: true,
      candidates: [
        { source: 'SNC_LIB_64', reason: 'missing' },
        { source: 'registry', reason: 'wrong architecture' },
        { source: 'SNC_LIB', reason: 'not a library' },
      ],
    },
    { candidatePaths: ['/opt/sec/lib"x.so', 'C:\\sec\\sapcrypto.dll', 42] },
  );

describe('renderDiagnostics', () => {
  it('renders snc library JSON-quoted', () => {
    const error = authError.snc(
      { problem: 'library-init-failed' },
      { library: 'C:\\sec\\sapcrypto.dll' },
    );
    expect(renderDiagnostics(error)).toBe(
      'library: "C:\\\\sec\\\\sapcrypto.dll"',
    );
  });

  it('renders the candidates with source, path and reason, (no path) for null', () => {
    expect(renderDiagnostics(sncNotFound())).toBe(
      'candidates: SNC_LIB_64 "/opt/sec/lib\\"x.so" (missing); ' +
        'registry "C:\\\\sec\\\\sapcrypto.dll" (wrong architecture); ' +
        'SNC_LIB (no path) (not a library)',
    );
  });

  it('renders a saml field and a config pair, one line each', () => {
    const saml = authError['saml-assertion'](
      { rule: 'untrusted-issuer', check: 'issuer' },
      { issuer: 'https://idp.example/x' },
    );
    expect(renderDiagnostics(saml)).toBe('issuer: "https://idp.example/x"');
    const config = authError.configuration(
      { case: 'redirect-mismatch', fields: [] },
      {
        configuredUri: 'https://a.example/cb',
        strategyUri: 'https://b.example/cb',
      },
    );
    expect(renderDiagnostics(config)).toBe(
      'configuredUri: "https://a.example/cb"\nstrategyUri: "https://b.example/cb"',
    );
  });

  it('is undefined when the error carries none', () => {
    expect(renderDiagnostics(authError.snc({ problem: 'logon-refused' }))).toBe(
      undefined,
    );
    expect(
      renderDiagnostics(authError['not-prepared']({ provider: 'snc' })),
    ).toBe(undefined);
  });

  it('is undefined for a copy that is not minted, diagnostics never read', () => {
    const minted = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/x/lib.so' },
    );
    expect(renderDiagnostics({ ...minted })).toBe(undefined);
    expect(renderDiagnostics(JSON.parse(JSON.stringify(minted)))).toBe(
      undefined,
    );
  });

  it('is total and invokes no getter or trap', () => {
    let touched = 0;
    const hostile = {
      get kind() {
        touched += 1;
        return 'snc';
      },
      get diagnostics() {
        touched += 1;
        return { library: '/x' };
      },
    };
    const proxy = new Proxy(
      {},
      {
        get() {
          touched += 1;
          throw new Error('trap');
        },
        getOwnPropertyDescriptor() {
          touched += 1;
          throw new Error('trap');
        },
      },
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();
    for (const value of [hostile, proxy, revocable.proxy, null, undefined, 3]) {
      expect(renderDiagnostics(value)).toBe(undefined);
    }
    expect(touched).toBe(0);
  });

  it('is never called by render', () => {
    const calls: unknown[] = [];
    const real = built.renderDiagnostics;
    expect(typeof real).toBe('function');
    // render lives in words.ts; diagnostics.ts imports it, never the reverse.
    const spy = jest
      .spyOn(loadBuiltDiagnostics(), 'renderDiagnostics')
      .mockImplementation((...args: unknown[]) => {
        calls.push(args);
        return undefined;
      });
    render('snc', { problem: 'library-init-failed' });
    sncNotFound();
    expect(calls).toHaveLength(0);
    spy.mockRestore();
  });
});

function loadBuiltDiagnostics(): {
  renderDiagnostics: (...args: unknown[]) => string | undefined;
} {
  return require('../../dist/diagnostics.js');
}

describe('logFields', () => {
  it('is { error: reason, kind } with diagnostics as a separate field', () => {
    const error = sncNotFound();
    const fields = logFields(error);
    expect(fields).toStrictEqual({
      error: error.reason,
      kind: 'snc',
      diagnostics: renderDiagnostics(error),
    });
    expect(error.reason).not.toContain('/opt/sec');
  });

  it('carries status only when it is a fact', () => {
    const withStatus = authError['request-failed']({
      operation: 'client-credentials',
      problem: 'refused',
      status: httpStatus(403),
    });
    expect(logFields(withStatus).status).toBe(403);
    const without = authError['request-failed']({
      operation: 'client-credentials',
      problem: 'no-response',
    });
    expect(without.kind).toBe('request-failed');
    expect(logFields(without).kind).toBe('request-failed');
    expect('status' in logFields(without)).toBe(false);
    expect('diagnostics' in logFields(without)).toBe(false);
  });

  it('answers the unfamiliar fields for a non-minted value, status and diagnostics never read', () => {
    const unfamiliar = logFields(
      authError.unknown({ operation: 'unfamiliar-error' }),
    );
    const forged = {
      kind: 'snc',
      reason: 'sk-secret',
      status: 500,
      facts: { problem: 'library-init-failed' },
      diagnostics: { library: '/x' },
    };
    expect(logFields(forged)).toStrictEqual({
      error: unfamiliar.error,
      kind: 'unknown',
    });
    expect(logFields(null)).toStrictEqual(logFields(undefined));
  });

  it('is total and invokes no getter or trap', () => {
    let touched = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          touched += 1;
          throw new Error('trap');
        },
        has() {
          touched += 1;
          throw new Error('trap');
        },
        getOwnPropertyDescriptor() {
          touched += 1;
          throw new Error('trap');
        },
      },
    );
    expect(logFields(hostile).kind).toBe('unknown');
    expect(touched).toBe(0);
  });
});
