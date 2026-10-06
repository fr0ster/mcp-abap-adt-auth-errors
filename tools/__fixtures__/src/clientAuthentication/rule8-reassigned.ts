import { createHash } from 'node:crypto';

/** Rule 8: a crypto object in a `let` may be replaced by a later assignment. */
export function reassigned(clientSecret: string, useHash: boolean): string {
  let encoder: { digest: () => Buffer } =
    createHash('sha256').update(clientSecret);
  if (!useHash) encoder = { digest: () => Buffer.from(clientSecret) };
  return encoder.digest().toString('base64');
}
