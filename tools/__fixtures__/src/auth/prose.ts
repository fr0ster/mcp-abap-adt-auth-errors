/** Rule 8 obeyed: prose naming Basic, a hash of a secret, a secret's name. */
import { createHmac } from 'node:crypto';

export const words = 'Basic authentication';
export const more = 'Basic credentials';

export function sentence(kind: string): string {
  return `the Basic ${kind}`;
}

/** An HMAC is not a reversible form of the secret: nothing to redact. */
export function signature(input: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(input).digest('base64url');
}

/** The name of a secret is not the secret. */
export function label(secretName: string): string {
  return Buffer.from(secretName).toString('base64');
}
