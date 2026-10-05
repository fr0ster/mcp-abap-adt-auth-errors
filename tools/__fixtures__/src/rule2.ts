/** Rule 2: a class reaching AuthProviderBase (two levels down) declares `prepare`. */
import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../src/index';
import { FixedProvider } from './obeys';

export class OverridingProvider extends FixedProvider {
  override async prepare(): Promise<AuthOutcome> {
    return OK;
  }
}

export class AssigningProvider extends FixedProvider {
  constructor() {
    super();
    this.establish = async () => OK;
  }
}

export class ParameterProvider extends FixedProvider {
  constructor(override readonly authorize: () => Promise<AuthOutcome>) {
    super();
  }
}
