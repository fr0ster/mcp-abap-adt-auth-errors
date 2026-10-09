import type * as ts from 'typescript';
import type { RuleContext } from '../program';
import type { Common } from './common';

/**
 * Rule 5: an error copied onto another object keeps its brand there, so an
 * object spread or an `Object.assign` argument typed as an error is
 * reported — an error is relayed as it is.
 */
export interface Rule5 {
  checkSpread(node: ts.SpreadAssignment | ts.JsxSpreadAttribute): void;
  /** The method of the global `Object` that `node` calls, if it calls one. */
  globalObjectMethod(node: ts.CallExpression): string | undefined;
  checkObjectAssign(node: ts.CallExpression): void;
}

export function createRule5(context: RuleContext, common: Common): Rule5 {
  const ts = context.ts;
  const { checker, program, options, report } = context;
  const { isErrorType, skipParentheses } = common;

  function checkSpread(
    node: ts.SpreadAssignment | ts.JsxSpreadAttribute,
  ): void {
    if (!options.rules.has(5)) return;
    if (isErrorType(checker.getTypeAtLocation(node.expression))) {
      report(
        node,
        5,
        'a spread of an error keeps its brand on a new object; relay the error as it is',
      );
    }
  }

  function globalObjectMethod(node: ts.CallExpression): string | undefined {
    const callee = skipParentheses(node.expression);
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const object = skipParentheses(callee.expression);
    if (!ts.isIdentifier(object) || object.text !== 'Object') return undefined;
    const symbol = checker.getSymbolAtLocation(object);
    const global = (symbol?.declarations ?? []).every((declaration) =>
      program.isSourceFileDefaultLibrary(declaration.getSourceFile()),
    );
    return global ? callee.name.text : undefined;
  }

  function isGlobalObjectAssign(node: ts.CallExpression): boolean {
    return globalObjectMethod(node) === 'assign';
  }

  function checkObjectAssign(node: ts.CallExpression): void {
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

  return { checkSpread, globalObjectMethod, checkObjectAssign };
}
