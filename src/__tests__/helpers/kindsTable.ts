import type { GeneratedRegion } from '../../tables';
import { contract, markdownCell } from '../../tables';
import { loadBuilt, loadBuiltModule } from '../builtPackage';

/**
 * The README's kinds table: every kind, every discriminant value and a few
 * optional facts, built through the built package's own builders, so each
 * row's `reason` and `hint` are the words `words.ts` renders, never a copy.
 */
type Facts = Record<string, unknown>;
type Builder = (facts: Facts) => {
  readonly kind: string;
  readonly facts: unknown;
  readonly reason: string;
  readonly hint?: string | undefined;
};

export const KINDS_OPEN =
  '<!-- BEGIN GENERATED: kinds table (npm run docs:kinds) — do not edit by hand -->';
export const KINDS_CLOSE = '<!-- END GENERATED: kinds table -->';

const built = loadBuilt();
const { ASSERTION_RULE_CHECK } = loadBuiltModule('words') as {
  ASSERTION_RULE_CHECK: Record<string, string>;
};
const authError = built.authError as Record<string, Builder | undefined>;
const httpStatus = built.httpStatus as (n: number) => unknown;
const count = built.count as (n: number) => unknown;
const port = built.port as (n: number) => unknown;

/** Facts per discriminant value, then the samples of optional facts. */
/** Facts per discriminant value, then the samples of optional facts. */
function defaultSamples(kind: string): Facts[] {
  switch (kind) {
    case 'configuration':
      return [
        ...contract.CONFIG_CASES.map(
          (c): Facts => ({
            case: c,
            fields:
              c === 'required-fields-missing'
                ? ['clientId']
                : c === 'invalid-value'
                  ? ['authorizationUrl']
                  : [],
          }),
        ),
        {
          case: 'required-fields-missing',
          fields: ['clientId', 'clientSecret', 'uaaUrl'],
        },
      ];
    case 'client-certificate':
      return contract.CLIENT_CERTIFICATE_PROBLEMS.map(
        (problem): Facts => ({
          problem,
        }),
      );
    case 'client-authentication':
      return contract.CLIENT_AUTHENTICATION_PROBLEMS.map(
        (problem): Facts => ({
          problem,
        }),
      );
    case 'request-failed':
      return [
        ...contract.REQUEST_PROBLEMS.map(
          (problem): Facts => ({
            operation: 'token-refresh',
            problem,
          }),
        ),
        {
          operation: 'token-request',
          grant: 'client_credentials',
          problem: 'refused',
          status: httpStatus(401),
          oauthError: 'invalid_client',
        },
        {
          operation: 'oidc-discovery',
          problem: 'no-response',
          code: 'ECONNREFUSED',
        },
      ];
    case 'tls':
      return [
        ...contract.TLS_FAILURE_CODES.map(
          (code): Facts => ({
            operation: 'oidc-discovery',
            code,
          }),
        ),
        {
          operation: 'token-request',
          grant: 'client_credentials',
          code: 'CERT_HAS_EXPIRED',
        },
      ];
    case 'interactive-login':
      return [
        ...contract.INTERACTIVE_OUTCOMES.map(
          (outcome): Facts =>
            outcome === 'port-in-use'
              ? { outcome, port: port(61001) }
              : outcome === 'disposed'
                ? { outcome, strategy: 'browser' }
                : { outcome },
        ),
        { outcome: 'aborted', strategy: 'browser', ignoredCallbacks: count(2) },
        { outcome: 'aborted', strategy: 'manual' },
        { outcome: 'disposed', strategy: 'manual' },
        { outcome: 'identity-provider-refused', oauthError: 'access_denied' },
        {
          outcome: 'failed',
          status: httpStatus(400),
          oauthError: 'invalid_grant',
        },
      ];
    case 'saml-assertion':
      return [
        ...contract.ASSERTION_RULES.map((rule) => ({
          rule,
          check: ASSERTION_RULE_CHECK[rule],
        })),
        { rule: 'several-assertions', check: 'document', count: count(3) },
        {
          rule: 'declined',
          check: 'status',
          statusCode: 'urn:oasis:names:tc:SAML:2.0:status:Requester',
        },
        {
          rule: 'no-bearer-qualifies',
          check: 'bearerConfirmation',
          candidates: [
            { reason: 'recipient-not-acs' },
            { reason: 'several-confirmation-data', count: count(2) },
          ],
        },
      ];
    case 'snc':
      return [
        ...contract.SNC_PROBLEMS.map((problem): Facts => ({ problem })),
        {
          problem: 'no-credential',
          secureLoginClient: true,
          libraryArchs: ['x64'],
        },
        { problem: 'logon-refused', rfcKey: 'RFC_LOGON_FAILURE' },
        {
          problem: 'library-not-found',
          searched: true,
          processArch: 'x64',
          candidates: [
            { source: 'SNC_LIB_64', reason: 'missing' },
            {
              source: 'sncLib',
              reason: 'wrong architecture',
              archs: ['arm64'],
            },
          ],
        },
      ];
    case 'credential-refused':
      return [
        ...contract.CREDENTIAL_KINDS.map((credential) => ({ credential })),
        { credential: 'user-password', at: 'logon' },
      ];
    case 'system-refused':
      return contract.SYSTEM_REFUSED_VERDICTS.flatMap((verdict): Facts[] =>
        verdict === 'rfc-failure'
          ? [{ verdict, rfcKey: 'RFC_COMMUNICATION_FAILURE', at: 'logon' }]
          : verdict === 'unknown'
            ? [
                { verdict, at: 'request' },
                { verdict, at: 'logon' },
              ]
            : [
                {
                  verdict,
                  status: httpStatus(statusFor(verdict)),
                  at: 'request',
                },
              ],
      );
    case 'renewal-unchanged':
      return contract.RENEWAL_UNCHANGED_SOURCES.map((source) => ({ source }));
    case 'renewal-declined':
      return contract.RENEWAL_TRIGGERS.map((trigger) => ({ trigger }));
    case 'token-binding':
      return contract.TOKEN_BINDING_PROBLEMS.map(
        (problem): Facts => ({ problem }),
      );
    case 'not-prepared':
      return contract.NOT_PREPARED_PROVIDERS.map((provider) => ({ provider }));
    case 'logon-target':
      return contract.LOGON_TARGET_WIRES.flatMap((wire) =>
        contract.LOGON_TARGET_REFUSALS.map((refused) => ({ wire, refused })),
      );
    case 'connection':
      return [
        ...contract.CONNECTION_PROBLEMS.map((problem): Facts => ({ problem })),
        { problem: 'provider-threw', at: 'logon' },
      ];
    case 'unknown':
      return [
        ...contract.OPERATIONS.map((operation) => ({ operation })),
        {
          operation: 'token-request',
          grant: 'password',
          status: httpStatus(500),
        },
        { operation: 'refresh', code: 'ECONNRESET' },
      ];
    default:
      throw new Error(`no samples for kind ${kind}`);
  }
}

/** A status that reads as the verdict: 403, 302, 503, 418. */
function statusFor(verdict: string): number {
  switch (verdict) {
    case 'not-authorized':
      return 403;
    case 'redirected':
      return 302;
    case 'system-failed':
      return 503;
    default:
      return 418;
  }
}

/** A table cell holding `text` as code: a pipe escaped, backticks fenced. */
function code(text: string): string {
  const escaped = markdownCell(text);
  return escaped.includes('`') ? `\`\` ${escaped} \`\`` : `\`${escaped}\``;
}

export interface KindsTableInputs {
  readonly kinds?: readonly string[];
  readonly samples?: Readonly<Record<string, readonly Facts[]>>;
  readonly builders?: Readonly<Record<string, Builder | undefined>>;
}

/** The kinds table region of the README, rendered from the built builders. */
export function kindsTableRegion(
  inputs: KindsTableInputs = {},
): GeneratedRegion {
  const kinds = inputs.kinds ?? contract.AUTH_PROVIDER_ERROR_KINDS;
  const lines: string[] = [''];
  for (const kind of kinds) {
    const builder = (inputs.builders ?? authError)[kind];
    if (typeof builder !== 'function') {
      throw new Error(`no builder for ${kind}`);
    }
    const sampled = inputs.samples
      ? inputs.samples[kind]
      : defaultSamples(kind);
    if (sampled === undefined) throw new Error(`no samples for kind ${kind}`);
    lines.push(
      `#### \`${kind}\``,
      '',
      '| facts | reason | hint |',
      '|---|---|---|',
    );
    for (const facts of sampled) {
      const error = builder(facts);
      if (error.kind !== kind) {
        throw new Error(`${kind} ${JSON.stringify(facts)} built ${error.kind}`);
      }
      const hint = error.hint === undefined ? '—' : code(error.hint);
      lines.push(
        `| ${code(JSON.stringify(error.facts))} | ${code(error.reason)} | ${hint} |`,
      );
    }
    lines.push('');
  }
  return { open: KINDS_OPEN, close: KINDS_CLOSE, body: lines.join('\n') };
}
