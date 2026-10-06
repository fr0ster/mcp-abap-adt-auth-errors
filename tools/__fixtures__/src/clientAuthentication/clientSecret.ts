/** Rule 8: `clientSecretBasic` in `src/clientAuthentication/clientSecret.ts` may build a Basic header. */
export function clientSecretBasic(
  clientId: string,
  clientSecret: string,
): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}
