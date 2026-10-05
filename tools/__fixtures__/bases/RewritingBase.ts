/**
 * A base named by `--base` whose moments delegate to guard as declared, but
 * which replaces them at run time: each write is refused under rule 1.
 */
import type {
  AuthOutcome,
  IAuthProvider,
  OAuth2GrantType,
  Operation,
} from '@mcp-abap-adt/interfaces-auth';
import { guard, OK } from '../../../src/index';

type Moment = 'prepare' | 'establish' | 'authorize' | 'rejected';
const PREPARE = 'prepare';

export abstract class AuthProviderBase implements IAuthProvider {
  abstract readonly kind: string;
  readonly #moments: Readonly<Record<Moment, Operation>>;

  protected constructor(moments: Readonly<Record<Moment, Operation>>) {
    this.#moments = Object.freeze({ ...moments });
    // 1: `this.<moment> =` in the constructor.
    this.authorize = async () => OK;
    // 2: a computed name folded from a constant, through an assertion.
    (this as unknown as Record<string, unknown>)[PREPARE] = async () => OK;
    // 3: Object.assign onto this.
    Object.assign(this, { rejected: async () => OK });
    // 4: Object.defineProperty onto this.
    Object.defineProperty(this, 'establish', { value: async () => OK });
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

  establish(): Promise<AuthOutcome> {
    return guard(
      this.#moments.establish,
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

// 5: a write onto the base's prototype.
AuthProviderBase.prototype.prepare = async () => OK;
// 6: Object.assign onto the base's prototype.
Object.assign(AuthProviderBase.prototype, { authorize: async () => OK });
// 7: Object.defineProperty onto the base's prototype.
Object.defineProperty(AuthProviderBase.prototype, 'rejected', {
  value: async () => OK,
});
