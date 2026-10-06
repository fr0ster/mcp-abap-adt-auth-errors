/** Rule 8: a Basic header in `src/clientAuthentication` outside `clientSecretBasic`. */
export function header(credential: string): string {
  return `Basic ${credential}`;
}
