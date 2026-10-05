/** Rule 1: a class that implements IAuthProvider and is not AuthProviderBase. */
import type { AuthOutcome, IAuthProvider } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../src/index';
import { FixedProvider } from './obeys';

export class DirectProvider implements IAuthProvider {
  readonly kind = 'direct';

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

/** Rule 1 by its letter: `implements IAuthProvider` beside the base is refused too. */
export class RedundantProvider extends FixedProvider implements IAuthProvider {}
