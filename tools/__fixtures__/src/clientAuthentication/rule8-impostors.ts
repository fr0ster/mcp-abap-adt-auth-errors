import { createHash } from './fakeCrypto';

/** Rule 8: a name is not a boundary — only Node's `crypto` declarations are. */
function sign(value: string): string {
  return value;
}

export function identity(clientSecret: string): string {
  return Buffer.from(sign(clientSecret)).toString('base64');
}

const crypto = { sign: (_alg: string, data: Buffer) => data };

export function fakeObject(clientSecret: string): string {
  return crypto.sign('x', Buffer.from(clientSecret)).toString('base64');
}

export function shadowedImport(clientSecret: string): string {
  return createHash().update(clientSecret).digest().toString('base64');
}

export function local(clientSecret: string): string {
  const createHmac = () => ({
    update: (value: string) => ({ digest: () => Buffer.from(value) }),
  });
  return createHmac().update(clientSecret).digest().toString('base64');
}
