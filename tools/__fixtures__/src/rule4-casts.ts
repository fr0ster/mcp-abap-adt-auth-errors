/** Rule 4: assertions whose target is or contains an error, an outcome or a failure. */
import type {
  AuthOutcome,
  IAuthProviderError,
  IAuthProviderFailure,
  IAuthRefusal,
} from '@mcp-abap-adt/interfaces-auth';

const forged: unknown = { kind: 'unknown', facts: {}, reason: 'forged' };

export const error = forged as IAuthProviderError;
export const refusal = <IAuthRefusal>forged;
export const outcome = { ok: false, refusal: forged } as AuthOutcome;
export const later = Promise.resolve(forged) as Promise<AuthOutcome>;
export const failure = forged as IAuthProviderFailure;
export const wrapped = forged as { readonly inner: IAuthProviderError };
export const tls = forged as Extract<IAuthProviderError, { kind: 'tls' }>;
