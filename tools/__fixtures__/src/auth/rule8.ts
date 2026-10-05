/** Rule 8: a Basic header and a base64 of a client secret outside the two helpers. */
export function header(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function encoded(config: { readonly clientSecret: string }): string {
  const joined = `id:${config.clientSecret}`;
  return btoa(joined);
}

export const fixed = 'Basic dXNlcjpwYXNzd29yZA==';

export function concatenated(credential: string): string {
  return 'Basic ' + credential;
}
