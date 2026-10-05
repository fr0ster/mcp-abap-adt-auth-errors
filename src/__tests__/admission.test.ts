import {
  ASSERTION_RULES,
  CONFIG_CASE_DIAGNOSTICS,
  CONFIG_CASES,
  SAML_RULE_DIAGNOSTIC,
  SNC_PROBLEM_DIAGNOSTICS,
  SNC_PROBLEMS,
} from '@mcp-abap-adt/interfaces-auth';
import { loadBuiltModule } from './builtPackage';

/**
 * Diagnostics admission (spec §5.3, §11.1 "Diagnostics admission"): each
 * check answers the admitted value or `undefined` ("drop"), never throws,
 * and the per-kind admission keeps only the fields the interfaces-auth
 * diagnostics maps permit for the discriminant.
 */
type Check = (value: unknown) => unknown;
type Admit = (
  discriminant: unknown,
  input: unknown,
  ...rest: unknown[]
) => unknown;

const admission = loadBuiltModule('admission');

function check(name: string): Check {
  const exported = admission[name];
  if (typeof exported !== 'function') {
    throw new Error(`dist/admission.js exports no function "${name}"`);
  }
  return exported as Check;
}
function admit(name: string): Admit {
  const exported = admission[name];
  if (typeof exported !== 'function') {
    throw new Error(`dist/admission.js exports no function "${name}"`);
  }
  return exported as Admit;
}

const admitLocalPath = check('admitLocalPath');
const admitDocumentValue = check('admitDocumentValue');
const admitAsciiDocumentValue = check('admitAsciiDocumentValue');
const admitXmlName = check('admitXmlName');
const admitXmlId = check('admitXmlId');
const admitDocumentTime = check('admitDocumentTime');
const admitConfigUri = check('admitConfigUri');
const admitSamlDiagnostics = admit('admitSamlDiagnostics');
const admitSncDiagnostics = admit('admitSncDiagnostics');
const admitConfigDiagnostics = admit('admitConfigDiagnostics');

const ELLIPSIS = '…';
const ASTRAL = '\u{1F600}'; // two UTF-16 units, one code point

/** Every character class LocalPath and DocumentValue refuse, one or more each. */
const REFUSED: ReadonlyArray<[string, string]> = [
  ['C0 NUL', '\u0000'],
  ['C0 TAB', '\t'],
  ['C0 LF', '\n'],
  ['C0 CR', '\r'],
  ['C0 ESC', '\u001b'],
  ['C0 U+001F', '\u001f'],
  ['DEL', '\u007f'],
  ['C1 U+0080', '\u0080'],
  ['C1 NEL', '\u0085'],
  ['C1 U+009F', '\u009f'],
  ['LINE SEPARATOR', '\u2028'],
  ['PARAGRAPH SEPARATOR', '\u2029'],
  ['bidi LRE U+202A', '\u202a'],
  ['bidi RLE U+202B', '\u202b'],
  ['bidi PDF U+202C', '\u202c'],
  ['bidi LRO U+202D', '\u202d'],
  ['bidi RLO U+202E', '\u202e'],
  ['bidi LRI U+2066', '\u2066'],
  ['bidi RLI U+2067', '\u2067'],
  ['bidi FSI U+2068', '\u2068'],
  ['bidi PDI U+2069', '\u2069'],
  ['ZWSP U+200B', '\u200b'],
  ['ZWNJ U+200C', '\u200c'],
  ['ZWJ U+200D', '\u200d'],
  ['LRM U+200E', '\u200e'],
  ['RLM U+200F', '\u200f'],
  ['ALM U+061C', '\u061c'],
  ['BOM U+FEFF', '\ufeff'],
  ['WORD JOINER U+2060', '\u2060'],
  ['FUNCTION APPLICATION U+2061', '\u2061'],
  ['INVISIBLE TIMES U+2062', '\u2062'],
  ['INVISIBLE SEPARATOR U+2063', '\u2063'],
  ['INVISIBLE PLUS U+2064', '\u2064'],
  ['MONGOLIAN VOWEL SEPARATOR U+180E', '\u180e'],
  ['lone high surrogate', '\ud800'],
  ['lone low surrogate', '\udfff'],
  ['reversed surrogate pair', '\udc00\ud800'],
];

/** Neighbours of every refused range, each admitted. */
const BOUNDARY_ADMITTED: ReadonlyArray<[string, string]> = [
  ['space U+0020', ' '],
  ['tilde U+007E', '~'],
  ['NBSP U+00A0', '\u00a0'],
  ['U+2027', '\u2027'],
  ['U+202F', '\u202f'],
  ['U+2065', '\u2065'],
  ['U+206A', '\u206a'],
  ['U+200A', '\u200a'],
  ['U+2010', '\u2010'],
  ['U+061B', '\u061b'],
  ['U+061D', '\u061d'],
  ['U+FEFE', '\ufefe'],
  ['U+FF00', '\uff00'],
  ['U+205F', '\u205f'],
  ['U+180D', '\u180d'],
  ['U+180F', '\u180f'],
  ['U+D7FF', '\ud7ff'],
  ['U+E000', '\ue000'],
  ['an astral character', ASTRAL],
];

/** Neither strings nor anything a check may coerce. */
const NON_STRINGS: ReadonlyArray<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['a number', 42],
  ['a boolean', true],
  ['a bigint', 1n],
  ['a symbol', Symbol('x')],
  ['an object', {}],
  ['an array of a valid value', ['C:\\sapcrypto.dll']],
  ['a boxed string', Object('C:\\sapcrypto.dll')],
  ['an object whose toString is valid', { toString: () => 'C:\\x.dll' }],
  ['a function', () => 'C:\\x.dll'],
  [
    'a Proxy whose every trap throws',
    new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
        getPrototypeOf() {
          throw new Error('trap');
        },
        has() {
          throw new Error('trap');
        },
      },
    ),
  ],
];

const CHECKS: ReadonlyArray<[string, Check, string]> = [
  ['admitLocalPath', admitLocalPath, 'C:\\sapcrypto.dll'],
  ['admitDocumentValue', admitDocumentValue, 'https://idp.example/'],
  ['admitAsciiDocumentValue', admitAsciiDocumentValue, '#_abc'],
  ['admitXmlName', admitXmlName, 'Response'],
  ['admitXmlId', admitXmlId, '_abc123'],
  ['admitDocumentTime', admitDocumentTime, '2026-10-05T10:00:00Z'],
  ['admitConfigUri', admitConfigUri, 'https://host.example/callback'],
];

describe('every check', () => {
  describe.each(CHECKS)('%s', (_name, run, valid) => {
    it('admits its valid value', () => {
      expect(run(valid)).toBe(valid);
    });

    it.each(NON_STRINGS)('drops %s, without throwing', (_label, value) => {
      expect(run(value)).toBeUndefined();
    });

    it('drops a revoked Proxy, without throwing', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(run(proxy)).toBeUndefined();
    });

    it('drops the empty string', () => {
      expect(run('')).toBeUndefined();
    });
  });
});

describe('LocalPath', () => {
  it.each(REFUSED)('drops a path holding %s', (_label, character) => {
    expect(
      admitLocalPath(`C:\\SAP\\${character}sapcrypto.dll`),
    ).toBeUndefined();
  });

  it.each(BOUNDARY_ADMITTED)(
    'admits a path holding %s, unchanged',
    (_label, character) => {
      const path = `C:\\SAP\\${character}sapcrypto.dll`;
      expect(admitLocalPath(path)).toBe(path);
    },
  );

  it('admits 1 and 1 024 code points, unchanged', () => {
    expect(admitLocalPath('a')).toBe('a');
    const longest = `/${'a'.repeat(1023)}`;
    expect(admitLocalPath(longest)).toBe(longest);
  });

  it('counts code points, not UTF-16 units: 1 024 astral characters are admitted', () => {
    const astral = ASTRAL.repeat(1024);
    expect(astral.length).toBe(2048);
    expect(admitLocalPath(astral)).toBe(astral);
  });

  it('drops 1 025 code points instead of truncating', () => {
    expect(admitLocalPath(`/${'a'.repeat(1024)}`)).toBeUndefined();
    expect(admitLocalPath(ASTRAL.repeat(1025))).toBeUndefined();
  });

  describe('RF4: SNC library paths as they occur on users’ machines', () => {
    it.each([
      'C:\\Users\\Олексій\\AppData\\Local\\SAP\\sapcrypto.dll',
      'C:\\Program Files (x86)\\SAP\\FrontEnd\\SecureLogin\\lib\\sapcrypto.dll',
      '\\\\server\\share\\sapcrypto.dll',
      '/Applications/Secure Login Client.app/Contents/MacOS/lib/libsapcrypto.dylib',
    ])('admits %s unchanged', (path) => {
      expect(admitLocalPath(path)).toBe(path);
    });

    it.each([
      [
        '\\r',
        'C:\\Program Files\\SAP\\FrontEnd\\SecureLogin\\lib\\sapcrypto.dll\r',
      ],
      [
        '\\r\\n',
        'C:\\Program Files\\SAP\\FrontEnd\\SecureLogin\\lib\\sapcrypto.dll\r\n',
      ],
    ])('drops an untrimmed registry value ending in %s', (_label, path) => {
      expect(admitLocalPath(path)).toBeUndefined();
    });
  });
});

describe('DocumentValue', () => {
  it.each(REFUSED)('drops a value holding %s', (_label, character) => {
    expect(
      admitDocumentValue(`https://idp${character}.example/`),
    ).toBeUndefined();
  });

  it.each(BOUNDARY_ADMITTED)(
    'admits a value holding %s, unchanged',
    (_label, character) => {
      const value = `https://idp${character}.example/`;
      expect(admitDocumentValue(value)).toBe(value);
    },
  );

  it('refuses a refused character beyond the cut, not only within it', () => {
    expect(admitDocumentValue(`${'a'.repeat(100)}\n`)).toBeUndefined();
  });

  it('keeps 64 code points unchanged', () => {
    const value = 'a'.repeat(64);
    expect(admitDocumentValue(value)).toBe(value);
  });

  it('cuts 65 code points to 64 and appends …', () => {
    expect(admitDocumentValue('b'.repeat(65))).toBe(
      `${'b'.repeat(64)}${ELLIPSIS}`,
    );
  });

  it('cuts at a code-point boundary: an astral 64th code point is kept whole', () => {
    const value = `${'a'.repeat(63)}${ASTRAL}bc`;
    expect(admitDocumentValue(value)).toBe(
      `${'a'.repeat(63)}${ASTRAL}${ELLIPSIS}`,
    );
  });

  it('cuts at a code-point boundary: an astral 65th code point is not split', () => {
    const value = `${'a'.repeat(64)}${ASTRAL}`;
    expect(admitDocumentValue(value)).toBe(`${'a'.repeat(64)}${ELLIPSIS}`);
  });

  it('counts code points: 64 astral characters are kept whole, 65 cut to 64', () => {
    expect(admitDocumentValue(ASTRAL.repeat(64))).toBe(ASTRAL.repeat(64));
    expect(admitDocumentValue(ASTRAL.repeat(65))).toBe(
      `${ASTRAL.repeat(64)}${ELLIPSIS}`,
    );
  });

  it('cuts a 10 000-character Destination to 64 code points and …', () => {
    const destination = `https://sp.example/${'x'.repeat(10_000 - 19)}`;
    expect(destination.length).toBe(10_000);
    const admitted = admitDocumentValue(destination);
    expect(admitted).toBe(`${destination.slice(0, 64)}${ELLIPSIS}`);
  });

  it('admits non-ASCII text', () => {
    expect(admitDocumentValue('Олексій')).toBe('Олексій');
  });
});

describe('DocumentValue, printable ASCII only (referenceUri, statusCode)', () => {
  it('admits every printable ASCII character', () => {
    const printable = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
      String.fromCharCode(0x21 + i),
    ).join('');
    expect(printable.length).toBe(94);
    expect(admitAsciiDocumentValue(printable.slice(0, 64))).toBe(
      printable.slice(0, 64),
    );
    expect(admitAsciiDocumentValue(printable.slice(30))).toBe(
      printable.slice(30),
    );
  });

  it.each([
    ['a space', '#_a b'],
    ['a non-ASCII letter', '#_é'],
    ['NBSP', '#_\u00a0'],
    ['an astral character', `#_${ASTRAL}`],
    ['DEL', '#_\u007f'],
    ['a newline', '#_a\n'],
  ])('drops a value holding %s', (_label, value) => {
    expect(admitAsciiDocumentValue(value)).toBeUndefined();
  });

  it.each(REFUSED)('drops a value holding %s', (_label, character) => {
    expect(admitAsciiDocumentValue(`#_a${character}`)).toBeUndefined();
  });

  it('cuts 65 characters to 64 and appends …', () => {
    expect(admitAsciiDocumentValue(`#${'a'.repeat(64)}`)).toBe(
      `#${'a'.repeat(63)}${ELLIPSIS}`,
    );
  });
});

describe('XmlName', () => {
  it.each([
    'Response',
    'Assertion',
    '_x',
    'a',
    'saml2p.Response-1_x',
    `a${'b'.repeat(63)}`,
  ])('admits %s unchanged', (name) => {
    expect(admitXmlName(name)).toBe(name);
  });

  it.each([
    ['a leading digit', '1Response'],
    ['a leading dot', '.Response'],
    ['a leading hyphen', '-Response'],
    ['a colon (a prefixed name, not a localName)', 'samlp:Response'],
    ['a space', 'Res ponse'],
    ['a quote', 'Res"ponse'],
    ['a non-ASCII letter', 'Rëspónse'],
    ['a trailing newline', 'Response\n'],
    ['65 characters', `a${'b'.repeat(64)}`],
  ])('drops a name with %s', (_label, name) => {
    expect(admitXmlName(name)).toBeUndefined();
  });
});

describe('XmlId', () => {
  it.each(['_abc123', 'id-1.2_x', 'A'])('admits %s unchanged', (id) => {
    expect(admitXmlId(id)).toBe(id);
  });

  it('cuts a long ID like DocumentValue: 64 characters and …', () => {
    const id = `_${'a'.repeat(99)}`;
    expect(admitXmlId(id)).toBe(`${id.slice(0, 64)}${ELLIPSIS}`);
  });

  it('keeps a 64-character ID unchanged', () => {
    const id = `_${'a'.repeat(63)}`;
    expect(admitXmlId(id)).toBe(id);
  });

  it.each([
    ['a leading digit', '1abc'],
    ['a quote', '_a"b'],
    ['a colon', '_a:b'],
    ['a space', '_a b'],
    ['a newline', '_a\nb'],
    ['a non-ASCII letter', '_é'],
    ['a refused character beyond the cut', `_${'a'.repeat(80)}\n`],
  ])('drops an ID with %s', (_label, id) => {
    expect(admitXmlId(id)).toBeUndefined();
  });
});

describe('DocumentTime', () => {
  it.each([
    '2026-10-05T10:00:00Z',
    '2026-10-05T10:00:00.123+02:00',
    '2026-13-45T99:99:99',
    'x'.repeat(40),
  ])('admits %s unchanged (a shape, not a valid time)', (time) => {
    expect(admitDocumentTime(time)).toBe(time);
  });

  it.each([
    ['a quote', '2026-10-05T10:00:00Z"'],
    ['a space', '2026-10-05 10:00:00Z'],
    ['a newline', '2026-10-05T10:00:00Z\n'],
    ['a slash', '2026/10/05'],
    ['41 characters', 'x'.repeat(41)],
    ['a non-ASCII digit', '２０２６'],
  ])('drops a time with %s', (_label, time) => {
    expect(admitDocumentTime(time)).toBeUndefined();
  });
});

describe('ConfigUri', () => {
  it('admits origin + pathname only: the query and fragment are not kept', () => {
    expect(
      admitConfigUri('https://host.example:8443/callback?code=SECRET#frag'),
    ).toBe('https://host.example:8443/callback');
  });

  it('admits http: on loopback', () => {
    expect(admitConfigUri('http://localhost:61001/callback')).toBe(
      'http://localhost:61001/callback',
    );
  });

  it('answers the parsed form: scheme and host lower-cased, a bare origin with /', () => {
    expect(admitConfigUri('HTTPS://Host.Example/Path')).toBe(
      'https://host.example/Path',
    );
    expect(admitConfigUri('https://host.example')).toBe(
      'https://host.example/',
    );
  });

  it.each([
    ['a username', 'https://user@host.example/callback'],
    ['a username and password', 'https://user:SECRET@host.example/callback'],
    ['a password only', 'https://:SECRET@host.example/callback'],
    ['javascript:', 'javascript:alert(1)'],
    ['ftp:', 'ftp://host.example/callback'],
    ['file:', 'file:///etc/passwd'],
    ['data:', 'data:text/html,x'],
    ['no scheme', 'host.example/callback'],
    ['not a URL', 'not a url'],
  ])('drops a URI with %s', (_label, uri) => {
    expect(admitConfigUri(uri)).toBeUndefined();
  });

  it('keeps no part of a userinfo or a query', () => {
    for (const uri of [
      'https://user:SECRET@host.example/cb',
      'https://host.example/cb?token=SECRET',
      'https://host.example/cb#SECRET',
    ]) {
      expect(String(admitConfigUri(uri))).not.toContain('SECRET');
    }
  });

  it('admits origin + pathname of 512 characters, drops 513 instead of truncating', () => {
    const origin = 'https://host.example';
    const at512 = `${origin}/${'p'.repeat(512 - origin.length - 1)}`;
    expect(at512.length).toBe(512);
    expect(admitConfigUri(at512)).toBe(at512);
    expect(admitConfigUri(`${at512}p`)).toBeUndefined();
  });

  it('measures the admitted form: a long query does not count', () => {
    const uri = `https://host.example/cb?${'q'.repeat(1000)}`;
    expect(admitConfigUri(uri)).toBe('https://host.example/cb');
  });
});

/** An input object whose `field` getter throws. */
function throwingGetter(field: string): object {
  return Object.defineProperty({}, field, {
    enumerable: true,
    get() {
      throw new Error('getter');
    },
  });
}

/** A Proxy whose every trap throws. */
function hostileProxy(): object {
  const fail = () => {
    throw new Error('trap');
  };
  return new Proxy(
    {},
    {
      get: fail,
      has: fail,
      ownKeys: fail,
      getOwnPropertyDescriptor: fail,
      getPrototypeOf: fail,
    },
  );
}

/** A valid value for every SAML diagnostic field. */
const SAML_VALID = {
  rootElement: 'Response',
  id: '_dup',
  referenceUri: '#_abc',
  statusCode: 'urn:example:status:Custom',
  issuer: 'https://idp.example/',
  notBefore: '2026-13-45T00:00:00Z',
  notOnOrAfter: '2026-13-45T00:00:00Z',
  destination: 'https://sp.example/acs',
} as const;

describe('admitSamlDiagnostics: keyed by SAML_RULE_DIAGNOSTIC', () => {
  it.each(ASSERTION_RULES.map((rule) => [rule]))(
    '%s keeps exactly its one field from the map, every other dropped',
    (rule) => {
      const field = SAML_RULE_DIAGNOSTIC[rule];
      const admitted = admitSamlDiagnostics(rule, { ...SAML_VALID });
      if (field === null) {
        expect(admitted).toBeUndefined();
      } else {
        expect(admitted).toStrictEqual({ [field]: SAML_VALID[field] });
      }
    },
  );

  it('admits the issuer of untrusted-issuer, frozen', () => {
    const admitted = admitSamlDiagnostics('untrusted-issuer', {
      issuer: 'https://idp.example/',
    });
    expect(admitted).toStrictEqual({ issuer: 'https://idp.example/' });
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it('drops a forbidden field passed by a JavaScript caller', () => {
    expect(
      admitSamlDiagnostics('untrusted-issuer', {
        destination: 'https://sp.example/acs',
      }),
    ).toBeUndefined();
  });

  it('drops an Issuer whose &#10; decoded to a newline (a forged log line)', () => {
    expect(
      admitSamlDiagnostics('untrusted-issuer', {
        issuer: 'https://idp.example/\nINFO login succeeded for admin',
      }),
    ).toBeUndefined();
  });

  it('cuts a 10 000-character Destination', () => {
    const destination = `https://sp.example/${'x'.repeat(9_981)}`;
    expect(
      admitSamlDiagnostics('destination-not-us', { destination }),
    ).toStrictEqual({
      destination: `${destination.slice(0, 64)}${ELLIPSIS}`,
    });
  });

  it('drops an xsd:dateTime holding a quote', () => {
    expect(
      admitSamlDiagnostics('not-before-invalid', {
        notBefore: '2026-10-05T10:00:00Z"',
      }),
    ).toBeUndefined();
    expect(
      admitSamlDiagnostics('not-on-or-after-invalid', {
        notOnOrAfter: '"2026',
      }),
    ).toBeUndefined();
  });

  it('drops a referenceUri holding a space', () => {
    expect(
      admitSamlDiagnostics('reference-not-found', { referenceUri: '#_a b' }),
    ).toBeUndefined();
  });

  it('drops a statusCode holding a non-ASCII character', () => {
    expect(
      admitSamlDiagnostics('declined', { statusCode: 'urn:é' }),
    ).toBeUndefined();
  });

  it('drops a value behind a throwing getter, without throwing', () => {
    expect(
      admitSamlDiagnostics('untrusted-issuer', throwingGetter('issuer')),
    ).toBeUndefined();
  });

  it('reads a getter as absent, even one that answers a valid value', () => {
    const input = Object.defineProperty({}, 'issuer', {
      enumerable: true,
      get: () => 'https://idp.example/',
    });
    expect(admitSamlDiagnostics('untrusted-issuer', input)).toBeUndefined();
  });

  it('reads an inherited field as absent', () => {
    const input = Object.create({ issuer: 'https://idp.example/' });
    expect(admitSamlDiagnostics('untrusted-issuer', input)).toBeUndefined();
  });

  it('drops everything from a Proxy whose every trap throws, or a revoked one', () => {
    expect(
      admitSamlDiagnostics('untrusted-issuer', hostileProxy()),
    ).toBeUndefined();
    const { proxy, revoke } = Proxy.revocable(
      { issuer: 'https://idp.example/' },
      {},
    );
    revoke();
    expect(admitSamlDiagnostics('untrusted-issuer', proxy)).toBeUndefined();
  });

  it.each([
    ['an unknown rule', 'made-up-rule'],
    ['__proto__', '__proto__'],
    ['constructor', 'constructor'],
    ['a non-string', 42],
  ])('admits nothing for %s', (_label, rule) => {
    expect(admitSamlDiagnostics(rule, { ...SAML_VALID })).toBeUndefined();
  });

  it.each(NON_STRINGS)(
    'admits nothing from %s as the input',
    (_label, input) => {
      expect(admitSamlDiagnostics('untrusted-issuer', input)).toBeUndefined();
    },
  );
});

const PATH_A =
  'C:\\Program Files (x86)\\SAP\\FrontEnd\\SecureLogin\\lib\\sapcrypto.dll';
const PATH_B = '/usr/lib/libsapcrypto.so';

describe('admitSncDiagnostics: keyed by SNC_PROBLEM_DIAGNOSTICS', () => {
  it.each(SNC_PROBLEMS.map((problem) => [problem]))(
    '%s keeps exactly its fields from the map',
    (problem) => {
      const fields: readonly string[] = SNC_PROBLEM_DIAGNOSTICS[problem];
      const admitted = admitSncDiagnostics(
        problem,
        { library: PATH_A, candidatePaths: [PATH_A, PATH_B] },
        2,
      );
      const expected: Record<string, unknown> = {};
      if (fields.includes('library')) expected.library = PATH_A;
      if (fields.includes('candidatePaths'))
        expected.candidatePaths = [PATH_A, PATH_B];
      if (fields.length === 0) {
        expect(admitted).toBeUndefined();
      } else {
        expect(admitted).toStrictEqual(expected);
      }
    },
  );

  it('admits the library of no-credential, frozen', () => {
    const admitted = admitSncDiagnostics(
      'no-credential',
      { library: PATH_A },
      0,
    );
    expect(admitted).toStrictEqual({ library: PATH_A });
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it('drops a library ending in \\r', () => {
    expect(
      admitSncDiagnostics('no-credential', { library: `${PATH_A}\r` }, 0),
    ).toBeUndefined();
  });

  it('keeps candidatePaths aligned: a dropped path becomes null, the array frozen', () => {
    const admitted = admitSncDiagnostics(
      'library-not-found',
      { candidatePaths: [PATH_A, `${PATH_B}\r\n`, 42, PATH_B] },
      4,
    ) as { candidatePaths: unknown[] };
    expect(admitted).toStrictEqual({
      candidatePaths: [PATH_A, null, null, PATH_B],
    });
    expect(Object.isFrozen(admitted.candidatePaths)).toBe(true);
  });

  it('aligns to the candidate count: a longer array is cut, a shorter one padded with null', () => {
    expect(
      admitSncDiagnostics(
        'library-not-found',
        { candidatePaths: [PATH_A, PATH_B, PATH_A] },
        2,
      ),
    ).toStrictEqual({ candidatePaths: [PATH_A, PATH_B] });
    expect(
      admitSncDiagnostics('library-not-found', { candidatePaths: [PATH_A] }, 3),
    ).toStrictEqual({ candidatePaths: [PATH_A, null, null] });
  });

  it('keeps candidatePaths of all-null paths: the alignment is the information', () => {
    expect(
      admitSncDiagnostics(
        'library-not-found',
        { candidatePaths: ['\n', ''] },
        2,
      ),
    ).toStrictEqual({ candidatePaths: [null, null] });
  });

  it.each([
    ['zero candidates', 0],
    ['a negative count', -1],
    ['more than eight', 9],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['a string', '2'],
  ])('admits no candidatePaths for %s', (_label, candidateCount) => {
    expect(
      admitSncDiagnostics(
        'library-not-found',
        { candidatePaths: [PATH_A, PATH_B] },
        candidateCount,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['a string', PATH_A],
    ['an object', { 0: PATH_A, length: 1 }],
    [
      'a revoked Proxy',
      (() => {
        const { proxy, revoke } = Proxy.revocable([PATH_A], {});
        revoke();
        return proxy;
      })(),
    ],
  ])('admits no candidatePaths from %s', (_label, candidatePaths) => {
    expect(
      admitSncDiagnostics('library-not-found', { candidatePaths }, 1),
    ).toBeUndefined();
  });

  it('reads a throwing element as null, an array behind a throwing getter as absent', () => {
    const paths = [PATH_A, PATH_B];
    Object.defineProperty(paths, 1, {
      get() {
        throw new Error('getter');
      },
    });
    expect(
      admitSncDiagnostics('library-not-found', { candidatePaths: paths }, 2),
    ).toStrictEqual({ candidatePaths: [PATH_A, null] });
    expect(
      admitSncDiagnostics(
        'library-not-found',
        throwingGetter('candidatePaths'),
        2,
      ),
    ).toBeUndefined();
  });

  it('reads an array Proxy whose traps throw as all null', () => {
    const fail = () => {
      throw new Error('trap');
    };
    const proxy = new Proxy([PATH_A], {
      get: fail,
      getOwnPropertyDescriptor: fail,
    });
    expect(
      admitSncDiagnostics('library-not-found', { candidatePaths: proxy }, 1),
    ).toStrictEqual({ candidatePaths: [null] });
  });

  it('drops library on library-not-found and candidatePaths on no-credential', () => {
    expect(
      admitSncDiagnostics('library-not-found', { library: PATH_A }, 0),
    ).toBeUndefined();
    expect(
      admitSncDiagnostics('no-credential', { candidatePaths: [PATH_A] }, 1),
    ).toBeUndefined();
  });

  it.each([
    ['an unknown problem', 'made-up'],
    ['__proto__', '__proto__'],
  ])('admits nothing for %s', (_label, problem) => {
    expect(
      admitSncDiagnostics(problem, { library: PATH_A }, 0),
    ).toBeUndefined();
  });
});

describe('admitConfigDiagnostics: keyed by CONFIG_CASE_DIAGNOSTICS', () => {
  const INPUT = {
    configuredUri: 'https://sp.example/acs?x=1',
    strategyUri: 'http://localhost:61001/callback',
  };

  it.each(CONFIG_CASES.map((configCase) => [configCase]))(
    '%s keeps exactly its fields from the map',
    (configCase) => {
      const fields: readonly string[] = CONFIG_CASE_DIAGNOSTICS[configCase];
      const admitted = admitConfigDiagnostics(configCase, { ...INPUT });
      if (fields.length === 0) {
        expect(admitted).toBeUndefined();
      } else {
        expect(admitted).toStrictEqual({
          configuredUri: 'https://sp.example/acs',
          strategyUri: 'http://localhost:61001/callback',
        });
        expect(Object.isFrozen(admitted)).toBe(true);
      }
    },
  );

  it('keeps the admitted field when the other is dropped', () => {
    expect(
      admitConfigDiagnostics('redirect-mismatch', {
        configuredUri: 'https://user:SECRET@host.example/cb',
        strategyUri: 'http://localhost:61001/callback',
      }),
    ).toStrictEqual({ strategyUri: 'http://localhost:61001/callback' });
  });

  it('drops a value behind a throwing getter and keeps the other', () => {
    const input = Object.defineProperty(
      { strategyUri: 'http://localhost:61001/callback' },
      'configuredUri',
      {
        enumerable: true,
        get() {
          throw new Error('getter');
        },
      },
    );
    expect(admitConfigDiagnostics('saml-acs-mismatch', input)).toStrictEqual({
      strategyUri: 'http://localhost:61001/callback',
    });
  });

  it('admits nothing for an unknown case or a hostile input', () => {
    expect(admitConfigDiagnostics('made-up', { ...INPUT })).toBeUndefined();
    expect(
      admitConfigDiagnostics('redirect-mismatch', hostileProxy()),
    ).toBeUndefined();
  });
});
