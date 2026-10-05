# @mcp-abap-adt/auth-errors
[![Stand With Ukraine](https://raw.githubusercontent.com/vshymanskyy/StandWithUkraine/main/badges/StandWithUkraine.svg)](https://stand-with-ukraine.pp.ua)

The runtime half of the `@mcp-abap-adt` authentication error contract.

`@mcp-abap-adt/interfaces-auth` (5.0.0 and later) declares the types: every
failure of authentication is an `IAuthProviderError` — a `kind` from a closed
list, `facts` drawn only from allowlists and integer ranges, the default
`reason` / `hint` words, and, for three kinds, `diagnostics` admitted one field
at a time. Those types carry a brand no code can write: an error can only be
**minted**, and this package is the only place that mints one.

This package will hold the code behind the types:

- **builders** — one per kind, the only way to obtain an error;
- **words** — the default `reason` / `hint` for every kind and every variant,
  and `render(kind, facts)` so a consumer can produce the same ones;
- **diagnostics admission** — what a diagnostic value must look like to be
  kept;
- **allowlist guards** — `isSystemCode`, `isTlsFailureCode`,
  `isOAuthErrorCode`, … over private sets nobody can widen;
- **classification** — `classify(thrown, operation)` turns any thrown value
  into an error, and `classifyOutcome` re-checks an outcome that came from a
  collaborator;
- `AuthProviderFailure` (the one thrown class), `guard` / `relayOutcome`,
  `matchKind` / `unreachableKind`, `isMinted`, `logFields`,
  `renderDiagnostics`, `blamesCredential`, `sharedAttempt`.

No error built here carries a secret or foreign text: no message, cause, stack
or body of a thrown value is ever read.

## Status

Under construction, unpublished. Exported today:

- `OK` — the one success outcome, `{ ok: true }`, frozen, typed as the
  `{ ok: true }` member of `AuthOutcome`.

```ts
import { OK } from '@mcp-abap-adt/auth-errors';
import type { AuthOutcome } from '@mcp-abap-adt/interfaces-auth';

async function prepare(): Promise<AuthOutcome> {
  return OK;
}
```

## Install

```bash
npm install @mcp-abap-adt/auth-errors
```

It depends on `@mcp-abap-adt/interfaces-auth` `^5.0.0` and nothing else.
Node.js 22, 24 or 26.

## Development

```bash
npm run build        # clean build: Biome errors, then tsc
npm run test:check   # type check: sources, tests and type tests
npm run lint:check   # Biome, warnings fail
npm test             # Jest; needs a build first (a test loads dist/)
```

## License

LGPL-3.0-only — see [LICENSE](LICENSE) and [COPYING](COPYING).
