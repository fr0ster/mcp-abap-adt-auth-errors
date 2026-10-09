import type * as ts from 'typescript';
import type { RuleContext } from '../program';
import { rel } from '../program';
import type { Common } from './common';

/**
 * Rules 6 and 7, on calls. Rule 6: a builder's diagnostics are admitted
 * only at the sites of diagnostic-sites.json, so a diagnostics argument
 * whose fields are not each listed for that file and function is reported.
 * Rule 7: `guard` reads its grant inside the boundary, so a grant that is
 * not a function expression, spread arguments, or a provider property read
 * in its arguments (other than `this.#moments`) is reported. Neither a
 * builder nor `guard` reached through call / apply / bind can be checked,
 * so each is reported.
 */
export interface Rules6And7 {
  checkCall(node: ts.CallExpression): void;
  isFunctionExpression(node: ts.Expression): boolean;
  isGuardDeclaration(declaration: ts.Declaration | undefined): boolean;
  declarationsOfCallable(
    expression: ts.Expression,
  ): (ts.SignatureDeclaration | ts.JSDocSignature | undefined)[];
}

export function createRules6And7(
  context: RuleContext,
  common: Common,
): Rules6And7 {
  const ts = context.ts;
  const { checker, options, report, sites } = context;
  const { isAuthErrorsModule, functionOf, nameOf, skipParentheses } = common;

  function isBuilderDeclaration(
    declaration: ts.Declaration | undefined,
  ): boolean {
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

  function isGuardDeclaration(
    declaration: ts.Declaration | undefined,
  ): boolean {
    return (
      declaration !== undefined &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.name?.text === 'guard' &&
      isAuthErrorsModule(declaration.getSourceFile().fileName, 'guard')
    );
  }

  function declarationsOfCallable(
    expression: ts.Expression,
  ): (ts.SignatureDeclaration | ts.JSDocSignature | undefined)[] {
    const type = checker.getTypeAtLocation(expression);
    return type
      .getCallSignatures()
      .map((signature) => signature.getDeclaration());
  }

  function diagnosticFields(argument: ts.Expression): string[] {
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

  function checkCall(node: ts.CallExpression): void {
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
    const argument = node.arguments[1];
    if (
      options.rules.has(6) &&
      isBuilderDeclaration(declaration) &&
      node.arguments.length >= 2 &&
      argument !== undefined
    ) {
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

  function isFunctionExpression(node: ts.Expression): boolean {
    const inner = skipParentheses(node);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner);
  }

  function checkGuard(node: ts.CallExpression): void {
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
      const visit = (child: ts.Node): void => {
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

  return {
    checkCall,
    isFunctionExpression,
    isGuardDeclaration,
    declarationsOfCallable,
  };
}
