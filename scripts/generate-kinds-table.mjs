#!/usr/bin/env node
/**
 * The README's kinds table (spec §11.4): every kind, every discriminant
 * value, and a few optional facts, built through the built package's own
 * builders — so each row's `reason` and `hint` are the words `words.ts`
 * renders, never a hand copy.
 *
 *   node scripts/generate-kinds-table.mjs           print the table
 *   node scripts/generate-kinds-table.mjs --write   replace it in README.md
 *
 * Needs a build (`dist/`). `src/__tests__/kindsTable.test.ts` fails when the
 * committed README differs from what this prints.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const contract = require('@mcp-abap-adt/interfaces-auth');
const built = require(join(root, 'dist/index.js'));
const { ASSERTION_RULE_CHECK } = require(join(root, 'dist/words.js'));

export const BEGIN =
  '<!-- BEGIN GENERATED: kinds table (npm run docs:kinds) — do not edit by hand -->';
export const END = '<!-- END GENERATED: kinds table -->';

const { authError, httpStatus, count, port } = built;

/** Facts per discriminant value, then the samples of optional facts. */
function samples(kind) {
  switch (kind) {
    case 'configuration':
      return [
        ...contract.CONFIG_CASES.map((c) => ({
          case: c,
          fields: c === 'required-fields-missing' ? ['clientId'] : [],
        })),
        {
          case: 'required-fields-missing',
          fields: ['clientId', 'clientSecret', 'uaaUrl'],
        },
      ];
    case 'client-certificate':
      return contract.CLIENT_CERTIFICATE_PROBLEMS.map((problem) => ({
        problem,
      }));
    case 'client-authentication':
      return contract.CLIENT_AUTHENTICATION_PROBLEMS.map((problem) => ({
        problem,
      }));
    case 'request-failed':
      return [
        ...contract.REQUEST_PROBLEMS.map((problem) => ({
          operation: 'token-refresh',
          problem,
        })),
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
        ...contract.TLS_FAILURE_CODES.map((code) => ({
          operation: 'oidc-discovery',
          code,
        })),
        {
          operation: 'token-request',
          grant: 'client_credentials',
          code: 'CERT_HAS_EXPIRED',
        },
      ];
    case 'interactive-login':
      return [
        ...contract.INTERACTIVE_OUTCOMES.map((outcome) =>
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
        { outcome: 'browser-launch-failed', code: 'ENOENT' },
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
        ...contract.SNC_PROBLEMS.map((problem) => ({ problem })),
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
      return contract.SYSTEM_REFUSED_VERDICTS.flatMap((verdict) =>
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
    case 'token-binding':
      return contract.TOKEN_BINDING_PROBLEMS.map((problem) => ({ problem }));
    case 'not-prepared':
      return contract.NOT_PREPARED_PROVIDERS.map((provider) => ({ provider }));
    case 'logon-target':
      return contract.LOGON_TARGET_WIRES.flatMap((wire) =>
        contract.LOGON_TARGET_REFUSALS.map((refused) => ({ wire, refused })),
      );
    case 'connection':
      return [
        ...contract.CONNECTION_PROBLEMS.map((problem) => ({ problem })),
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
function statusFor(verdict) {
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
function code(text) {
  const escaped = text.replaceAll('|', '\\|');
  return escaped.includes('`') ? `\`\` ${escaped} \`\`` : `\`${escaped}\``;
}

/** The generated Markdown, between and including the two markers. */
export function generate() {
  const lines = [BEGIN, ''];
  for (const kind of contract.AUTH_PROVIDER_ERROR_KINDS) {
    const builder = authError[kind];
    if (typeof builder !== 'function')
      throw new Error(`no builder for ${kind}`);
    lines.push(
      `#### \`${kind}\``,
      '',
      '| facts | reason | hint |',
      '|---|---|---|',
    );
    for (const facts of samples(kind)) {
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
  lines.push(END);
  return lines.join('\n');
}

/** The README's generated section, between and including the markers. */
export function committed(readme) {
  const start = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (start < 0 || end < start)
    throw new Error('README has no kinds table markers');
  return readme.slice(start, end + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const table = generate();
  if (process.argv.includes('--write')) {
    const file = join(root, 'README.md');
    const readme = readFileSync(file, 'utf8');
    const old = committed(readme);
    const at = readme.indexOf(old);
    writeFileSync(
      file,
      `${readme.slice(0, at)}${table}${readme.slice(at + old.length)}`,
    );
  } else {
    process.stdout.write(`${table}\n`);
  }
}
