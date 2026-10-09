/** Obeys every rule of the shape check: it reports nothing here. */
import type {
  AuthOutcome,
  AuthProviderErrorFacts,
  HttpStatus,
  IAuthProviderError,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { authError, guard, httpStatus, OK } from '../../../src/index';
import { AuthProviderBase } from './auth/AuthProviderBase';

/** Rules 1–2: a provider reaches the base and declares none of the four. */
export class FixedProvider extends AuthProviderBase {
  readonly kind: string = 'fixed';

  constructor() {
    super({
      prepare: 'preparing',
      establish: 'establishing',
      authorize: 'authorizing',
      rejected: 'reading-rejection',
    });
  }

  protected onPrepare(): AuthOutcome {
    return OK;
  }

  protected onEstablish(): AuthOutcome {
    return OK;
  }

  protected onAuthorize(): AuthOutcome {
    return OK;
  }

  protected onRejected(): AuthOutcome {
    return { ok: false, refusal: refusedOnce() };
  }
}

/** A second level: still reaches the base, still declares none of the four. */
export class NamedProvider extends FixedProvider {
  override readonly kind = 'named';
}

/** Rule 6: diagnostics passed at the listed site, the listed field. */
export function samlRefusal(issuer: string): IAuthProviderError {
  return authError['saml-assertion']<'untrusted-issuer'>(
    { rule: 'untrusted-issuer', check: 'issuer' },
    { issuer },
  );
}

/** Rule 6: a builder without diagnostics is called anywhere. */
function refusedOnce(): IAuthProviderError {
  return authError.tls({
    operation: 'token-request',
    code: 'CERT_HAS_EXPIRED',
  });
}

/** Rule 4: a branded integer from its maker; assertions on other types. */
export const status: HttpStatus | undefined = httpStatus(500);
export const plain = JSON.parse('1') as number;
export const names = ['a', 'b'] as const;

/** Rule 5: an error kept by reference, never spread. */
export function wrapped(error: IAuthProviderError) {
  return { error, note: 'kept as it is' };
}
export function copied(outcome: { readonly note: string }) {
  return { ...outcome, extra: true };
}

/** Rule 7: a guard whose grant is a function expression, no `this` read. */
export function run(operation: Operation): Promise<AuthOutcome> {
  return guard(
    operation,
    () => OK,
    () => undefined,
  );
}

/** Rule 4: an overload whose return is no contract type. */
export function twice(value: number): number;
export function twice(value: string): string;
export function twice(value: number | string): number | string {
  return typeof value === 'number' ? value * 2 : value + value;
}

/** Rule 4: an overload returning facts (branded integers, no error) is no error overload. */
export function requestFacts(
  status: HttpStatus,
): AuthProviderErrorFacts['request-failed'];
export function requestFacts(status: HttpStatus): object {
  return { operation: 'token-request', problem: 'refused', status };
}
