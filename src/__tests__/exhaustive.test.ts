import type {
  AuthProviderErrorKind,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';
import type { matchKind as MatchKind } from '../exhaustive';
import { loadBuilt, loadSecondCopy, type SecondCopy } from './builtPackage';

/**
 * `matchKind` and `unreachableKind` (spec §9, version skew), run against the
 * built package.
 */
type Builder = (facts: unknown, diagnostics?: unknown) => IAuthProviderError;
type Handlers = Parameters<typeof MatchKind<string>>[1];

const built = loadBuilt();
const authError = built.authError as Record<AuthProviderErrorKind, Builder>;
const matchKind = built.matchKind as typeof MatchKind<string>;
const unreachableKind = built.unreachableKind as (
  error: never,
) => IAuthProviderError;
const isMinted = built.isMinted as (value: unknown) => boolean;

/** Shaped as a minted error from a newer contract. */
const FUTURE_KIND = {
  kind: 'future-kind',
  facts: { horizon: 'sk-future' },
  reason: 'sk-future-reason',
};
const TLS_UNKNOWN_CODE = {
  kind: 'tls',
  facts: { operation: 'token-request', code: 'ERR_FUTURE_TLS' },
  reason: 'sk-tls-reason',
};
const SNC_UNKNOWN_PROBLEM = {
  kind: 'snc',
  variant: 'future-problem',
  facts: { problem: 'future-problem' },
  reason: 'sk-snc-reason',
};
const SKEWED: [string, object][] = [
  ['future-kind', FUTURE_KIND],
  ['tls with an unknown code', TLS_UNKNOWN_CODE],
  ['snc with an unknown problem', SNC_UNKNOWN_PROBLEM],
];

/** Handlers reading their required facts; each records what it received. */
function recordingHandlers(seen: IAuthProviderError[]): Handlers {
  const note =
    (read: (e: IAuthProviderError) => string) => (e: IAuthProviderError) => {
      seen.push(e);
      return read(e);
    };
  const kindOnly = note((e) => e.kind);
  return {
    configuration: kindOnly,
    'client-certificate': kindOnly,
    'client-authentication': kindOnly,
    'request-failed': kindOnly,
    tls: (e) => {
      seen.push(e);
      return `tls:${e.facts.code.length}`;
    },
    'interactive-login': kindOnly,
    'saml-assertion': kindOnly,
    snc: (e) => {
      seen.push(e);
      return `snc:${e.facts.problem.length}`;
    },
    'credential-refused': kindOnly,
    'system-refused': kindOnly,
    'renewal-unchanged': kindOnly,
    'token-binding': kindOnly,
    'not-prepared': kindOnly,
    'logon-target': kindOnly,
    connection: kindOnly,
    unknown: (e) => {
      seen.push(e);
      return `unknown:${e.facts.operation.length}:${e.facts.operation}`;
    },
  };
}

describe('matchKind — version skew (§9)', () => {
  it.each(SKEWED)(
    '%s: no handler throws, the unknown handler receives operation unfamiliar-error',
    (_label, value) => {
      const seen: IAuthProviderError[] = [];
      const answer = matchKind(
        value as IAuthProviderError,
        recordingHandlers(seen),
      );
      expect(answer).toBe(`unknown:16:unfamiliar-error`);
      expect(seen).toHaveLength(1);
      const [received] = seen;
      expect(isMinted(received)).toBe(true);
      expect(received?.kind).toBe('unknown');
      expect(received?.facts).toStrictEqual({ operation: 'unfamiliar-error' });
    },
  );

  describe('a valid foreign tls error reaches the tls handler', () => {
    let second: SecondCopy;
    beforeAll(() => {
      second = loadSecondCopy();
    });
    afterAll(() => second.remove());

    it.each([
      [
        'minted by a second copy',
        () =>
          (
            second.exports.authError as Record<AuthProviderErrorKind, Builder>
          ).tls({ operation: 'token-request', code: 'CERT_HAS_EXPIRED' }),
      ],
      [
        'a plain object',
        () => ({
          kind: 'tls',
          facts: { operation: 'token-request', code: 'CERT_HAS_EXPIRED' },
          reason: 'sk-tls',
        }),
      ],
    ])('%s: rebuilt, minted here, handed to tls', (_label, make) => {
      const value = make();
      const seen: IAuthProviderError[] = [];
      const answer = matchKind(
        value as IAuthProviderError,
        recordingHandlers(seen),
      );
      expect(answer).toBe(`tls:${'CERT_HAS_EXPIRED'.length}`);
      const [received] = seen;
      expect(received).not.toBe(value);
      expect(isMinted(received)).toBe(true);
      expect(received?.facts).toStrictEqual({
        operation: 'token-request',
        code: 'CERT_HAS_EXPIRED',
      });
      expect(received?.reason).not.toContain('sk-');
    });
  });

  it('an error this copy minted is dispatched as it is, diagnostics included', () => {
    const minted = authError.snc(
      { problem: 'no-credential', secureLoginClient: false },
      { library: '/opt/sap/libsapcrypto.so' },
    );
    const seen: IAuthProviderError[] = [];
    matchKind(minted, recordingHandlers(seen));
    expect(seen[0]).toBe(minted);
  });

  it('every kind reaches its own handler', () => {
    const minted = authError['not-prepared']({ provider: 'snc' });
    const seen: IAuthProviderError[] = [];
    expect(matchKind(minted, recordingHandlers(seen))).toBe('not-prepared');
  });
});

describe('unreachableKind — version skew (§9)', () => {
  /** A switch over every kind, the default handing the rest to unreachableKind. */
  function describeError(e: IAuthProviderError): string {
    switch (e.kind) {
      case 'configuration':
      case 'client-certificate':
      case 'client-authentication':
      case 'request-failed':
      case 'interactive-login':
      case 'saml-assertion':
      case 'credential-refused':
      case 'system-refused':
      case 'renewal-unchanged':
      case 'token-binding':
      case 'not-prepared':
      case 'logon-target':
      case 'connection':
        return e.kind;
      case 'tls':
        return `tls:${e.facts.code.length}`;
      case 'snc':
        return `snc:${e.facts.problem.length}`;
      case 'unknown':
        return `unknown:${e.facts.operation}`;
      default: {
        const normal = unreachableKind(e as never);
        if (normal.kind !== 'unknown') return `default:${normal.kind}`;
        return `default:${normal.facts.operation.length}:${normal.facts.operation}`;
      }
    }
  }

  it('future-kind falls to default; the result names unfamiliar-error', () => {
    expect(describeError(FUTURE_KIND as unknown as IAuthProviderError)).toBe(
      'default:16:unfamiliar-error',
    );
  });

  it.each([
    ['tls with an unknown code', TLS_UNKNOWN_CODE, 'tls:14'],
    ['snc with an unknown problem', SNC_UNKNOWN_PROBLEM, 'snc:14'],
  ])('%s reaches its case without throwing', (_label, value, expected) => {
    expect(describeError(value as IAuthProviderError)).toBe(expected);
  });

  it.each(SKEWED)(
    '%s through unreachableKind: a minted unknown with operation unfamiliar-error',
    (_label, value) => {
      const normal = unreachableKind(value as never);
      expect(isMinted(normal)).toBe(true);
      expect(normal.kind).toBe('unknown');
      expect(normal.facts).toStrictEqual({ operation: 'unfamiliar-error' });
    },
  );

  it.each([
    ['undefined', undefined],
    [
      'a Proxy whose get throws',
      new Proxy(
        {},
        {
          get: () => {
            throw new Error('sk-trap');
          },
        },
      ),
    ],
  ])('%s through unreachableKind: never throws', (_label, value) => {
    expect(unreachableKind(value as never).facts).toStrictEqual({
      operation: 'unfamiliar-error',
    });
  });
});
