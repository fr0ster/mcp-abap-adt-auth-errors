import * as contract from '@mcp-abap-adt/interfaces-auth';
import { loadBuilt } from './builtPackage';

/**
 * Exported allowlists cannot be widened (spec §11.1): whatever a consumer
 * does to an export of this package or to an allowlist array of
 * interfaces-auth after load — push through a cast, assign an index,
 * `Object.defineProperty` an index or `length`, `splice`, call a `Set` or
 * `Map` method on it with `.call`, patch `Set.prototype.has` — a foreign
 * code is still refused, every guard answers as before, and no word holds
 * the foreign value. And no export is a `Set` or a `Map`, nested one level.
 */
const built = loadBuilt();

type Classify = (thrown: unknown, operation: string) => unknown;
type ClassifyOutcome = (value: unknown, fallback: unknown) => unknown;
type Builder = (facts: unknown) => unknown;

/** Every function this test calls, read once before any attack. */
const classify = built.classify as Classify;
const classifyOutcome = built.classifyOutcome as ClassifyOutcome;
const render = built.render as (kind: unknown, facts: unknown) => unknown;
const logFields = built.logFields as (error: unknown) => unknown;
const renderDiagnostics = built.renderDiagnostics as (e: unknown) => unknown;
const readFailure = built.readFailure as Classify;
const authError = built.authError as Record<string, Builder>;
const unknownBuilder = authError.unknown as Builder;
const tlsBuilder = authError.tls as Builder;

/** Every allowlist array of interfaces-auth, by name. */
const ARRAYS: ReadonlyArray<readonly [string, readonly unknown[]]> =
  Object.entries(contract as Record<string, unknown>).flatMap(
    ([name, value]) =>
      Array.isArray(value)
        ? [[name, value as readonly unknown[]] as const]
        : [],
  );

/** Every `is…` guard of the package, by name. */
const GUARDS: ReadonlyArray<readonly [string, (value: unknown) => boolean]> =
  Object.entries(built)
    .filter(
      ([name, value]) => /^is[A-Z]/.test(name) && typeof value === 'function',
    )
    .map(([name, value]) => [name, value as (value: unknown) => boolean]);

/** The foreign values: each holds `evil`, in some case. */
const EVIL_CODE = 'EVIL_CODE';
const EVIL_OAUTH = 'evil_oauth_code';
const EVIL_RULE = 'evil-made-up-rule';
const MARKER = /evil/i;

/** One marker per array, and the three shared ones. */
function markersFor(arrayName: string): string[] {
  return [`EVIL_${arrayName}`, EVIL_CODE, EVIL_OAUTH, EVIL_RULE];
}

/** What each guard answers for every member of every array and each marker. */
function guardAnswers(): string {
  const probes: unknown[] = [];
  for (const [name, array] of ARRAYS)
    probes.push(...array, ...markersFor(name));
  return JSON.stringify(
    GUARDS.map(([name, guard]) => [name, probes.map((probe) => guard(probe))]),
  );
}

/** Foreign values through every path that reads a code, a rule or a field. */
function foreignResults(): unknown[] {
  const fallback = authError['logon-target']?.({
    wire: 'unknown',
    refused: 'tls-material',
  });
  const results: unknown[] = [
    classify({ code: EVIL_CODE }, 'token-request'),
    classify({ code: EVIL_CODE, status: 400 }, 'token-request'),
    classify({ oauthError: EVIL_OAUTH }, 'token-request'),
    classify(
      { response: { status: 400, data: { error: EVIL_OAUTH } } },
      'token-request',
    ),
    classify(
      {
        error: {
          kind: 'saml-assertion',
          facts: { rule: EVIL_RULE, check: 'document' },
        },
      },
      'validating-assertion',
    ),
    classify(
      { kind: 'tls', facts: { operation: 'token-request', code: EVIL_CODE } },
      'token-request',
    ),
    classify(
      {
        kind: 'configuration',
        facts: { case: 'required-fields-missing', fields: ['EVIL_FIELD'] },
      },
      'preparing',
    ),
    classify(
      {
        kind: 'request-failed',
        facts: {
          operation: 'token-request',
          problem: 'refused',
          code: EVIL_CODE,
          oauthError: EVIL_OAUTH,
        },
      },
      'token-request',
    ),
    classify({ kind: 'EVIL_KIND', facts: {} }, 'preparing'),
    classify(
      { kind: 'unknown', facts: { operation: 'EVIL_OPERATION' } },
      'preparing',
    ),
    classify({ kind: 'snc', facts: { problem: 'evil-problem' } }, 'preparing'),
    readFailure(
      {
        name: 'AuthProviderFailure',
        error: {
          kind: 'tls',
          facts: { operation: 'refresh', code: EVIL_CODE },
        },
      },
      'refresh',
    ),
    classifyOutcome(
      {
        ok: false,
        refusal: {
          kind: 'tls',
          facts: { operation: 'token-request', code: EVIL_CODE },
        },
      },
      fallback,
    ),
    unknownBuilder({
      operation: 'token-request',
      code: EVIL_CODE,
      oauthError: EVIL_OAUTH,
    }),
    tlsBuilder({ operation: 'token-request', code: EVIL_CODE }),
    render('tls', { operation: 'token-request', code: EVIL_CODE }),
    render('saml-assertion', { rule: EVIL_RULE, check: 'document' }),
  ];
  const errors = results.map((result) => {
    const refusal = (result as { refusal?: unknown }).refusal;
    return refusal ?? result;
  });
  for (const error of errors) {
    if (typeof (error as { kind?: unknown }).kind === 'string') {
      results.push(logFields(error), renderDiagnostics(error) ?? null);
    }
  }
  return results;
}

/** Calls `attack`, swallowing what a frozen target throws. */
function attempt(attack: () => unknown): void {
  try {
    attack();
  } catch {
    // A frozen array or object refuses in strict mode: the attack failed.
  }
}

/** Every attack of §11.1 on one value (an array, an object or a function). */
function attackValue(value: unknown, markers: readonly string[]): void {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return;
  }
  const target = value as Record<string, unknown> & unknown[];
  for (const marker of markers) {
    attempt(() => (target as unknown as string[]).push(marker));
    attempt(() => {
      target[0] = marker;
    });
    attempt(() => {
      target[(target as unknown[]).length ?? 0] = marker;
    });
    attempt(() => Object.defineProperty(target, '0', { value: marker }));
    attempt(() => Object.defineProperty(target, '999', { value: marker }));
    attempt(() => Object.defineProperty(target, 'length', { value: 999 }));
    attempt(() => Array.prototype.splice.call(target, 0, 0, marker));
    attempt(() => Array.prototype.push.call(target, marker));
    attempt(() => Set.prototype.add.call(target, marker));
    attempt(() => Set.prototype.delete.call(target, marker));
    attempt(() => Map.prototype.set.call(target, marker, true));
    attempt(() => Map.prototype.delete.call(target, marker));
  }
  attempt(() => Set.prototype.clear.call(target));
  attempt(() => Map.prototype.clear.call(target));
}

/** Every export of the package, and every value one level below it. */
function exportedValues(): Array<readonly [string, unknown]> {
  const values: Array<readonly [string, unknown]> = [];
  for (const [name, value] of Object.entries(built)) {
    values.push([name, value]);
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function')
    ) {
      continue;
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && 'value' in descriptor) {
        values.push([`${name}.${String(key)}`, descriptor.value]);
      }
    }
  }
  return values;
}

describe('no export is a Set or a Map, nested one level', () => {
  it.each(exportedValues())('%s', (_name, value) => {
    expect(value instanceof Set).toBe(false);
    expect(value instanceof Map).toBe(false);
    expect(value instanceof WeakSet).toBe(false);
    expect(value instanceof WeakMap).toBe(false);
    if (Array.isArray(value)) expect(Object.isFrozen(value)).toBe(true);
  });
});

describe('exported allowlists cannot be widened', () => {
  const originalHas = Set.prototype.has;
  const originalIncludes = Array.prototype.includes;
  const originalIndexOf = Array.prototype.indexOf;

  afterEach(() => {
    Set.prototype.has = originalHas;
    Array.prototype.includes = originalIncludes;
    Array.prototype.indexOf = originalIndexOf;
  });

  it('the foreign values are refused before any attack', () => {
    expect(JSON.stringify(foreignResults())).not.toMatch(MARKER);
  });

  it('after every attack, a foreign value is still refused, every guard answers as before, no word holds it', () => {
    const answersBefore = guardAnswers();
    const resultsBefore = JSON.stringify(foreignResults());

    for (const [name, array] of ARRAYS) attackValue(array, markersFor(name));
    for (const [name, value] of exportedValues()) {
      attackValue(value, markersFor(name));
    }
    Set.prototype.has = function alwaysTrue(): boolean {
      return true;
    };
    Array.prototype.includes = function alwaysTrue(): boolean {
      return true;
    };
    Array.prototype.indexOf = function alwaysFirst(): number {
      return 0;
    };

    const answersAfter = guardAnswers();
    const resultsAfter = JSON.stringify(foreignResults());
    Set.prototype.has = originalHas;
    Array.prototype.includes = originalIncludes;
    Array.prototype.indexOf = originalIndexOf;

    expect(answersAfter).toBe(answersBefore);
    expect(resultsAfter).toBe(resultsBefore);
    expect(resultsAfter).not.toMatch(MARKER);
    // Read afresh from the namespace: no export was replaced either.
    for (const [name, guard] of GUARDS) {
      expect([name, built[name]]).toEqual([name, guard]);
    }
    for (const [name, array] of ARRAYS) {
      expect([name, JSON.stringify(array)]).not.toEqual([
        name,
        expect.stringMatching(MARKER),
      ]);
    }
  });

  it('every guard still refuses each marker and admits each member after the attacks', () => {
    for (const [name, array] of ARRAYS) attackValue(array, markersFor(name));
    for (const [, guard] of GUARDS) {
      for (const [name] of ARRAYS) {
        for (const marker of markersFor(name))
          expect(guard(marker)).toBe(false);
      }
    }
  });
});
