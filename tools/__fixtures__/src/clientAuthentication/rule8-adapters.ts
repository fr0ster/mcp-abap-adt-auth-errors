import * as nodeCrypto from 'node:crypto';

/** Rule 8: an injected adapter typed from crypto may be a stub — not a boundary. */
export function injectedSign(
  clientSecret: string,
  adapter: Pick<typeof nodeCrypto, 'sign'>,
): string {
  return adapter
    .sign('sha256', Buffer.from(clientSecret), 'key')
    .toString('base64');
}

export function injectedHash(
  clientSecret: string,
  adapter: Pick<typeof nodeCrypto, 'createHash'>,
): string {
  return adapter
    .createHash('sha256')
    .update(clientSecret)
    .digest()
    .toString('base64');
}

export function reassignedNamespace(
  clientSecret: string,
  stub: typeof nodeCrypto,
): string {
  // biome-ignore lint/style/useConst: reassigned below
  let target = nodeCrypto;
  target = stub;
  return target
    .createHash('sha256')
    .update(clientSecret)
    .digest()
    .toString('base64');
}
