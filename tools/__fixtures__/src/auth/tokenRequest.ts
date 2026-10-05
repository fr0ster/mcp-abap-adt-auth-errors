/** Rule 8: `legacyBasic` in `src/auth/tokenRequest.ts` may build a Basic header. */
export function legacyBasic(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

/** Base64 of what holds no secret is no concern of rule 8. */
export function encodeRequest(request: string): string {
  return Buffer.from(request, 'utf8').toString('base64');
}
