/** Rule 7: a guard whose grant is not a function expression; a provider property read in its arguments. */
import type {
  AuthOutcome,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { guard, OK } from '../../../src/index';

const grantOf = (): OAuth2GrantType | undefined => undefined;

export function run(operation: Operation): Promise<AuthOutcome> {
  return guard(operation, () => OK, grantOf);
}

export class Metadata {
  readonly operation: Operation = 'preparing';

  run(): Promise<AuthOutcome> {
    return guard(this.operation, () => OK);
  }
}

export function through(operation: Operation): Promise<AuthOutcome> {
  return guard.call(undefined, operation, () => OK);
}
