import type * as ts from 'typescript';
import { BASE, MOMENTS } from '../constants';
import type { RuleContext } from '../program';
import { INTERFACES_AUTH } from '../program';
import type { Common } from './common';
import type { Rule5 } from './rule5';

/**
 * Rules 1 and 2, on classes. Rule 1: a provider is a class extending the
 * base named by declaration — a class implementing IAuthProvider otherwise
 * (by an `implements` clause, or structurally) is reported, and so is a
 * write replacing one of the base's moments. Rule 2: a class reaching the
 * base declares no moment and writes none onto itself or its prototype,
 * since the base owns the four methods.
 */
export interface ClassRules {
  isBaseClass(declaration: ts.Node): boolean;
  checkClass(node: ts.ClassLikeDeclaration): void;
  checkMomentAssignment(node: ts.BinaryExpression): void;
  checkMomentCall(node: ts.CallExpression): void;
  memberName(name: ts.Node | undefined): string | undefined;
  isAbstract(node: ts.HasModifiers): boolean;
  isParameterPropertyModifier(modifier: ts.ModifierLike): boolean;
  /** Runs `scan` while only writes onto the base itself are reported. */
  baseWritesOnly(scan: () => void): void;
}

export function createClassRules(
  context: RuleContext,
  common: Common,
  rule5: Rule5,
): ClassRules {
  const ts = context.ts;
  const { checker, options, report, providerType, baseDeclarations } = context;
  const { declaredIn, nameOf } = common;
  const { globalObjectMethod } = rule5;

  /** Set while the base's own files are scanned beside the selected ones. */
  let baseWritesOnlyNow = false;

  function isBaseClass(declaration: ts.Node): boolean {
    return (baseDeclarations as ReadonlySet<ts.Node>).has(declaration);
  }

  /** The symbol of the class `node` declares, named or not. */
  function classSymbol(node: ts.ClassLikeDeclaration): ts.Symbol | undefined {
    return node.name !== undefined
      ? checker.getSymbolAtLocation(node.name)
      : checker.getTypeAtLocation(node).getSymbol();
  }

  /** A member's name, a computed one folded from its literal type. */
  function memberName(name: ts.Node | undefined): string | undefined {
    if (name !== undefined && ts.isComputedPropertyName(name)) {
      return keyOf(name.expression);
    }
    return nameOf(name);
  }

  /** The string an expression used as a key is typed as, if a literal. */
  function keyOf(expression: ts.Expression | undefined): string | undefined {
    if (expression === undefined) return undefined;
    const type = checker.getTypeAtLocation(expression);
    return type.isStringLiteral() ? type.value : undefined;
  }

  /** Whether the class declared by `node` has AuthProviderBase among its ancestors. */
  function reachesBase(node: ts.ClassLikeDeclaration): boolean {
    const symbol = classSymbol(node);
    if (symbol === undefined) return false;
    const seen = new Set<ts.Type>();
    const walk = (type: ts.InterfaceType | undefined): boolean => {
      if (type === undefined || seen.has(type)) return false;
      seen.add(type);
      for (const base of checker.getBaseTypes(type)) {
        const target =
          (base as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
            ? (base as ts.TypeReference).target
            : base;
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

  function isProviderInterface(type: ts.Type): boolean {
    const seen = new Set<ts.Type>();
    const walk = (current: ts.Type | undefined): boolean => {
      if (current === undefined || seen.has(current)) return false;
      seen.add(current);
      const target =
        (current as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
          ? (current as ts.TypeReference).target
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

  function checkClass(node: ts.ClassLikeDeclaration): void {
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
          reaches
            ? `drop \`implements IAuthProvider\`: ${BASE} already implements it`
            : `a class implements IAuthProvider; a provider extends ${BASE}`,
        );
      } else if (!reaches && providerType !== undefined && !isAbstract(node)) {
        const symbol = classSymbol(node);
        const instance =
          symbol === undefined
            ? undefined
            : checker.getDeclaredTypeOfSymbol(symbol);
        if (
          instance !== undefined &&
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
        const name = memberName(member.name);
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
    }
  }

  /** `node` without parentheses, `as`, `<T>`, `!` or `satisfies` around it. */
  function unwrap(node: ts.Expression): ts.Expression {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  /** Whether the base's own writes are checked: any of rules 1–3. */
  function checksBase(): boolean {
    return options.rules.has(1) || options.rules.has(2) || options.rules.has(3);
  }

  /**
   * Where a moment written onto `target` lands: `'base'` (the base named by
   * declaration — reported under rule 1, its verification), `'provider'` (a
   * class reaching it — rule 2), or undefined. Each only when its rule runs.
   */
  function momentTarget(
    target: ts.Expression,
  ): 'base' | 'provider' | undefined {
    const kind = targetKind(target);
    if (baseWritesOnlyNow)
      return kind === 'base' && checksBase() ? 'base' : undefined;
    if (kind === 'base') return checksBase() ? 'base' : undefined;
    if (kind === 'provider')
      return options.rules.has(2) ? 'provider' : undefined;
    return undefined;
  }

  /** Reports a moment written onto the base or a class reaching it. */
  function reportWrite(
    node: ts.Node,
    where: 'base' | 'provider',
    baseWhat: string,
    providerWhat: string,
  ): void {
    if (where === 'base') {
      report(node, 1, `${baseWhat}; its moments only delegate to guard`);
    } else {
      report(node, 2, `${providerWhat}; ${BASE} owns the four methods`);
    }
  }

  /**
   * Rules 1 (the base) and 2 through an assignment: `this.<moment> = …` in
   * the base or a class reaching it, or `X.prototype.<moment> = …` of one —
   * `this` or the target unwrapped of parentheses and assertions, a computed
   * key folded from its literal type (`(this as any)[NAME]`,
   * `X.prototype[NAME]`).
   */
  function checkMomentAssignment(node: ts.BinaryExpression): void {
    const kind = node.operatorToken.kind;
    if (
      kind < ts.SyntaxKind.FirstAssignment ||
      kind > ts.SyntaxKind.LastAssignment
    )
      return;
    const target = unwrap(node.left);
    if (
      !ts.isPropertyAccessExpression(target) &&
      !ts.isElementAccessExpression(target)
    )
      return;
    const name = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : keyOf(target.argumentExpression);
    if (name === undefined || !MOMENTS.has(name)) return;
    const owner = unwrap(target.expression);
    const where = momentTarget(owner);
    if (where === undefined) return;
    const written =
      owner.kind === ts.SyntaxKind.ThisKeyword
        ? `this.${name}`
        : `${owner.getText()}.${name}`;
    reportWrite(
      node,
      where,
      `${BASE} assigns ${written}`,
      `a class reaching ${BASE} assigns ${written}`,
    );
  }

  /**
   * Rules 1 (the base) and 2 through a call: `Object.assign` or
   * `Object.defineProperty` onto `this` of the base or a class reaching it,
   * or onto `X.prototype` of one, with a moment's key.
   */
  function checkMomentCall(node: ts.CallExpression): void {
    const method = globalObjectMethod(node);
    if (method !== 'assign' && method !== 'defineProperty') return;
    const target = node.arguments[0];
    if (target === undefined) return;
    const where = momentTarget(unwrap(target));
    if (where === undefined) return;
    const names: readonly (string | undefined)[] =
      method === 'defineProperty'
        ? [keyOf(node.arguments[1])]
        : node.arguments.slice(1).flatMap((argument) => {
            const source = ts.isSpreadElement(argument)
              ? argument.expression
              : argument;
            return checker
              .getPropertiesOfType(checker.getTypeAtLocation(source))
              .map((property) => property.name);
          });
    const moment = names.find(
      (name) => name !== undefined && MOMENTS.has(name),
    );
    if (moment !== undefined) {
      reportWrite(
        node,
        where,
        `Object.${method} writes ${moment} onto ${BASE}`,
        `Object.${method} writes ${moment} onto a class reaching ${BASE}`,
      );
    }
  }

  /** What a class declaration is: the base, one reaching it, or neither. */
  function classKind(declaration: ts.Node): 'base' | 'provider' | undefined {
    if (isBaseClass(declaration)) return 'base';
    return ts.isClassLike(declaration) && reachesBase(declaration)
      ? 'provider'
      : undefined;
  }

  /** `this` inside the base or a class reaching it, or `X.prototype` of one. */
  function targetKind(target: ts.Expression): 'base' | 'provider' | undefined {
    if (target.kind === ts.SyntaxKind.ThisKeyword) {
      const owner = ts.findAncestor(target, ts.isClassLike);
      return owner === undefined ? undefined : classKind(owner);
    }
    if (
      ts.isPropertyAccessExpression(target) &&
      target.name.text === 'prototype'
    ) {
      const symbol = checker.getSymbolAtLocation(unwrap(target.expression));
      const resolved =
        symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const kinds = (resolved?.declarations ?? []).map(classKind);
      if (kinds.includes('base')) return 'base';
      if (kinds.includes('provider')) return 'provider';
    }
    return undefined;
  }

  function isAbstract(node: ts.HasModifiers): boolean {
    return (
      ts
        .getModifiers(node)
        ?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) ??
      false
    );
  }

  function isParameterPropertyModifier(modifier: ts.ModifierLike): boolean {
    return (
      modifier.kind === ts.SyntaxKind.PublicKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ReadonlyKeyword ||
      modifier.kind === ts.SyntaxKind.OverrideKeyword
    );
  }

  function baseWritesOnly(scan: () => void): void {
    baseWritesOnlyNow = true;
    try {
      scan();
    } finally {
      baseWritesOnlyNow = false;
    }
  }

  return {
    isBaseClass,
    checkClass,
    checkMomentAssignment,
    checkMomentCall,
    memberName,
    isAbstract,
    isParameterPropertyModifier,
    baseWritesOnly,
  };
}
