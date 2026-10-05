/** A base whose constructor declares a moment as a parameter property: rule 1. */
import type {
  AuthOutcome,
  IAuthProvider,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { guard } from '../../../src/index';

type Moment = 'prepare' | 'establish' | 'authorize' | 'rejected';

export abstract class AuthProviderBase implements IAuthProvider {
  abstract readonly kind: string;
  readonly #moments: Readonly<Record<Moment, Operation>>;

  protected constructor(
    moments: Readonly<Record<Moment, Operation>>,
    readonly establish: () => Promise<AuthOutcome> = () => Promise.reject(),
  ) {
    this.#moments = Object.freeze({ ...moments });
  }

  protected grant(): OAuth2GrantType | undefined {
    return undefined;
  }

  prepare(): Promise<AuthOutcome> {
    return guard(
      this.#moments.prepare,
      () => this.onPrepare(),
      () => this.grant(),
    );
  }

  authorize(): Promise<AuthOutcome> {
    return guard(
      this.#moments.authorize,
      () => this.onPrepare(),
      () => this.grant(),
    );
  }

  rejected(): Promise<AuthOutcome> {
    return guard(
      this.#moments.rejected,
      () => this.onPrepare(),
      () => this.grant(),
    );
  }

  protected abstract onPrepare(): AuthOutcome;
}
