import type * as ts from 'typescript';
import {
  BASIC_SCOPE,
  BASIC_SITES,
  CRYPTO_MODULES,
  MAX_DEPTH,
} from '../constants';
import type { RuleContext } from '../program';
import { rel } from '../program';
import type { Common } from './common';

/**
 * Rule 8, in src/auth/, src/providers/ and src/clientAuthentication/: a
 * client secret leaves in a Basic header only through `legacyBasic` and
 * `clientSecretBasic`, so a `Basic ` authorization value, or a base64
 * encoding of a value built from a client secret, is reported anywhere
 * else in those directories. A digest or a signature of a secret is not a
 * reversible form of it, so what is encoded after one is not reported.
 */
export interface Rule8 {
  checkBasicText(
    node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead,
  ): void;
  checkBase64(node: ts.CallExpression): void;
}

export function createRule8(context: RuleContext, common: Common): Rule8 {
  const ts = context.ts;
  const { checker, options, report } = context;
  const { namedFunctionsOf, skipParentheses } = common;

  function inBasicScope(source: ts.SourceFile): boolean {
    const file = rel(options.root, source.fileName);
    return BASIC_SCOPE.some((prefix) => file.startsWith(prefix));
  }

  /** A site's function, or any function inside it (`authenticate` in `clientSecretBasic`). */
  function isBasicSite(node: ts.Node): boolean {
    const file = rel(options.root, node.getSourceFile().fileName);
    const names = namedFunctionsOf(node);
    return BASIC_SITES.some(
      (site) => site.file === file && names.includes(site.function),
    );
  }

  /**
   * A header value: `Basic ` (any case) and nothing else — a template head
   * followed by the credential, or a string joined to it (`+`, `concat`, a
   * constant used later); `Basic` alone (`join(' ')`, `${'Basic'}`); or
   * `Basic` and a literal credential (base64 holding a digit, `+`, `/` or
   * `=`). Prose (`Basic authentication`, `the Basic ${x}`) is none.
   */
  const BASIC_PREFIX = /^\s*basic\s+$/i;
  const BASIC_CREDENTIAL = /^\s*basic\s+([A-Za-z0-9+/_-]{8,}={0,2})$/i;

  function isBasicValue(
    node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead,
  ): boolean {
    const text = node.text;
    if (BASIC_PREFIX.test(text)) return true;
    if (text.trim() === 'Basic') return true;
    const credential = BASIC_CREDENTIAL.exec(text)?.[1];
    return credential !== undefined && /[0-9+/=]/.test(credential);
  }

  function checkBasicText(
    node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateHead,
  ): void {
    if (
      !options.rules.has(8) ||
      !inBasicScope(node.getSourceFile()) ||
      isBasicSite(node)
    )
      return;
    if (isBasicValue(node)) {
      report(
        node,
        8,
        'a Basic authorization value outside legacyBasic and clientSecretBasic',
      );
    }
  }

  /**
   * A name for a secret's value: `secret`, `…_secret`, `…Secret` (a client
   * secret by any spelling) — not a name that merely starts with it
   * (`secretName`). A heuristic: a secret under another name is not seen.
   */
  function isSecretName(name: string): boolean {
    return (
      /^secret$/i.test(name) ||
      /_secret$/i.test(name) ||
      /[A-Za-z0-9]Secret$/.test(name)
    );
  }

  /** The value a base64 encoding call encodes, or undefined when it is none. */
  function base64Input(node: ts.CallExpression): ts.Expression | undefined {
    const callee = skipParentheses(node.expression);
    if (ts.isIdentifier(callee) && callee.text === 'btoa')
      return node.arguments[0];
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.name.text;
    const encoding = node.arguments[0];
    if (method !== 'toString') return undefined;
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

  /**
   * Whether `node` is rooted at a binding imported from `crypto` /
   * `node:crypto` (named, namespace or default), or at a `const` alias of
   * one, transitively. A parameter, `let`, `var`, property or destructured
   * name is not: it may hold a stub whatever its type says.
   */
  function rootedAtCryptoImport(node: ts.Expression, depth = 0): boolean {
    if (depth > MAX_DEPTH) return false;
    const current = skipParentheses(node);
    if (ts.isPropertyAccessExpression(current))
      return rootedAtCryptoImport(current.expression, depth + 1);
    if (!ts.isIdentifier(current)) return false;
    const symbol = checker.getSymbolAtLocation(current);
    return (symbol?.declarations ?? []).some((declaration) => {
      if (
        ts.isImportSpecifier(declaration) ||
        ts.isNamespaceImport(declaration) ||
        ts.isImportClause(declaration)
      ) {
        for (
          let up: ts.Node | undefined = declaration.parent;
          up !== undefined;
          up = up.parent
        ) {
          if (ts.isImportDeclaration(up))
            return (
              ts.isStringLiteralLike(up.moduleSpecifier) &&
              CRYPTO_MODULES.has(up.moduleSpecifier.text)
            );
        }
        return false;
      }
      return (
        ts.isVariableDeclaration(declaration) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        declaration.initializer !== undefined &&
        rootedAtCryptoImport(declaration.initializer, depth + 1)
      );
    });
  }

  /**
   * The Node `crypto` function `node` names — through the type checker,
   * import aliases followed — or undefined: a declaration outside
   * `@types/node`'s crypto module (a local function, a fake `crypto`
   * object, a shadowing import) or an unresolved name is not Node's.
   */
  function nodeCryptoName(written: ts.Expression): string | undefined {
    const node = followConstAlias(written);
    if (!rootedAtCryptoImport(node)) return undefined;
    const target = ts.isPropertyAccessExpression(node) ? node.name : node;
    let symbol = checker.getSymbolAtLocation(target);
    if (symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (symbol === undefined) return undefined;
    return declaredInSymbol(symbol) ? symbol.name : undefined;
  }

  /** The expression a `const` alias (transitively) is initialised with, else `node`. */
  function followConstAlias(node: ts.Expression, depth = 0): ts.Expression {
    const current = skipParentheses(node);
    if (depth > MAX_DEPTH || !ts.isIdentifier(current)) return current;
    const declaration = checker
      .getSymbolAtLocation(current)
      ?.declarations?.find(ts.isVariableDeclaration);
    return declaration !== undefined &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined
      ? followConstAlias(declaration.initializer, depth + 1)
      : current;
  }

  function declaredInSymbol(symbol: ts.Symbol): boolean {
    return (symbol.declarations ?? []).some((declaration) =>
      /[\\/]node_modules[\\/]@types[\\/]node[\\/]crypto\.d\.ts$/.test(
        declaration.getSourceFile().fileName,
      ),
    );
  }

  /** Whether the member name `node` is declared by `@types/node`'s crypto module. */
  function declaredInNodeCrypto(node: ts.Node): boolean {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && declaredInSymbol(symbol);
  }

  /**
   * Whether the chain `node` is built on a call of one of Node's `crypto`
   * functions in `names` (`createHash(…).update(…)`), through local
   * initialisers.
   */
  function chainRootsAt(
    node: ts.Expression,
    names: ReadonlySet<string>,
    depth = 0,
  ): boolean {
    if (depth > MAX_DEPTH) return false;
    const current = skipParentheses(node);
    if (ts.isCallExpression(current)) {
      const callee = skipParentheses(current.expression);
      const name = nodeCryptoName(callee);
      if (name !== undefined && names.has(name)) return true;
      // The closed grammar: factory(…) [.update(…)]* — `update` declared by
      // Node's Hash / Hmac / Sign; any other member (`pipe`, `copy`, …) ends it.
      return (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'update' &&
        declaredInNodeCrypto(callee.name) &&
        chainRootsAt(callee.expression, names, depth + 1)
      );
    }
    if (ts.isIdentifier(current)) {
      const symbol = checker.getSymbolAtLocation(current);
      return (symbol?.declarations ?? []).some(
        (declaration) =>
          ts.isVariableDeclaration(declaration) &&
          ts.isVariableDeclarationList(declaration.parent) &&
          (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
          declaration.initializer !== undefined &&
          chainRootsAt(declaration.initializer, names, depth + 1),
      );
    }
    return false;
  }

  /**
   * An irreversible boundary ends secret derivation: a digest of Node's
   * `createHash` / `createHmac`, or a signature of Node's `createSign` /
   * `crypto.sign` — what is encoded after it is not the secret. Decided by
   * the declaration the name resolves to, never by the name.
   */
  function isIrreversible(call: ts.CallExpression): boolean {
    const callee = skipParentheses(call.expression);
    if (nodeCryptoName(callee) === 'sign') return true;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const method = callee.name.text;
    if (method === 'digest')
      return chainRootsAt(
        callee.expression,
        new Set(['createHash', 'createHmac']),
      );
    if (method === 'sign')
      return chainRootsAt(callee.expression, new Set(['createSign']));
    return false;
  }

  /** Whether `node` is built from something named a secret, following local initialisers. */
  function builtFromSecret(node: ts.Expression): boolean {
    const seen = new Set<ts.Symbol>();
    const walk = (current: ts.Node | undefined, depth: number): boolean => {
      if (current === undefined || depth > MAX_DEPTH) return false;
      if (ts.isCallExpression(current) && isIrreversible(current)) return false;
      if (ts.isIdentifier(current) || ts.isPrivateIdentifier(current)) {
        if (isSecretName(current.text)) return true;
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
        return isSecretName(current.text);
      }
      let found = false;
      ts.forEachChild(current, (child) => {
        if (!found && walk(child, depth)) found = true;
      });
      return found;
    };
    return walk(node, 0);
  }

  function checkBase64(node: ts.CallExpression): void {
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

  return { checkBasicText, checkBase64 };
}
