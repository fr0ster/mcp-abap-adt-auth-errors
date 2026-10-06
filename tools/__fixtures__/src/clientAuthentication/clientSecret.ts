/** Rule 8: `clientSecretBasic` in `src/clientAuthentication/clientSecret.ts` may build a Basic header, also inside the strategy it returns. */
export function clientSecretBasic(secret: string) {
  return {
    authenticate: async (draft: { readonly clientId: string }) => ({
      headers: {
        Authorization: `Basic ${Buffer.from(`${draft.clientId}:${secret}`).toString('base64')}`,
      },
    }),
  };
}
