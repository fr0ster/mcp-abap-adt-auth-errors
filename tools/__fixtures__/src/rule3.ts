/** Rule 3: an object literal that satisfies IAuthProvider, returned by a function. */
import type { IAuthProvider } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../src/index';

export function literalProvider(): IAuthProvider {
  return {
    kind: 'literal',
    prepare: async () => OK,
    establish: async () => OK,
    authorize: async () => OK,
    rejected: async () => OK,
  };
}
