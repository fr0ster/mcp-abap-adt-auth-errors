import { createHash, createHmac } from 'node:crypto';

/** Rule 8: a hash or HMAC of a secret is not a reversible form of it. */
export function hashed(clientSecret: string): string {
  const digest = createHash('sha256').update(clientSecret).digest();
  return digest.toString('base64');
}

export function hmaced(clientSecret: string): string {
  return createHmac('sha256', 'key')
    .update(clientSecret)
    .digest()
    .toString('base64url');
}
