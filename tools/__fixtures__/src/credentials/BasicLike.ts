/** Rule 8 covers `src/auth` and `src/providers` only: a credential presented to the system stays. */
export function header(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}
