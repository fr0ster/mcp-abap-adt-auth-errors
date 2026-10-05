/** Rule 1: a provider reaching only the impostor base does not reach the base. */
import { AuthProviderBase } from './AuthProviderBase';

export class ImpostorProvider extends AuthProviderBase {
  readonly kind = 'impostor';
}
