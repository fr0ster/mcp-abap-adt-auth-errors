/** The four moments of IAuthProvider, which the base owns. */
export const MOMENTS: ReadonlySet<string> = new Set([
  'prepare',
  'establish',
  'authorize',
  'rejected',
]);
/** The base's name, as the findings say it. */
export const BASE = 'AuthProviderBase';
/** Rule 4: the files of auth-errors whose overloads are the builders' own. */
export const OVERLOAD_FILES: ReadonlySet<string> = new Set([
  'src/builders.ts',
  'src/mint.ts',
]);
/** Rule 8: where it applies, and its two sites. */
export const BASIC_SCOPE: readonly string[] = [
  'src/auth/',
  'src/providers/',
  'src/clientAuthentication/',
];
export const BASIC_SITES: readonly {
  readonly file: string;
  readonly function: string;
}[] = [
  { file: 'src/auth/tokenRequest.ts', function: 'legacyBasic' },
  {
    file: 'src/clientAuthentication/clientSecret.ts',
    function: 'clientSecretBasic',
  },
];
/** Rule 8: the modules whose imports are Node's crypto. */
export const CRYPTO_MODULES: ReadonlySet<string> = new Set([
  'crypto',
  'node:crypto',
]);
/** How deep a type, an alias or an initialiser is followed. */
export const MAX_DEPTH = 8;
