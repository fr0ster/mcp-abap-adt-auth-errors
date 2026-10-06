import { createHash, type Hash } from 'node:crypto';

/** Rule 8: only factory(…) [.update(…)]* .digest(…) is a boundary; other members are not. */
export function piped(clientSecret: string, sink: Hash): string {
  return createHash('sha256')
    .update(clientSecret)
    .pipe(sink)
    .digest()
    .toString('base64');
}

export function copied(clientSecret: string): string {
  const copy = createHash('sha256').update(clientSecret).copy();
  return copy.digest().toString('base64');
}
