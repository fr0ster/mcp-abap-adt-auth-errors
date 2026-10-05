/** Rule 4: the listed site (`src/numbers.ts`, `httpStatus`) may assert. */
import type { HttpStatus } from '@mcp-abap-adt/interfaces-auth';

export function httpStatus(value: number): HttpStatus | undefined {
  return Number.isInteger(value) ? (value as HttpStatus) : undefined;
}
