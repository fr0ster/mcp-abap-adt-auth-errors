/** Rule 1: a class whose instances satisfy IAuthProvider without `implements`, outside the base. */
import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../src/index';

export class UndeclaredProvider {
  readonly kind = 'undeclared';

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
