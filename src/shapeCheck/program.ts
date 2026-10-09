import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type * as ts from 'typescript';
import { type CheckedOptions, fail } from './options';
import type { ShapeFinding, ShapeRule } from './types';

export const INTERFACES_AUTH = '@mcp-abap-adt/interfaces-auth';
export const AUTH_ERRORS = '@mcp-abap-adt/auth-errors';
/** The brands of interfaces-auth: unexported unique symbols, by declared name. */
export const ERROR_BRAND = 'minted';
/** Rule 4's overloads: an error, a refusal, an outcome or a failure. */
export const ERROR_BRANDS: ReadonlySet<string> = new Set([ERROR_BRAND]);
export const BRANDS: ReadonlySet<string> = new Set([
  ERROR_BRAND,
  'httpStatusBrand',
  'countBrand',
  'portBrand',
]);

// ---------------------------------------------------------------- sites

/** An entry of assertion-sites.json. */
export interface AssertionSite {
  readonly file: string;
  readonly function: string;
}

/** An entry of diagnostic-sites.json. */
export interface DiagnosticSite extends AssertionSite {
  readonly field: string;
}

export interface Sites {
  readonly assertions: readonly AssertionSite[];
  readonly diagnostics: readonly DiagnosticSite[];
}

/**
 * A site list: a JSON array of entries holding a string under each of
 * `keys`. A list missing from its directory is an empty one, and so is
 * every list when there is no directory.
 */
function readSites<Entry>(
  dir: string | null,
  name: string,
  keys: readonly string[],
): readonly Entry[] {
  if (dir === null) return [];
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  let list: unknown;
  try {
    list = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${path} is not JSON`);
  }
  if (!Array.isArray(list)) fail(`${path} is not an array`);
  for (const entry of list as readonly unknown[]) {
    for (const key of keys) {
      const value =
        entry === null || entry === undefined
          ? undefined
          : (entry as Readonly<Record<string, unknown>>)[key];
      if (typeof value !== 'string')
        fail(`${path}: every entry needs a string ${key}`);
    }
  }
  return list as readonly Entry[];
}

export function readSiteLists(sites: string | null): Sites {
  return {
    assertions: readSites<AssertionSite>(sites, 'assertion-sites.json', [
      'file',
      'function',
    ]),
    diagnostics: readSites<DiagnosticSite>(sites, 'diagnostic-sites.json', [
      'file',
      'function',
      'field',
    ]),
  };
}

// ---------------------------------------------------------------- program

function strictDefaults(typescript: typeof ts): ts.CompilerOptions {
  return {
    strict: true,
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.Node16,
    moduleResolution: typescript.ModuleResolutionKind.Node16,
    esModuleInterop: true,
    skipLibCheck: true,
  };
}

function isTestPath(path: string): boolean {
  return (
    /(^|\/)(__tests__|__typechecks__|__fixtures__|__mocks__)\//.test(path) ||
    /\.(test|spec)\.[cm]?tsx?$/.test(path) ||
    /\.d\.[cm]?ts$/.test(path)
  );
}

export function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

/** Diagnostics are written relative to the root, one per line. */
function formatHost(root: string): ts.FormatDiagnosticsHost {
  return {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  };
}

function resolveModule(
  typescript: typeof ts,
  name: string,
  root: string,
  compilerOptions: ts.CompilerOptions,
): string | undefined {
  const resolved = typescript.resolveModuleName(
    name,
    join(root, '__shape-check__.ts'),
    compilerOptions,
    typescript.sys,
  ).resolvedModule;
  return resolved?.resolvedFileName;
}

/** The base's module: a path relative to the root, or a package specifier. */
function resolveBase(
  typescript: typeof ts,
  module: string,
  root: string,
  compilerOptions: ts.CompilerOptions,
): string | undefined {
  if (module.startsWith('./') || module.startsWith('../')) {
    const plain = resolve(root, module);
    const stem = plain.replace(/\.[cm]?js$/, '');
    const candidates = [
      plain,
      ...['.ts', '.tsx', '.mts', '.cts', '.d.ts'].map((ext) => stem + ext),
      join(plain, 'index.ts'),
      join(plain, 'index.d.ts'),
    ];
    return candidates.find(
      (file) => existsSync(file) && statSync(file).isFile(),
    );
  }
  return resolveModule(typescript, module, root, compilerOptions);
}

// ---------------------------------------------------------------- packages

/** The nearest package.json above a file: its name and its directory. */
export interface PackageInfo {
  readonly name: string | undefined;
  readonly dir: string;
}

/**
 * `packageOf` over a cache of its own: one per check, so a check decides on
 * the manifests as they are when it runs, not as an earlier check saw them.
 */
function packageLookup(): (file: string) => PackageInfo {
  const packageCache = new Map<string, PackageInfo>();
  return (file) => {
    let dir = dirname(file);
    const visited: string[] = [];
    while (true) {
      const cached = packageCache.get(dir);
      if (cached !== undefined) {
        for (const seen of visited) packageCache.set(seen, cached);
        return cached;
      }
      visited.push(dir);
      const manifest = join(dir, 'package.json');
      if (existsSync(manifest)) {
        let name: unknown;
        try {
          name = (
            JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }
          ).name;
        } catch {
          name = undefined;
        }
        const found: PackageInfo = {
          name: typeof name === 'string' ? name : undefined,
          dir,
        };
        for (const seen of visited) packageCache.set(seen, found);
        return found;
      }
      const parent = dirname(dir);
      if (parent === dir) {
        const none: PackageInfo = { name: undefined, dir };
        for (const seen of visited) packageCache.set(seen, none);
        return none;
      }
      dir = parent;
    }
  };
}

/**
 * Rules 4 and 5 recognise the contract's types by the brands interfaces-auth
 * declares; without every brand they would pass in silence (an
 * interfaces-auth before 6.0.0, a brand renamed), so the check refuses.
 */
function requireBrands(
  typescript: typeof ts,
  program: ts.Program,
  packageOf: (file: string) => PackageInfo,
): void {
  const found = new Set<string>();
  for (const source of program.getSourceFiles()) {
    if (packageOf(source.fileName).name !== INTERFACES_AUTH) continue;
    for (const statement of source.statements) {
      if (!typescript.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (
          typescript.isIdentifier(declaration.name) &&
          BRANDS.has(declaration.name.text) &&
          declaration.type !== undefined &&
          typescript.isTypeOperatorNode(declaration.type) &&
          declaration.type.operator === typescript.SyntaxKind.UniqueKeyword
        ) {
          found.add(declaration.name.text);
        }
      }
    }
  }
  const missing = [...BRANDS].filter((brand) => !found.has(brand));
  if (missing.length > 0) {
    fail(
      `rules 4 and 5 need the brands of ${INTERFACES_AUTH} 6.0.0 or later; not found: ${missing.join(', ')}`,
    );
  }
}

interface LoadedProgram {
  readonly status: 'loaded';
  readonly program: ts.Program;
  readonly sources: readonly ts.SourceFile[];
  readonly contract: string | undefined;
  readonly baseFile: string | undefined;
  readonly packageOf: (file: string) => PackageInfo;
}

interface TypeErrors {
  readonly status: 'type-errors';
  readonly diagnostics: string;
}

/**
 * The program the rules read: the project's (or, without one, the strict
 * defaults over `<root>/src`), its files to check, the base and
 * interfaces-auth beside them. The rules read types, so a program that does
 * not type-check is not checked. Paths are absolute, and the root stands
 * for the working directory wherever the compiler asks for one.
 */
function loadProgram(options: CheckedOptions): LoadedProgram | TypeErrors {
  const { ts: typescript, root } = options;
  let compilerOptions = strictDefaults(typescript);
  let projectFiles: readonly string[] = [];
  if (options.project !== null) {
    const parsed = typescript.getParsedCommandLineOfConfigFile(
      options.project,
      {},
      {
        ...typescript.sys,
        getCurrentDirectory: () => root,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
          fail(
            typescript.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n',
            ),
          ),
      },
    );
    if (parsed === undefined) fail(`cannot read ${options.project}`);
    if (parsed.errors.length > 0) {
      fail(typescript.formatDiagnostics(parsed.errors, formatHost(root)));
    }
    compilerOptions = parsed.options;
    projectFiles = parsed.fileNames;
  } else if (options.files.length === 0) {
    projectFiles = typescript.sys.readDirectory(join(root, 'src'), [
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
    ]);
  }
  const checked = (options.files.length > 0 ? options.files : projectFiles)
    .map((file) => resolve(file))
    .filter((file) => {
      if (options.files.length > 0) return true;
      const path = rel(root, file);
      return path.startsWith('src/') && !isTestPath(path);
    });
  for (const file of options.files) {
    if (!existsSync(file)) fail(`no such file: ${file}`);
  }
  if (checked.length === 0) {
    fail(`no file to check under ${join(root, 'src')}`);
  }
  const roots = [...checked];
  let baseFile: string | undefined;
  if (options.base !== undefined) {
    baseFile = resolveBase(
      typescript,
      options.base.module,
      root,
      compilerOptions,
    );
    if (baseFile === undefined) {
      fail(`--base: ${options.base.module} does not resolve from ${root}`);
    }
    roots.push(baseFile);
  }
  const contract = resolveModule(
    typescript,
    INTERFACES_AUTH,
    root,
    compilerOptions,
  );
  if (contract !== undefined) roots.push(contract);
  const { tsBuildInfoFile: _noBuildInfo, ...programOptions } = compilerOptions;
  const finalOptions: ts.CompilerOptions = {
    ...programOptions,
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
  };
  const host = typescript.createCompilerHost(finalOptions);
  host.getCurrentDirectory = () => root;
  const program = typescript.createProgram(roots, finalOptions, host);
  const sources = checked
    .map((file) => program.getSourceFile(file))
    .filter((source) => source !== undefined);
  const diagnostics = sources.flatMap((source) => [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ]);
  if (diagnostics.length > 0) {
    return {
      status: 'type-errors',
      diagnostics: typescript.formatDiagnostics(diagnostics, formatHost(root)),
    };
  }
  if (sources.length !== checked.length)
    fail('a file to check is not in the program');
  const packageOf = packageLookup();
  if (options.rules.has(4) || options.rules.has(5)) {
    requireBrands(typescript, program, packageOf);
  }
  return { status: 'loaded', program, sources, contract, baseFile, packageOf };
}

// ---------------------------------------------------------------- context

/** What every rule reads, and where it reports. */
export interface RuleContext {
  readonly ts: typeof ts;
  readonly options: CheckedOptions;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  /** The files to check, in the program. */
  readonly sources: readonly ts.SourceFile[];
  readonly sites: Sites;
  /** The brands of interfaces-auth the rules recognise the contract by. */
  readonly brands: ReadonlySet<string>;
  readonly errorBrands: ReadonlySet<string>;
  /** interfaces-auth's entry, when it resolves from the root. */
  readonly contractFile: string | undefined;
  /** The contract's IAuthProvider, for rules 1 and 3. */
  readonly providerType: ts.Type | undefined;
  /** The base's file and its class declarations, for rules 1–3. */
  readonly baseFile: string | undefined;
  readonly baseDeclarations: ReadonlySet<ts.ClassDeclaration>;
  /** The nearest package.json above a file, cached for this check only. */
  readonly packageOf: (file: string) => PackageInfo;
  readonly findings: readonly ShapeFinding[];
  report(node: ts.Node, rule: ShapeRule, what: string): void;
}

/**
 * The program loaded and the contract's IAuthProvider and the base found in
 * it, or why the check cannot run: a usage error is thrown through `fail`,
 * a program that does not type-check is returned.
 */
export function createContext(
  options: CheckedOptions,
): RuleContext | TypeErrors {
  const typescript = options.ts;
  const sites = readSiteLists(options.sites);
  const loaded = loadProgram(options);
  if (loaded.status === 'type-errors') return loaded;
  const { program, sources, contract, baseFile, packageOf } = loaded;
  const checker = program.getTypeChecker();
  const findings: ShapeFinding[] = [];

  function report(node: ts.Node, rule: ShapeRule, what: string): void {
    const source = node.getSourceFile();
    const { line, character } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    findings.push({
      file: rel(options.root, source.fileName),
      line: line + 1,
      column: character + 1,
      rule,
      what,
    });
  }

  // The contract's IAuthProvider, for rules 1 and 3.
  let providerType: ts.Type | undefined;
  if (contract !== undefined) {
    const source = program.getSourceFile(contract);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported =
      moduleSymbol &&
      checker
        .getExportsOfModule(moduleSymbol)
        .find((symbol) => symbol.name === 'IAuthProvider');
    if (exported !== undefined) {
      const target =
        exported.flags & typescript.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      providerType = checker.getDeclaredTypeOfSymbol(target);
    }
  }
  if (
    providerType === undefined &&
    (options.rules.has(1) || options.rules.has(3))
  ) {
    fail(
      `rules 1 and 3 need ${INTERFACES_AUTH}, which does not resolve from ${options.root}`,
    );
  }

  // The base, by declaration (rules 1–3).
  const baseDeclarations = new Set<ts.ClassDeclaration>();
  if (baseFile !== undefined && options.base !== undefined) {
    const { spec, name } = options.base;
    const source = program.getSourceFile(baseFile);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) fail(`--base: ${spec} is not a module`);
    let exported = checker
      .getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.name === name);
    if (exported === undefined) fail(`--base: ${spec} exports no ${name}`);
    if (exported.flags & typescript.SymbolFlags.Alias) {
      exported = checker.getAliasedSymbol(exported);
    }
    for (const declaration of exported.declarations ?? []) {
      if (typescript.isClassDeclaration(declaration)) {
        baseDeclarations.add(declaration);
      }
    }
    if (baseDeclarations.size === 0) {
      fail(`--base: ${name} of ${spec} is not a class`);
    }
  }

  return {
    ts: typescript,
    options,
    program,
    checker,
    sources,
    sites,
    brands: BRANDS,
    errorBrands: ERROR_BRANDS,
    contractFile: contract,
    providerType,
    baseFile,
    baseDeclarations,
    packageOf,
    findings,
    report,
  };
}
