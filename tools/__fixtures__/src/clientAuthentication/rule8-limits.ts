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

/** A `let` is reported even when never reassigned: only a `const` is trusted. */
export function letNeverReassigned(clientSecret: string): string {
  // biome-ignore lint/style/useConst: the fixture is a `let` never reassigned
  let encoder = crypto.createHash('sha256').update(clientSecret);
  return encoder.digest().toString('base64');
}

/** A `let` alias of a crypto function is reported: only a `const` is followed. */
export function letAlias(clientSecret: string): string {
  // biome-ignore lint/style/useConst: the fixture is a `let` never reassigned
  let make = crypto.createHash;
  return make('sha256').update(clientSecret).digest().toString('base64');
}
