import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';

/**
 * The one success outcome, `{ ok: true }`, frozen: every provider and every
 * relay answers this object, so no caller can change what "Ok" means.
 */
export const OK: Extract<AuthOutcome, { ok: true }> = Object.freeze({
  ok: true,
});
