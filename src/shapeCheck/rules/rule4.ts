import type * as ts from 'typescript';
import { OVERLOAD_FILES } from '../constants';
import type { RuleContext } from '../program';
import { AUTH_ERRORS, rel } from '../program';
import type { ClassRules } from './classes';
import type { Common } from './common';

/**
 * Rule 4: only a listed site may assert a type of the contract, so a type
 * assertion whose target is or holds an error, a refusal, an outcome, a
 * failure or a branded integer is reported elsewhere; an overload signature
 * (or a body-less `declare function`) returning one of the first four is a
 * cast in disguise and is reported outside auth-errors' own builders.
 */
export interface Rule4 {
  checkAssertion(node: ts.AsExpression | ts.TypeAssertion): void;
  checkOverload(node: ts.FunctionDeclaration | ts.MethodDeclaration): void;
}

export function createRule4(
  context: RuleContext,
  common: Common,
  classes: ClassRules,
): Rule4 {
  const ts = context.ts;
  const { checker, options, report, sites, packageOf } = context;
  const { containsContract, isSite } = common;
  const { isAbstract } = classes;

  function checkAssertion(node: ts.AsExpression | ts.TypeAssertion): void {
    if (!options.rules.has(4)) return;
    const typeNode = node.type;
    if (
      ts.isTypeReferenceNode(typeNode) &&
      ts.isIdentifier(typeNode.typeName) &&
      typeNode.typeName.text === 'const'
    ) {
      return;
    }
    if (
      !containsContract(checker.getTypeFromTypeNode(typeNode), context.brands)
    )
      return;
    if (isSite(node, sites.assertions)) return;
    report(
      node,
      4,
      `a type assertion to a type of the contract (${typeNode.getText()}); only a listed site may assert`,
    );
  }

  function isOverload(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
  ): boolean {
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

  function checkOverload(
    node: ts.FunctionDeclaration | ts.MethodDeclaration,
  ): void {
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
        context.errorBrands,
      )
    )
      return;
    report(
      node,
      4,
      'an overload signature returns a type of the contract; its implementation is not checked against it',
    );
  }

  return { checkAssertion, checkOverload };
}
