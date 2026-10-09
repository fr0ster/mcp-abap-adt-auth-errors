import type * as ts from 'typescript';
import { MAX_DEPTH } from '../constants';
import type { AssertionSite, RuleContext } from '../program';
import { AUTH_ERRORS, ERROR_BRAND, INTERFACES_AUTH, rel } from '../program';

/**
 * What every rule reads beside the context: where a declaration comes from,
 * whether a type is or holds one of the contract's, and which named
 * function a node is in. In every rule file, `ts` in a value position is
 * the caller's TypeScript module, taken from the context; in a type
 * position it is the compiler's types.
 */
export interface Common {
  inPackage(node: ts.Node, name: string): boolean;
  isAuthErrorsModule(file: string, base: string): boolean;
  declaredIn(symbol: ts.Symbol | undefined, name: string): boolean;
  brandOf(property: ts.Symbol): string | undefined;
  containsContract(type: ts.Type, brands: ReadonlySet<string>): boolean;
  isErrorType(type: ts.Type | undefined): boolean;
  nameOf(name: ts.Node | undefined): string | undefined;
  namedFunctionsOf(node: ts.Node): string[];
  functionOf(node: ts.Node): string | undefined;
  isSite(node: ts.Node, list: readonly AssertionSite[]): boolean;
  skipParentheses(node: ts.Expression): ts.Expression;
}

export function createCommon(context: RuleContext): Common {
  const ts = context.ts;
  const { checker, program, options, packageOf } = context;

  // ---------------------------------------------------------- packages

  function inPackage(node: ts.Node, name: string): boolean {
    return packageOf(node.getSourceFile().fileName).name === name;
  }

  /** Whether `file` is auth-errors' module `base`, from source or built. */
  function isAuthErrorsModule(file: string, base: string): boolean {
    const pkg = packageOf(file);
    if (pkg.name !== AUTH_ERRORS) return false;
    const path = rel(pkg.dir, file);
    return path === `src/${base}.ts` || path === `dist/${base}.d.ts`;
  }

  // ---------------------------------------------------------- the checker

  function declaredIn(symbol: ts.Symbol | undefined, name: string): boolean {
    return (symbol?.declarations ?? []).some((declaration) =>
      inPackage(declaration, name),
    );
  }

  /** The name of the brand `property` carries, if it is one of interfaces-auth's. */
  function brandOf(property: ts.Symbol): string | undefined {
    for (const declaration of property.declarations ?? []) {
      const name = (declaration as ts.NamedDeclaration).name;
      if (
        name !== undefined &&
        ts.isComputedPropertyName(name) &&
        ts.isIdentifier(name.expression) &&
        context.brands.has(name.expression.text) &&
        inPackage(declaration, INTERFACES_AUTH)
      ) {
        return name.expression.text;
      }
    }
    return undefined;
  }

  /** Whether the members of `type` are worth walking: not a library's own. */
  function ownMembers(type: ts.Type): boolean {
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
  function containsContract(
    type: ts.Type,
    brands: ReadonlySet<string>,
  ): boolean {
    // The shallowest depth each type was walked at: a type first met near
    // the cut-off is walked again when met higher, where its members fit.
    const walked = new Map<ts.Type, number>();
    const walk = (current: ts.Type | undefined, depth: number): boolean => {
      if (current === undefined || depth > MAX_DEPTH) return false;
      const before = walked.get(current);
      if (before !== undefined && before <= depth) return false;
      walked.set(current, depth);
      // A type parameter, a conditional or an indexed access: its constraint.
      if (current.flags & ts.TypeFlags.Instantiable) {
        return walk(checker.getBaseConstraintOfType(current), depth + 1);
      }
      if (current.isUnionOrIntersection()) {
        return current.types.some((member) => walk(member, depth + 1));
      }
      if (!(current.flags & ts.TypeFlags.Object)) return false;
      if ((current as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
        if (
          checker
            .getTypeArguments(current as ts.TypeReference)
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
        const brand = brandOf(property);
        if (brand !== undefined && brands.has(brand)) return true;
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
  function isErrorType(type: ts.Type | undefined): boolean {
    const seen = new Set<ts.Type>();
    const walk = (current: ts.Type | undefined): boolean => {
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

  function nameOf(name: ts.Node | undefined): string | undefined {
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

  /** Every enclosing named function of `node`, nearest first. */
  function namedFunctionsOf(node: ts.Node): string[] {
    const names: string[] = [];
    for (
      let current: ts.Node | undefined = node.parent;
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
        if (name !== undefined) names.push(name);
      }
      if (ts.isConstructorDeclaration(current)) names.push('constructor');
      if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
        const own = (current as { readonly name?: ts.Identifier | undefined })
          .name;
        if (own !== undefined) names.push(own.text);
        const holder: ts.Node = current.parent;
        if (
          (ts.isVariableDeclaration(holder) ||
            ts.isPropertyAssignment(holder) ||
            ts.isPropertyDeclaration(holder)) &&
          holder.initializer === current
        ) {
          const name = nameOf(holder.name);
          if (name !== undefined) names.push(name);
        }
      }
    }
    return names;
  }

  /** The nearest enclosing named function of `node`. */
  function functionOf(node: ts.Node): string | undefined {
    return namedFunctionsOf(node)[0];
  }

  function isSite(node: ts.Node, list: readonly AssertionSite[]): boolean {
    const file = rel(options.root, node.getSourceFile().fileName);
    const fn = functionOf(node);
    return (
      fn !== undefined &&
      list.some((site) => site.file === file && site.function === fn)
    );
  }

  // The compiler's own `skipParentheses`: present at run time, absent from
  // its public declarations.
  const internal = ts as unknown as {
    skipParentheses(node: ts.Expression): ts.Expression;
  };

  function skipParentheses(node: ts.Expression): ts.Expression {
    return internal.skipParentheses(node);
  }

  return {
    inPackage,
    isAuthErrorsModule,
    declaredIn,
    brandOf,
    containsContract,
    isErrorType,
    nameOf,
    namedFunctionsOf,
    functionOf,
    isSite,
    skipParentheses,
  };
}
