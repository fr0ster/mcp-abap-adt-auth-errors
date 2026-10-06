/** Rule 8: a base64 of the raw secret, and a Basic header from it. */
export function raw(clientSecret: string): string {
  return Buffer.from(clientSecret).toString('base64');
}

export function basic(clientId: string, clientSecret: string): string {
  return `Basic ${clientId}:${clientSecret}`;
}
