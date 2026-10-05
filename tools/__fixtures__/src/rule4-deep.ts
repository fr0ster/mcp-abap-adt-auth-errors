/**
 * Rule 4: a type first reached at the depth cut-off, then near the top.
 * `Holder` is met through seven levels first (its members cut), then as
 * `near` — and is walked again there, where its error is reached.
 */
import type { IAuthProviderError } from '@mcp-abap-adt/interfaces-auth';

interface Holder {
  readonly error: IAuthProviderError;
}
interface L7 {
  readonly holder: Holder;
}
interface L6 {
  readonly next: L7;
}
interface L5 {
  readonly next: L6;
}
interface L4 {
  readonly next: L5;
}
interface L3 {
  readonly next: L4;
}
interface L2 {
  readonly next: L3;
}
interface L1 {
  readonly next: L2;
}

const value: unknown = {};

export const deep = value as { readonly far: L1; readonly near: Holder };
