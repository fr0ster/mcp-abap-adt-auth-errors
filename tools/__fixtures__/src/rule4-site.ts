/** Rule 4: the listed function name, in a file the list does not name. */
import type { HttpStatus } from '@mcp-abap-adt/interfaces-auth';

export function httpStatus(value: number): HttpStatus | undefined {
  return Number.isInteger(value) ? (value as HttpStatus) : undefined;
}
