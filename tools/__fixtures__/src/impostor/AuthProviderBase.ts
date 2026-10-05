/**
 * Rule 1: a local class named AuthProviderBase, in a file of that name, is
 * not the base the check was given (`--base`): it exempts nothing.
 */
import type { AuthOutcome, IAuthProvider } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../../src/index';

export abstract class AuthProviderBase implements IAuthProvider {
  abstract readonly kind: string;

  async prepare(): Promise<AuthOutcome> {
    return OK;
  }

  async establish(): Promise<AuthOutcome> {
    return OK;
  }

  async authorize(): Promise<AuthOutcome> {
    return OK;
  }

  async rejected(): Promise<AuthOutcome> {
    return OK;
  }
}
