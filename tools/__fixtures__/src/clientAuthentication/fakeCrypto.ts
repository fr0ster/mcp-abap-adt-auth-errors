/** Rule 8: a module that is not Node's `crypto`, exporting a `createHash` that hashes nothing. */
export function createHash() {
  return {
    update: (value: string) => ({ digest: () => Buffer.from(value) }),
  };
}
