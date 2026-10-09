import type * as ts from 'typescript';
import { BASE, MOMENTS } from '../constants';
import type { RuleContext } from '../program';
import type { ClassRules } from './classes';
import type { Common } from './common';
import type { Rules6And7 } from './rules6and7';

/**
 * Rule 1 on the base itself: each of its four moments is one method whose
 * body only returns `guard(this.#moments.<moment>, () => …, () => …)`, so
 * every moment of every provider runs inside the boundary; no constructor
 * parameter property is named after a moment, and no write replaces one —
 * also in the base's own files when they were not selected.
 */
export interface BaseRules {
  scanBaseFiles(selected: readonly ts.SourceFile[]): void;
  verifyBase(): void;
}

export function createBaseRules(
  context: RuleContext,
  common: Common,
  classes: ClassRules,
  calls: Rules6And7,
): BaseRules {
  const ts = context.ts;
  const { report, baseDeclarations } = context;
  const { nameOf, skipParentheses } = common;
  const {
    checkMomentAssignment,
    checkMomentCall,
    memberName,
    isAbstract,
    isParameterPropertyModifier,
    baseWritesOnly,
  } = classes;
  const { isFunctionExpression, isGuardDeclaration, declarationsOfCallable } =
    calls;

  /**
   * The base's implementation files (where it has bodies) are scanned for
   * writes onto the base whatever files were selected; a file also selected
   * is left to `visit`, so nothing is reported twice.
   */
  function scanBaseFiles(selected: readonly ts.SourceFile[]): void {
    const files = new Set<ts.SourceFile>();
    for (const declaration of baseDeclarations) {
      const source = declaration.getSourceFile();
      if (!source.isDeclarationFile && !selected.includes(source))
        files.add(source);
    }
    const walk = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node)) checkMomentAssignment(node);
      else if (ts.isCallExpression(node)) checkMomentCall(node);
      ts.forEachChild(node, walk);
    };
    baseWritesOnly(() => {
      for (const source of files) walk(source);
    });
  }

  /** `this.#moments.<moment>`, through parentheses. */
  function isMomentsRead(node: ts.Expression, moment: string): boolean {
    const inner = skipParentheses(node);
    return (
      ts.isPropertyAccessExpression(inner) &&
      ts.isIdentifier(inner.name) &&
      inner.name.text === moment &&
      ts.isPropertyAccessExpression(inner.expression) &&
      inner.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isPrivateIdentifier(inner.expression.name) &&
      inner.expression.name.text === '#moments'
    );
  }

  /** A body that is only `return guard(this.#moments.<m>, () => …, () => …)`. */
  function delegatesToGuard(body: ts.Block, moment: string): boolean {
    if (body.statements.length !== 1) return false;
    const [statement] = body.statements;
    if (
      statement === undefined ||
      !ts.isReturnStatement(statement) ||
      statement.expression === undefined
    )
      return false;
    const call = skipParentheses(statement.expression);
    if (!ts.isCallExpression(call)) return false;
    const args = call.arguments;
    const [operation, run, grant] = args;
    return (
      args.length === 3 &&
      !args.some(ts.isSpreadElement) &&
      operation !== undefined &&
      run !== undefined &&
      grant !== undefined &&
      isMomentsRead(operation, moment) &&
      isFunctionExpression(run) &&
      isFunctionExpression(grant) &&
      declarationsOfCallable(call.expression).some(isGuardDeclaration)
    );
  }

  /** Rule 1 on the base itself: each moment one method delegating to guard. */
  function verifyBase(): void {
    for (const declaration of baseDeclarations) {
      const declarationFile = declaration.getSourceFile().isDeclarationFile;
      const parameters = declaration.members
        .filter(ts.isConstructorDeclaration)
        .flatMap((ctor) => [...ctor.parameters])
        .filter((parameter) =>
          ts.getModifiers(parameter)?.some(isParameterPropertyModifier),
        );
      for (const moment of MOMENTS) {
        const parameter = parameters.find(
          (candidate) => nameOf(candidate.name) === moment,
        );
        if (parameter !== undefined) {
          report(
            parameter,
            1,
            `${BASE} declares ${moment} as a constructor parameter property; its moments only delegate to guard`,
          );
          continue;
        }
        const members = declaration.members.filter(
          (member) => memberName(member.name) === moment,
        );
        const [method] = members;
        const what = `${BASE}.${moment} must only return guard(this.#moments.${moment}, () => …, () => …)`;
        if (
          members.length !== 1 ||
          method === undefined ||
          !ts.isMethodDeclaration(method) ||
          isAbstract(method)
        ) {
          report(method ?? declaration.name ?? declaration, 1, what);
          continue;
        }
        if (method.body === undefined) {
          if (!declarationFile) report(method, 1, what);
          continue;
        }
        if (!delegatesToGuard(method.body, moment)) report(method, 1, what);
      }
    }
  }

  return { scanBaseFiles, verifyBase };
}
