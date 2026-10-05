/**
 * A base named by `--base` that does not delegate its moments to guard: the
 * check refuses each moment (rule 1), whatever the class and file are named.
 */
import type {
  AuthOutcome,
  IAuthProvider,
  IAuthRejection,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { guard as realGuard, OK } from '../../../src/index';

/** A local function named guard: not auth-errors' guard. */
function guard(
  _operation: Operation,
  body: () => AuthOutcome,
  _grant: () => unknown,
): Promise<AuthOutcome> {
  return Promise.resolve(body());
}

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

  protected readonly body = (): AuthOutcome => OK;
  protected readonly grantThunk = (): unknown => undefined;

  /** The body is not a function expression. */
  prepare(): Promise<AuthOutcome> {
    return realGuard(this.#moments.prepare, this.body, () => this.grant());
  }

  /** More than the one return statement. */
  establish(): Promise<AuthOutcome> {
    const operation = this.#moments.establish;
    return realGuard(
      operation,
      () => this.onAny(),
      () => this.grant(),
    );
  }

  /** A local function named guard, not auth-errors'. */
  authorize(): Promise<AuthOutcome> {
    return guard(
      this.#moments.authorize,
      () => this.onAny(),
      () => this.grant(),
    );
  }

  /** The grant is not a function expression. */
  rejected(rejection: IAuthRejection): Promise<AuthOutcome> {
    return realGuard(
      this.#moments.rejected,
      () => this.onRejected(rejection),
      this.grantThunk,
    );
  }

  protected abstract onAny(): AuthOutcome;
  protected abstract onRejected(rejection: IAuthRejection): AuthOutcome;
}
