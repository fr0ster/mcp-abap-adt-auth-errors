# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The package scaffold: build, type check (tests and type tests included),
  Biome with warnings as errors, Jest, CI on Node.js 22, 24 and 26, and a
  release workflow on a `v*.*.*` tag.
- `OK` — the one success outcome, `{ ok: true }`, frozen, typed as the
  `{ ok: true }` member of `AuthOutcome` from
  `@mcp-abap-adt/interfaces-auth` 5.0.0.
- `httpStatus()`, `count()`, `port()` — the branded-integer makers: a finite
  integer inside 100–599, 0–1 000 000, 0–65 535, read without coercion,
  comes back as `HttpStatus`, `Count`, `Port`; anything else is `undefined`.
- One membership guard per allowlist array of `interfaces-auth` 5.0.0
  (`isSystemCode`, `isTlsFailureCode`, `isOAuthErrorCode`, `isRfcKey`,
  `isConfigField`, `isAssertionRule`, `isOperation`, … — 34 in all), each
  narrowing `unknown` to the array's union. The sets behind them are
  module-private, copied from the arrays at load, and read through a
  `Set.prototype.has` captured at load, so patching it later changes no
  answer.
