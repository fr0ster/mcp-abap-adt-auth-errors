/**
 * Support for the fixtures: a base as auth-providers writes it.
 * It obeys every rule — rule 1 exempts the class of this name in this file.
 */
import type {
  AuthOutcome,
  IAuthProvider,
  IAuthRejection,
  ILogonTarget,
  IRequestTarget,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { guard } from '../../../../src/index';

type Moment = 'prepare' | 'establish' | 'authorize' | 'rejected';

export abstract class AuthProviderBase implements IAuthProvider {
  abstract readonly kind: string;
  readonly #moments: Readonly<Record<Moment, Operation>>;

  protected constructor(moments: Readonly<Record<Moment, Operation>>) {
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

  establish(logon: ILogonTarget): Promise<AuthOutcome> {
    return guard(
      this.#moments.establish,
      () => this.onEstablish(logon),
      () => this.grant(),
    );
  }

  authorize(request: IRequestTarget): Promise<AuthOutcome> {
    return guard(
      this.#moments.authorize,
      () => this.onAuthorize(request),
      () => this.grant(),
    );
  }

  rejected(rejection: IAuthRejection): Promise<AuthOutcome> {
    return guard(
      this.#moments.rejected,
      () => this.onRejected(rejection),
      () => this.grant(),
    );
  }

  protected abstract onPrepare(): AuthOutcome | Promise<AuthOutcome>;
  protected abstract onEstablish(
    logon: ILogonTarget,
  ): AuthOutcome | Promise<AuthOutcome>;
  protected abstract onAuthorize(
    request: IRequestTarget,
  ): AuthOutcome | Promise<AuthOutcome>;
  protected abstract onRejected(
    rejection: IAuthRejection,
  ): AuthOutcome | Promise<AuthOutcome>;
}
