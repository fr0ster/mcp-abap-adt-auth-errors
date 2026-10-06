import { createHash, createSign, createHmac as hmac } from 'node:crypto';
import * as crypto from 'crypto';

/** Rule 8: a hash, HMAC or signature of a secret is not a reversible form of it. */
export function hashed(clientSecret: string): string {
  const digest = createHash('sha256').update(clientSecret).digest();
  return digest.toString('base64');
}

export function hmaced(clientSecret: string): string {
  return hmac('sha256', 'key')
    .update(clientSecret)
    .digest()
    .toString('base64url');
}

export function namespaced(clientSecret: string): string {
  return crypto.createHash('sha256').update(clientSecret).digest('base64');
}

export function signed(clientSecret: string, key: string): string {
  const signature = createSign('sha256').update(clientSecret).sign(key);
  return signature.toString('base64');
}

export function signedDirect(clientSecret: string, key: string): string {
  return crypto
    .sign('sha256', Buffer.from(clientSecret), key)
    .toString('base64');
}

export function constHeld(clientSecret: string): string {
  const encoder = createHash('sha256').update(clientSecret);
  return encoder.digest().toString('base64');
}
