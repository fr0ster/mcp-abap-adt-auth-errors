/** Rule 4: an overload whose return is an error, outside builders.ts and mint.ts. */
import type {
  AuthProviderErrorKind,
  AuthProviderErrorOf,
  IAuthProviderError,
} from '@mcp-abap-adt/interfaces-auth';

export function launder(value: object): IAuthProviderError;
export function launder(value: object): unknown {
  return value;
}

export function launderKind<K extends AuthProviderErrorKind>(
  kind: K,
): AuthProviderErrorOf<K>;
export function launderKind(kind: AuthProviderErrorKind): unknown {
  return { kind };
}
