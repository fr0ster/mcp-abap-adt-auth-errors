#!/usr/bin/env node
/**
 * The shape check of the MCP ABAP ADT authentication error contract (spec
 * §8.2): the rules TypeScript alone cannot express, decided on the
 * TypeScript compiler API, which needs type information Biome does not have.
 *
 * Canonical copy: `@mcp-abap-adt/auth-errors` publishes this file as it is;
 * every repository that runs it keeps a byte-identical copy in its `tools/`,
 * with a test comparing the two (Decision D4). No dependency but
 * `typescript`, which every repository running it has as a devDependency.
 *
 *   node tools/check-provider-shape.mjs --rules 4,5,6
 *     [--root <dir>]       the repository root (default: the working directory)
 *     [--project <file>]   its tsconfig (default: <root>/tsconfig.json)
 *     [--sites <dir>]      where assertion-sites.json and
 *                          diagnostic-sites.json live (default: <root>/tools)
 *     [files…]             check these files instead of the project's
 *
 * Without files it checks every file of the project under `<root>/src`,
 * outside tests (`__tests__`, `__typechecks__`, `__fixtures__`, `__mocks__`,
 * `*.test.ts`, `*.spec.ts`) and declarations. Each finding is one line on
 * stdout, `<file>:<line>:<column>: rule <n>: <what>`, the file relative to
 * the root. Exit 0: nothing found; 1: findings; 2: a usage error, or a
 * program that does not type-check (the rules read types, so they are not
 * decided on a broken program), reported on stderr.
 *
 * The rules (§8.2), each selected by its number:
 *   1  a class that implements IAuthProvider, other than AuthProviderBase —
 *      by an `implements` clause, or structurally (its instances satisfy
 *      IAuthProvider) without reaching AuthProviderBase;
 *   2  a class reaching AuthProviderBase that declares, or assigns to `this`,
 *      a member named prepare, establish, authorize or rejected;
 *   3  an object literal that satisfies IAuthProvider;
 *   4  a type assertion whose target is or contains an error, a refusal, an
 *      outcome, a failure or a branded integer of the contract, outside the
 *      sites of assertion-sites.json; an overload signature (or a body-less
 *      `declare function`) whose return type is or contains an error, a
 *      refusal, an outcome or a failure, outside auth-errors' own builders.ts
 *      and mint.ts (an overload is a cast in disguise);
 *   5  an object spread, or an `Object.assign` argument, typed as an error;
 *   6  a builder call with a diagnostics argument whose fields are not each
 *      listed, for that file and function, in diagnostic-sites.json; a
 *      builder reached through call / apply / bind;
 *   7  a `guard` call whose grant is not a function expression, whose
 *      arguments are spread, or whose argument list reads `this` (outside
 *      a function expression) other than `this.#moments`; `guard` reached
 *      through call / apply / bind;
 *   8  in src/auth and src/providers: a `Basic ` authorization value, or a
 *      base64 encoding of a value built from a client secret, outside
 *      `legacyBasic` (src/auth/tokenRequest.ts) and `clientSecretBasic`
 *      (src/clientAuthentication/clientSecret.ts).
 *
 * A site list is a JSON array: assertion-sites.json of `{ file, function }`,
 * diagnostic-sites.json of `{ file, function, field }`, `file` relative to the
 * root. A missing list is an empty one. The function of a node is the
 * nearest enclosing named function: a function declaration, a method, an
 * accessor, or a function expression or arrow assigned to a variable or a
 * property.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const USAGE =
  'usage: check-provider-shape.mjs --rules <n,…> [--root <dir>] [--project <tsconfig>] [--sites <dir>] [files…]';
const KNOWN_RULES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
const INTERFACES_AUTH = '@mcp-abap-adt/interfaces-auth';
const AUTH_ERRORS = '@mcp-abap-adt/auth-errors';
const MOMENTS = new Set(['prepare', 'establish', 'authorize', 'rejected']);
const BASE = 'AuthProviderBase';
/** The brands of interfaces-auth: unexported unique symbols, by declared name. */
const ERROR_BRAND = 'minted';
/** Rule 4's overloads: an error, a refusal, an outcome or a failure (§8.2). */
const ERROR_BRANDS = new Set([ERROR_BRAND]);
const BRANDS = new Set([
  ERROR_BRAND,
  'httpStatusBrand',
  'countBrand',
  'portBrand',
]);
/** Rule 4: the files of auth-errors whose overloads are the builders' own. */
const OVERLOAD_FILES = new Set(['src/builders.ts', 'src/mint.ts']);
/** Rule 8: where it applies, and its two sites. */
const BASIC_SCOPE = ['src/auth/', 'src/providers/'];
const BASIC_SITES = [
  { file: 'src/auth/tokenRequest.ts', function: 'legacyBasic' },
  {
    file: 'src/clientAuthentication/clientSecret.ts',
    function: 'clientSecretBasic',
  },
];
const MAX_DEPTH = 8;

// ---------------------------------------------------------------- arguments

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const options = { files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === '--rules' ||
      arg === '--root' ||
      arg === '--project' ||
      arg === '--sites'
    ) {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      options[arg.slice(2)] = value;
      i += 1;
    } else if (arg.startsWith('--')) {
      fail(`unknown option ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.rules === undefined) fail('--rules is required');
  const rules = new Set();
  for (const part of options.rules.split(',')) {
    const rule = Number(part.trim());
    if (!KNOWN_RULES.has(rule)) fail(`unknown rule ${part}`);
    rules.add(rule);
  }
  const root = resolve(options.root ?? process.cwd());
  return {
    rules,
    root,
    project: resolve(options.project ?? join(root, 'tsconfig.json')),
    sites: resolve(options.sites ?? join(root, 'tools')),
    files: options.files.map((file) => resolve(file)),
  };
}

function readSites(dir, name, keys) {
  const path = join(dir, name);
  if (!existsSync(path)) return [];
  let list;
  try {
    list = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`${path} is not JSON`);
  }
  if (!Array.isArray(list)) fail(`${path} is not an array`);
  for (const entry of list) {
    for (const key of keys) {
      if (typeof entry?.[key] !== 'string')
        fail(`${path}: every entry needs a string ${key}`);
    }
  }
  return list;
}

// ---------------------------------------------------------------- program

const STRICT_DEFAULTS = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16,
  moduleResolution: ts.ModuleResolutionKind.Node16,
  esModuleInterop: true,
  skipLibCheck: true,
};

function isTestPath(path) {
  return (
    /(^|\/)(__tests__|__typechecks__|__fixtures__|__mocks__)\//.test(path) ||
    /\.(test|spec)\.[cm]?tsx?$/.test(path) ||
    /\.d\.[cm]?ts$/.test(path)
  );
}

function loadProgram(options) {
  let compilerOptions = { ...STRICT_DEFAULTS };
  let projectFiles = [];
  if (existsSync(options.project)) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      options.project,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
          fail(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      },
    );
    if (parsed === undefined) fail(`cannot read ${options.project}`);
    if (parsed.errors.length > 0) {
      fail(ts.formatDiagnostics(parsed.errors, formatHost(options.root)));
    }
    compilerOptions = parsed.options;
    projectFiles = parsed.fileNames;
  } else if (options.files.length === 0) {
    projectFiles = ts.sys.readDirectory(join(options.root, 'src'), [
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
      const path = rel(options.root, file);
      return path.startsWith('src/') && !isTestPath(path);
    });
  const roots = [...checked];
  const contract = resolveModule(
    INTERFACES_AUTH,
    options.root,
    compilerOptions,
  );
  if (contract !== undefined) roots.push(contract);
  const program = ts.createProgram(roots, {
    ...compilerOptions,
    noEmit: true,
    composite: false,
    incremental: false,
    declaration: false,
    declarationMap: false,
    tsBuildInfoFile: undefined,
  });
  const sources = checked
    .map((file) => program.getSourceFile(file))
    .filter((source) => source !== undefined);
  const diagnostics = sources.flatMap((source) => [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ]);
  if (diagnostics.length > 0) {
    process.stderr.write(
      `the shape check needs a program that type-checks:\n${ts.formatDiagnostics(diagnostics, formatHost(options.root))}`,
    );
    process.exit(2);
  }
  return { program, sources, contract };
}

function resolveModule(name, root, compilerOptions) {
  const resolved = ts.resolveModuleName(
    name,
    join(root, '__shape-check__.ts'),
    compilerOptions,
    ts.sys,
  ).resolvedModule;
  return resolved?.resolvedFileName;
}

function formatHost(root) {
  return {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  };
}

function rel(root, file) {
  return relative(root, file).split(sep).join('/');
}

// ---------------------------------------------------------------- packages

const packageCache = new Map();

/** The nearest package.json above `file`: its name and its directory. */
function packageOf(file) {
  let dir = dirname(file);
  const visited = [];
  while (true) {
    const cached = packageCache.get(dir);
    if (cached !== undefined) {
      for (const seen of visited) packageCache.set(seen, cached);
      return cached;
    }
    visited.push(dir);
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      let name;
      try {
        name = JSON.parse(readFileSync(manifest, 'utf8')).name;
      } catch {
        name = undefined;
      }
      const found = { name: typeof name === 'string' ? name : undefined, dir };
      for (const seen of visited) packageCache.set(seen, found);
      return found;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      const none = { name: undefined, dir };
      for (const seen of visited) packageCache.set(seen, none);
      return none;
    }
    dir = parent;
  }
}

function inPackage(node, name) {
  return packageOf(node.getSourceFile().fileName).name === name;
}

/** Whether `file` is auth-errors' module `base`, from source or built. */
function isAuthErrorsModule(file, base) {
  const pkg = packageOf(file);
  if (pkg.name !== AUTH_ERRORS) return false;
  const path = rel(pkg.dir, file);
  return path === `src/${base}.ts` || path === `dist/${base}.d.ts`;
}

// ---------------------------------------------------------------- the checker

function createRules(program, contractFile, options, sites) {
  const checker = program.getTypeChecker();
  const findings = [];

  function report(node, rule, what) {
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
  let providerType;
  if (contractFile !== undefined) {
    const source = program.getSourceFile(contractFile);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const exported =
      moduleSymbol &&
      checker
        .getExportsOfModule(moduleSymbol)
        .find((s) => s.name === 'IAuthProvider');
    if (exported !== undefined) {
      const target =
        exported.flags & ts.SymbolFlags.Alias
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

  function declaredIn(symbol, name) {
    return (symbol?.declarations ?? []).some((declaration) =>
      inPackage(declaration, name),
    );
  }

  /** The name of the brand `property` carries, if it is one of interfaces-auth's. */
  function brandOf(property) {
    for (const declaration of property.declarations ?? []) {
      const name = declaration.name;
      if (
        name !== undefined &&
        ts.isComputedPropertyName(name) &&
        ts.isIdentifier(name.expression) &&
        BRANDS.has(name.expression.text) &&
        inPackage(declaration, INTERFACES_AUTH)
      ) {
        return name.expression.text;
      }
    }
    return undefined;
  }

  /** Whether the members of `type` are worth walking: not a library's own. */
  function ownMembers(type) {
    const symbol = type.getSymbol();
    const declarations = symbol?.declarations ?? [];
    if (declarations.length === 0) return true;
    return declarations.some((declaration) => {
      const source = declaration.getSourceFile();
      if (program.isSourceFileDefaultLibrary(source)) return false;
      // The compiler's file names use `/` on every platform.
      if (!source.fileName.includes('/node_modules/')) return true;
      const pkg = packageOf(source.fileName).name;
      return pkg === INTERFACES_AUTH || pkg === AUTH_ERRORS;
    });
  }

  /**
   * Whether `type` is or contains a type carrying one of `brands` — the
   * brands of interfaces-auth: an error's (and so a refusal's, an outcome's
   * and a failure's), a branded integer's — reached through unions,
   * intersections, type arguments, constraints (of a type parameter, a
   * conditional, an indexed access), properties and signature returns. Members of a
   * library's own types (outside interfaces-auth and auth-errors) are not
   * walked; its type arguments are.
   */
  function containsContract(type, brands) {
    const seen = new Set();
    const walk = (current, depth) => {
      if (current === undefined || depth > MAX_DEPTH || seen.has(current))
        return false;
      seen.add(current);
      // A type parameter, a conditional or an indexed access: its constraint.
      if (current.flags & ts.TypeFlags.Instantiable) {
        return walk(checker.getBaseConstraintOfType(current), depth + 1);
      }
      if (current.isUnionOrIntersection()) {
        return current.types.some((member) => walk(member, depth + 1));
      }
      if (!(current.flags & ts.TypeFlags.Object)) return false;
      if (current.objectFlags & ts.ObjectFlags.Reference) {
        if (
          checker
            .getTypeArguments(current)
            .some((argument) => walk(argument, depth + 1))
        )
          return true;
      }
      if (
        current.aliasTypeArguments?.some((argument) =>
          walk(argument, depth + 1),
        )
      )
        return true;
      if (!ownMembers(current)) return false;
      for (const property of checker.getPropertiesOfType(current)) {
        if (brands.has(brandOf(property))) return true;
        if (walk(checker.getTypeOfSymbol(property), depth + 1)) return true;
      }
      for (const signature of [
        ...current.getCallSignatures(),
        ...current.getConstructSignatures(),
      ]) {
        if (walk(checker.getReturnTypeOfSignature(signature), depth + 1))
          return true;
      }
      return false;
    };
    return walk(type, 0);
  }

  /** Whether `type` is an error of the contract (not merely holds one). */
  function isErrorType(type) {
    const seen = new Set();
    const walk = (current) => {
      if (current === undefined || seen.has(current)) return false;
      seen.add(current);
      if (current.flags & ts.TypeFlags.Instantiable)
        return walk(checker.getBaseConstraintOfType(current));
      if (current.isUnion()) return current.types.some(walk);
      if (current.isIntersection() && current.types.some(walk)) return true;
      return checker
        .getPropertiesOfType(current)
        .some((property) => brandOf(property) === ERROR_BRAND);
    };
    return walk(type);
  }

  function nameOf(name) {
    if (name === undefined) return undefined;
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
    if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
      return name.text;
    if (
      ts.isComputedPropertyName(name) &&
      ts.isStringLiteralLike(name.expression)
    ) {
      return name.expression.text;
    }
    return undefined;
  }

  /** The nearest enclosing named function of `node`. */
  function functionOf(node) {
    for (
      let current = node.parent;
      current !== undefined;
      current = current.parent
    ) {
      if (
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current)
      ) {
        const name = nameOf(current.name);
        if (name !== undefined) return name;
      }
      if (ts.isConstructorDeclaration(current)) return 'constructor';
      if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
        if (current.name !== undefined) return current.name.text;
        const holder = current.parent;
        if (
          (ts.isVariableDeclaration(holder) ||
            ts.isPropertyAssignment(holder) ||
            ts.isPropertyDeclaration(holder)) &&
          holder.initializer === current
        ) {
          const name = nameOf(holder.name);
          if (name !== undefined) return name;
        }
      }
    }
    return undefined;
  }

  function isSite(node, list) {
    const file = rel(options.root, node.getSourceFile().fileName);
    const fn = functionOf(node);
    return (
      fn !== undefined &&
      list.some((site) => site.file === file && site.function === fn)
    );
  }

  function skipParentheses(node) {
    return ts.skipParentheses(node);
  }

  // ------------------------------------------------------------ classes

  function isBaseClass(declaration) {
    if (
      !(ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration))
    )
      return false;
    if (declaration.name?.text !== BASE) return false;
    return /(^|[\\/])AuthProviderBase\.(d\.)?[cm]?ts$/.test(
      declaration.getSourceFile().fileName,
    );
  }

  /** Whether the class declared by `node` has AuthProviderBase among its ancestors. */
  function reachesBase(node) {
    const symbol =
      node.name !== undefined
        ? checker.getSymbolAtLocation(node.name)
        : checker.getTypeAtLocation(node).getSymbol();
    if (symbol === undefined) return false;
    const seen = new Set();
    const walk = (type) => {
      if (type === undefined || seen.has(type)) return false;
      seen.add(type);
      for (const base of checker.getBaseTypes(type)) {
        const target =
          base.objectFlags & ts.ObjectFlags.Reference ? base.target : base;
        const declarations = target.getSymbol()?.declarations ?? [];
        if (declarations.some(isBaseClass)) return true;
        if (target.isClassOrInterface() && walk(target)) return true;
        if (base.isIntersection()) {
          for (const member of base.types) {
            if ((member.getSymbol()?.declarations ?? []).some(isBaseClass))
              return true;
            if (member.isClassOrInterface() && walk(member)) return true;
          }
        }
      }
      return false;
    };
    const type = checker.getDeclaredTypeOfSymbol(symbol);
    return type.isClassOrInterface() ? walk(type) : false;
  }

  function isProviderInterface(type) {
    const seen = new Set();
    const walk = (current) => {
      if (current === undefined || seen.has(current)) return false;
      seen.add(current);
      const target =
        current.objectFlags & ts.ObjectFlags.Reference
          ? current.target
          : current;
      if (target === providerType) return true;
      const symbol = target.getSymbol();
      if (
        symbol?.name === 'IAuthProvider' &&
        declaredIn(symbol, INTERFACES_AUTH)
      )
        return true;
      if (target.isClassOrInterface())
        return checker.getBaseTypes(target).some(walk);
      if (current.isUnionOrIntersection()) return current.types.some(walk);
      return false;
    };
    return walk(type);
  }

  function checkClass(node) {
    const isBase = isBaseClass(node);
    const reaches = !isBase && reachesBase(node);
    if (options.rules.has(1) && !isBase) {
      const implementsProvider = (node.heritageClauses ?? [])
        .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
        .flatMap((clause) => clause.types)
        .find((expression) =>
          isProviderInterface(checker.getTypeAtLocation(expression)),
        );
      if (implementsProvider !== undefined) {
        report(
          implementsProvider,
          1,
          `a class implements IAuthProvider; a provider extends ${BASE}`,
        );
      } else if (!reaches && providerType !== undefined && !isAbstract(node)) {
        const instance = checker.getTypeAtLocation(node);
        if (
          instance.flags & ts.TypeFlags.Object &&
          checker.isTypeAssignableTo(instance, providerType)
        ) {
          report(
            node.name ?? node,
            1,
            `a class satisfies IAuthProvider without extending ${BASE}`,
          );
        }
      }
    }
    if (options.rules.has(2) && reaches) {
      for (const member of node.members) {
        const name = nameOf(member.name);
        if (name !== undefined && MOMENTS.has(name)) {
          report(
            member,
            2,
            `a class reaching ${BASE} declares ${name}; ${BASE} owns the four methods`,
          );
        }
        if (ts.isConstructorDeclaration(member)) {
          for (const parameter of member.parameters) {
            const parameterName = nameOf(parameter.name);
            if (
              parameterName !== undefined &&
              MOMENTS.has(parameterName) &&
              ts.getModifiers(parameter)?.some(isParameterPropertyModifier)
            ) {
              report(
                parameter,
                2,
                `a class reaching ${BASE} declares ${parameterName}; ${BASE} owns the four methods`,
              );
            }
          }
        }
      }
      const visit = (child) => {
        if (ts.isClassLike(child) && child !== node) return;
        if (
          ts.isBinaryExpression(child) &&
          child.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          child.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        ) {
          const target = skipParentheses(child.left);
          if (
            (ts.isPropertyAccessExpression(target) ||
              ts.isElementAccessExpression(target)) &&
            target.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            const name = ts.isPropertyAccessExpression(target)
              ? target.name.text
              : ts.isStringLiteralLike(target.argumentExpression)
                ? target.argumentExpression.text
                : undefined;
            if (name !== undefined && MOMENTS.has(name)) {
              report(
                child,
                2,
                `a class reaching ${BASE} assigns this.${name}; ${BASE} owns the four methods`,
              );
            }
          }
        }
        ts.forEachChild(child, visit);
      };
      ts.forEachChild(node, visit);
    }
  }

  function isAbstract(node) {
    return (
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) ??
      false
    );
  }

  function isParameterPropertyModifier(modifier) {
    return (
      modifier.kind === ts.SyntaxKind.PublicKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ReadonlyKeyword ||
      modifier.kind === ts.SyntaxKind.OverrideKeyword
    );
  }

  // ------------------------------------------------------------ rule 3

  function checkObjectLiteral(node) {
    if (!options.rules.has(3) || providerType === undefined) return;
    const type = checker.getTypeAtLocation(node);
    if (checker.isTypeAssignableTo(type, providerType)) {
      report(
        node,
        3,
        `an object literal satisfies IAuthProvider; a provider is a class extending ${BASE}`,
      );
    }
  }

  // ------------------------------------------------------------ rule 4

  function checkAssertion(node) {
    if (!options.rules.has(4)) return;
    const typeNode = node.type;
    if (
      ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeName.text === 'const'
    ) {
      return;
    }
    if (!containsContract(checker.getTypeFromTypeNode(typeNode), BRANDS))
      return;
    if (isSite(node, sites.assertions)) return;
    report(
      node,
      4,
      `a type assertion to a type of the contract (${typeNode.getText()}); only a listed site may assert`,
    );
  }

  function isOverload(node) {
    if (node.body !== undefined) return false;
    if (isAbstract(node)) return false;
    if (node.getSourceFile().isDeclarationFile) return false;
    if (
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
    )
      return true;
    const symbol =
      node.name !== undefined
        ? checker.getSymbolAtLocation(node.name)
        : undefined;
    return (symbol?.declarations ?? []).some(
      (declaration) =>
        declaration !== node &&
        'body' in declaration &&
        declaration.body !== undefined,
    );
  }

  function checkOverload(node) {
    if (!options.rules.has(4) || !isOverload(node)) return;
    const pkg = packageOf(node.getSourceFile().fileName);
    if (
      pkg.name === AUTH_ERRORS &&
      OVERLOAD_FILES.has(rel(pkg.dir, node.getSourceFile().fileName))
    )
      return;
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature === undefined) return;
    if (
      !containsContract(
        checker.getReturnTypeOfSignature(signature),
        ERROR_BRANDS,
      )
    )
      return;
    report(
      node,
      4,
      'an overload signature returns a type of the contract; its implementation is not checked against it',
    );
  }

  // ------------------------------------------------------------ rule 5

  function checkSpread(node) {
    if (!options.rules.has(5)) return;
    if (isErrorType(checker.getTypeAtLocation(node.expression))) {
      report(
        node,
        5,
        'a spread of an error keeps its brand on a new object; relay the error as it is',
      );
    }
  }

  function isGlobalObjectAssign(node) {
    const callee = skipParentheses(node.expression);
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'assign')
      return false;
    const object = skipParentheses(callee.expression);
    if (!ts.isIdentifier(object) || object.text !== 'Object') return false;
    const symbol = checker.getSymbolAtLocation(object);
    return (symbol?.declarations ?? []).every((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    );
  }

  function checkObjectAssign(node) {
    if (!options.rules.has(5) || !isGlobalObjectAssign(node)) return;
    for (const argument of node.arguments) {
      const expression = ts.isSpreadElement(argument)
        ? argument.expression
        : argument;
      const type = checker.getTypeAtLocation(expression);
      const element = ts.isSpreadElement(argument)
        ? checker.getIndexTypeOfType(type, ts.IndexKind.Number)
        : type;
      if (isErrorType(element)) {
        report(
          argument,
          5,
          'Object.assign copies an error, keeping its brand on another object; relay the error as it is',
        );
      }
    }
  }

  // ------------------------------------------------------------ rules 6 and 7

  function isBuilderDeclaration(declaration) {
    if (declaration === undefined) return false;
    const file = declaration.getSourceFile().fileName;
    if (!isAuthErrorsModule(file, 'builders')) return false;
    if (
      ts.isMethodSignature(declaration) &&
      ts.isInterfaceDeclaration(declaration.parent)
    ) {
      return declaration.parent.name.text === 'VariantBuilders';
    }
    return (
      ts.isFunctionDeclaration(declaration) &&
      ['buildSaml', 'buildSnc', 'buildConfiguration'].includes(
        declaration.name?.text ?? '',
      )
    );
  }

  function isGuardDeclaration(declaration) {
    return (
      declaration !== undefined &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === 'guard' &&
      isAuthErrorsModule(declaration.getSourceFile().fileName, 'guard')
    );
  }

  function declarationsOfCallable(expression) {
    const type = checker.getTypeAtLocation(expression);
    return type
      .getCallSignatures()
      .map((signature) => signature.getDeclaration());
  }

  function diagnosticFields(argument) {
    const expression = skipParentheses(argument);
    const type = checker.getTypeAtLocation(expression);
    if (type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) return [];
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return ['*'];
    if (
      ts.isObjectLiteralExpression(expression) &&
      expression.properties.every((p) => !ts.isSpreadAssignment(p))
    ) {
      return expression.properties.map(
        (property) => nameOf(property.name) ?? '*',
      );
    }
    const names = checker
      .getPropertiesOfType(checker.getNonNullableType(type))
      .map((property) => property.name);
    return names.length > 0 ? names : ['*'];
  }

  function checkCall(node) {
    const callee = skipParentheses(node.expression);
    // call / apply / bind of a builder or of guard: neither can be checked.
    if (
      ts.isPropertyAccessExpression(callee) &&
      ['call', 'apply', 'bind'].includes(callee.name.text)
    ) {
      const declarations = declarationsOfCallable(callee.expression);
      if (options.rules.has(6) && declarations.some(isBuilderDeclaration)) {
        report(
          node,
          6,
          `a builder reached through ${callee.name.text}; call it directly`,
        );
      }
      if (options.rules.has(7) && declarations.some(isGuardDeclaration)) {
        report(
          node,
          7,
          `guard reached through ${callee.name.text}; call it directly`,
        );
      }
    }
    if (!options.rules.has(6) && !options.rules.has(7)) return;
    const declaration = checker.getResolvedSignature(node)?.getDeclaration();
    if (
      options.rules.has(6) &&
      isBuilderDeclaration(declaration) &&
      node.arguments.length >= 2
    ) {
      const argument = node.arguments[1];
      const file = rel(options.root, node.getSourceFile().fileName);
      const fn = functionOf(node);
      const fields = ts.isSpreadElement(argument)
        ? ['*']
        : diagnosticFields(argument);
      const refused = fields.filter(
        (field) =>
          !sites.diagnostics.some(
            (site) =>
              site.file === file &&
              site.function === fn &&
              site.field === field,
          ),
      );
      if (refused.length > 0) {
        report(
          argument,
          6,
          `diagnostics (${refused.join(', ')}) passed outside the sites of diagnostic-sites.json (${file}, ${fn ?? 'no function'})`,
        );
      }
    }
    if (options.rules.has(7) && isGuardDeclaration(declaration))
      checkGuard(node);
  }

  function isFunctionExpression(node) {
    const inner = skipParentheses(node);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  }

  function checkGuard(node) {
    const args = node.arguments;
    if (args.some(ts.isSpreadElement)) {
      report(
        node,
        7,
        'guard called with spread arguments; pass the operation, the body and the grant',
      );
      return;
    }
    const grant = args[2];
    if (grant !== undefined && !isFunctionExpression(grant)) {
      report(
        grant,
        7,
        "guard's grant is not a function expression; it must be read inside the boundary",
      );
    }
    for (const argument of args) {
      const visit = (child) => {
        if (ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return;
        if (
          child.kind === ts.SyntaxKind.ThisKeyword ||
          child.kind === ts.SyntaxKind.SuperKeyword
        ) {
          const parent = child.parent;
          const moments =
            child.kind === ts.SyntaxKind.ThisKeyword &&
            ts.isPropertyAccessExpression(parent) &&
            parent.expression === child &&
            ts.isPrivateIdentifier(parent.name) &&
            parent.name.text === '#moments';
          if (!moments) {
            report(
              child,
              7,
              "a provider property read in guard's arguments, before the boundary; only this.#moments is",
            );
          }
          return;
        }
        ts.forEachChild(child, visit);
      };
      visit(argument);
    }
  }

  // ------------------------------------------------------------ rule 8

  function inBasicScope(source) {
    const file = rel(options.root, source.fileName);
    return BASIC_SCOPE.some((prefix) => file.startsWith(prefix));
  }

  function isBasicSite(node) {
    return isSite(node, BASIC_SITES);
  }

  const BASIC_TAIL = /(^|[^A-Za-z])Basic\s+$/;
  const BASIC_WHOLE = /^Basic\s+[A-Za-z0-9+/_-]{8,}={0,2}$/;

  function checkBasicText(node) {
    if (
      !options.rules.has(8) ||
      !inBasicScope(node.getSourceFile()) ||
      isBasicSite(node)
    )
      return;
    const text = node.text;
    const tail =
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      isConcatenated(node);
    if ((tail && BASIC_TAIL.test(text)) || BASIC_WHOLE.test(text)) {
      report(
        node,
        8,
        'a Basic authorization value outside legacyBasic and clientSecretBasic',
      );
    }
  }

  function isConcatenated(node) {
    const parent = node.parent;
    return (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      parent.left === node
    );
  }

  /** The value a base64 encoding call encodes, or undefined when it is none. */
  function base64Input(node) {
    const callee = skipParentheses(node.expression);
    if (ts.isIdentifier(callee) && callee.text === 'btoa')
      return node.arguments[0];
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.name.text;
    const encoding = node.arguments[0];
    if (!(method === 'toString' || method === 'digest')) return undefined;
    if (
      encoding === undefined ||
      !ts.isStringLiteralLike(encoding) ||
      !/^base64(url)?$/.test(encoding.text)
    ) {
      return undefined;
    }
    const subject = skipParentheses(callee.expression);
    if (
      ts.isCallExpression(subject) &&
      ts.isPropertyAccessExpression(subject.expression) &&
      subject.expression.name.text === 'from' &&
      ts.isIdentifier(subject.expression.expression) &&
      subject.expression.expression.text === 'Buffer'
    ) {
      return subject.arguments[0];
    }
    return subject;
  }

  /** Whether `node` is built from something named a secret, following local initialisers. */
  function builtFromSecret(node) {
    const seen = new Set();
    const walk = (current, depth) => {
      if (current === undefined || depth > MAX_DEPTH) return false;
      if (ts.isIdentifier(current) || ts.isPrivateIdentifier(current)) {
        if (/secret/i.test(current.text)) return true;
        const symbol = checker.getSymbolAtLocation(current);
        if (symbol === undefined || seen.has(symbol)) return false;
        seen.add(symbol);
        return (symbol.declarations ?? []).some(
          (declaration) =>
            ts.isVariableDeclaration(declaration) &&
            declaration.getSourceFile() === current.getSourceFile() &&
            walk(declaration.initializer, depth + 1),
        );
      }
      if (
        ts.isStringLiteralLike(current) &&
        ts.isElementAccessExpression(current.parent)
      ) {
        return /secret/i.test(current.text);
      }
      let found = false;
      ts.forEachChild(current, (child) => {
        if (!found && walk(child, depth)) found = true;
      });
      return found;
    };
    return walk(node, 0);
  }

  function checkBase64(node) {
    if (
      !options.rules.has(8) ||
      !inBasicScope(node.getSourceFile()) ||
      isBasicSite(node)
    )
      return;
    const input = base64Input(node);
    if (input !== undefined && builtFromSecret(input)) {
      report(
        node,
        8,
        'a base64 encoding of a client secret outside legacyBasic and clientSecretBasic',
      );
    }
  }

  // ------------------------------------------------------------ the walk

  function visit(node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      checkClass(node);
    else if (ts.isObjectLiteralExpression(node)) checkObjectLiteral(node);
    else if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      checkAssertion(node);
    else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
      checkOverload(node);
    else if (ts.isSpreadAssignment(node) || ts.isJsxSpreadAttribute(node))
      checkSpread(node);
    else if (ts.isCallExpression(node)) {
      checkObjectAssign(node);
      checkCall(node);
      checkBase64(node);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node)
    ) {
      checkBasicText(node);
    }
    ts.forEachChild(node, visit);
  }

  return { visit, findings };
}

// ---------------------------------------------------------------- main

const options = parseArguments(process.argv.slice(2));
const sites = {
  assertions: readSites(options.sites, 'assertion-sites.json', [
    'file',
    'function',
  ]),
  diagnostics: readSites(options.sites, 'diagnostic-sites.json', [
    'file',
    'function',
    'field',
  ]),
};
const { program, sources, contract } = loadProgram(options);
const { visit, findings } = createRules(program, contract, options, sites);
for (const source of sources) visit(source);
findings.sort((a, b) =>
  a.file === b.file
    ? a.line - b.line || a.column - b.column || a.rule - b.rule
    : a.file < b.file
      ? -1
      : 1,
);
for (const finding of findings) {
  process.stdout.write(
    `${finding.file}:${finding.line}:${finding.column}: rule ${finding.rule}: ${finding.what}\n`,
  );
}
process.exit(findings.length > 0 ? 1 : 0);
