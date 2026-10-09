import type * as ts from 'typescript';
import { BASE } from '../constants';
import type { RuleContext } from '../program';

/**
 * Rule 3: an object literal that satisfies IAuthProvider is a provider
 * outside the base, so it is reported — a provider is a class extending it.
 */
export interface Rule3 {
  checkObjectLiteral(node: ts.ObjectLiteralExpression): void;
}

export function createRule3(context: RuleContext): Rule3 {
  const { checker, options, report, providerType } = context;

  function checkObjectLiteral(node: ts.ObjectLiteralExpression): void {
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

  return { checkObjectLiteral };
}
