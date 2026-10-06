import * as crypto from 'crypto';

/** Rule 8, documented limits: a legitimate digest in these forms is reported (fails closed). */
export function destructured(clientSecret: string): string {
  const { createHash } = crypto;
  return createHash('sha256').update(clientSecret).digest().toString('base64');
}

export async function subtleDigest(clientSecret: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    Buffer.from(clientSecret),
  );
  return Buffer.from(digest).toString('base64');
}
