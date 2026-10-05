/** Rule 6: a builder call passing diagnostics at a site the list does not name. */
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';
import { authError } from '../../../src/index';

export function samlRefusal(issuer: string): IAuthProviderError {
  return authError['saml-assertion']<'untrusted-issuer'>(
    { rule: 'untrusted-issuer', check: 'issuer' },
    { issuer },
  );
}

/** A builder reached through bind: the call cannot be checked. */
export const bound = authError.snc.bind(authError);
