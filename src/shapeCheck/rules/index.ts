import type * as ts from 'typescript';
import type { RuleContext } from '../program';
import { createBaseRules } from './base';
import { createClassRules } from './classes';
import { createCommon } from './common';
import { createRule3 } from './rule3';
import { createRule4 } from './rule4';
import { createRule5 } from './rule5';
import { createRule8 } from './rule8';
import { createRules6And7 } from './rules6and7';

/**
 * Runs the rules the context asks for over its files, reporting through the
 * context: with any of rules 1–3, the base is verified and its own files
 * scanned for writes onto it first; then every selected file is walked once,
 * each node handed to the checks of its kind.
 */
export function runRules(context: RuleContext): void {
  const ts = context.ts;
  const { options, sources } = context;
  const common = createCommon(context);
  const rule5 = createRule5(context, common);
  const classes = createClassRules(context, common, rule5);
  const rule3 = createRule3(context);
  const rule4 = createRule4(context, common, classes);
  const calls = createRules6And7(context, common);
  const rule8 = createRule8(context, common);
  const base = createBaseRules(context, common, classes, calls);

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
      classes.checkClass(node);
    else if (ts.isObjectLiteralExpression(node)) rule3.checkObjectLiteral(node);
    else if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      rule4.checkAssertion(node);
    else if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
      rule4.checkOverload(node);
    else if (ts.isBinaryExpression(node)) classes.checkMomentAssignment(node);
    else if (ts.isSpreadAssignment(node) || ts.isJsxSpreadAttribute(node))
      rule5.checkSpread(node);
    else if (ts.isCallExpression(node)) {
      rule5.checkObjectAssign(node);
      classes.checkMomentCall(node);
      calls.checkCall(node);
      rule8.checkBase64(node);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node)
    ) {
      rule8.checkBasicText(node);
    }
    ts.forEachChild(node, visit);
  }

  if (options.rules.has(1) || options.rules.has(2) || options.rules.has(3)) {
    base.verifyBase();
    base.scanBaseFiles(sources);
  }
  for (const source of sources) visit(source);
}
