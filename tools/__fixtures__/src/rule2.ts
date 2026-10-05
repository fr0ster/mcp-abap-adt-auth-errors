/** Rule 2: a class reaching AuthProviderBase (two levels down) declares `prepare`. */
import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';
import { OK } from '../../../src/index';
import { FixedProvider, NamedProvider } from './obeys';

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

const PREPARE = 'prepare';

export class ComputedProvider extends FixedProvider {
  override async [PREPARE](): Promise<AuthOutcome> {
    return OK;
  }
}

export class AssignedProvider extends FixedProvider {
  constructor() {
    super();
    Object.assign(this, { rejected: async () => OK });
    Object.defineProperty(this, PREPARE, { value: async () => OK });
  }
}

Object.assign(NamedProvider.prototype, { authorize: async () => OK });
