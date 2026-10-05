/** Rule 5: a spread and an Object.assign whose source is an error. */
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';

export function reworded(error: IAuthProviderError) {
  return { ...error, reason: 'other words' };
}

export function assigned(error: IAuthProviderError) {
  return Object.assign({}, error, { reason: 'other words' });
}
