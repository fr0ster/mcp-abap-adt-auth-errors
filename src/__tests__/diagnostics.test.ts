import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type {
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt } from './builtPackage';

/**
 * `renderDiagnostics` and `logFields`: one JSON-quoted line
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
    assert.equal(
      renderDiagnostics(error),
      'library: "C:\\\\sec\\\\sapcrypto.dll"',
    );
  });

  it('renders the candidates with source, path and reason, (no path) for null', () => {
    assert.equal(
      renderDiagnostics(sncNotFound()),
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
    assert.equal(renderDiagnostics(saml), 'issuer: "https://idp.example/x"');
    const config = authError.configuration(
      { case: 'redirect-mismatch', fields: [] },
      {
        configuredUri: 'https://a.example/cb',
        strategyUri: 'https://b.example/cb',
      },
    );
    assert.equal(
      renderDiagnostics(config),
      'configuredUri: "https://a.example/cb"\nstrategyUri: "https://b.example/cb"',
    );
  });

  it('is undefined when the error carries none', () => {
    assert.equal(
      renderDiagnostics(authError.snc({ problem: 'logon-refused' })),
      undefined,
    );
    assert.equal(
      renderDiagnostics(authError['not-prepared']({ provider: 'snc' })),
      undefined,
    );
  });

  it('is undefined for a copy that is not minted, diagnostics never read', () => {
    const minted = authError.snc(
      { problem: 'library-init-failed' },
      { library: '/x/lib.so' },
    );
    assert.equal(renderDiagnostics({ ...minted }), undefined);
    assert.equal(
      renderDiagnostics(JSON.parse(JSON.stringify(minted))),
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
      assert.equal(renderDiagnostics(value), undefined);
    }
    assert.equal(touched, 0);
  });

  it('is never called by render', () => {
    const calls: unknown[] = [];
    const real = built.renderDiagnostics;
    assert.equal(typeof real, 'function');
    // render lives in words.ts; diagnostics.ts imports it, never the reverse.
    const spy = mock.method(
      loadBuiltDiagnostics(),
      'renderDiagnostics',
      (...args: unknown[]) => {
        calls.push(args);
        return undefined;
      },
    );
    render('snc', { problem: 'library-init-failed' });
    sncNotFound();
    assert.equal(calls.length, 0);
    spy.mock.restore();
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
    assert.deepEqual(fields, {
      error: error.reason,
      kind: 'snc',
      diagnostics: renderDiagnostics(error),
    });
    assert.ok(!error.reason.includes('/opt/sec'));
  });

  it('carries status only when it is a fact', () => {
    const withStatus = authError['request-failed']({
      operation: 'client-credentials',
      problem: 'refused',
      status: httpStatus(403),
    });
    assert.equal(logFields(withStatus).status, 403);
    const without = authError['request-failed']({
      operation: 'client-credentials',
      problem: 'no-response',
    });
    assert.equal(without.kind, 'request-failed');
    assert.equal(logFields(without).kind, 'request-failed');
    assert.equal('status' in logFields(without), false);
    assert.equal('diagnostics' in logFields(without), false);
  });

  it('classifies a non-minted value first: its reason, status and diagnostics never read', () => {
    const forged = {
      kind: 'snc',
      reason: 'sk-secret',
      status: 500,
      facts: { problem: 'library-init-failed' },
      diagnostics: { library: '/x' },
    };
    assert.deepEqual(logFields(forged), {
      error: authError.snc({ problem: 'library-init-failed' }).reason,
      kind: 'snc',
    });
    assert.deepEqual(
      logFields(null),
      logFields(authError.unknown({ operation: 'unfamiliar-error' })),
    );
    assert.deepEqual(logFields(null), logFields(undefined));
  });

  it('is total and invokes no getter, nor any trap but getOwnPropertyDescriptor', () => {
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
        getPrototypeOf() {
          touched += 1;
          throw new Error('trap');
        },
        getOwnPropertyDescriptor() {
          throw new Error('trap');
        },
      },
    );
    assert.equal(logFields(hostile).kind, 'unknown');
    assert.equal(touched, 0);
    let invoked = 0;
    const getters = Object.defineProperty({}, 'kind', {
      get() {
        invoked += 1;
        return 'snc';
      },
    });
    assert.equal(logFields(getters).kind, 'unknown');
    assert.equal(invoked, 0);
  });
});
