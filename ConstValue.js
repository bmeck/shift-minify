'use strict';
const ast = require('shift-ast');
const Option = require('./Option');
const FREEZE = Object.freeze;
const CONST_VALUE = Symbol('CONST_VALUE');
const ASSIGN_CONST = (node, value) => {
  node[CONST_VALUE] = Option.Some(value);
  FREEZE(node);
  return node;
}
const MEMO = new Map;
const ZERO = ASSIGN_CONST(
  new ast.LiteralNumericExpression({
    value: 0
  }), 0);
MEMO.set(0, ZERO);
const ONE = ASSIGN_CONST(
  new ast.LiteralNumericExpression({
    value: 1
  }), 1); 
MEMO.set(1, ONE);
const NEG_ZERO = ASSIGN_CONST(
  new ast.UnaryExpression({
    operator: '-',
    argument: ZERO
  }), -0);
const NAN = ASSIGN_CONST(
  new ast.BinaryExpression({
    operator: '/',
    left: ZERO,
    right: ZERO
  }), 0/0);
MEMO.set(0/0, NAN);
const INFINITY = ASSIGN_CONST(
  new ast.BinaryExpression({
    operator: '/',
    left: ONE,
    right: ZERO
  }), 1/0);
MEMO.set(1/0, INFINITY);
const NEG_INFINITY = ASSIGN_CONST(
  new ast.BinaryExpression({
    operator: '/',
    left: ONE,
    right: NEG_ZERO
  }), 1/-0);
MEMO.set(1/0, NEG_INFINITY);
const UNDEFINED = ASSIGN_CONST(
  new ast.UnaryExpression({
    operator: 'void',
    argument: ZERO
  }), void 0);
MEMO.set(void 0, UNDEFINED);
const TRUE = ASSIGN_CONST(
  new ast.LiteralBooleanExpression({
    value: true
  }), true);
MEMO.set(true, TRUE);
const FALSE = ASSIGN_CONST(
  new ast.LiteralBooleanExpression({
    value: false
  }), false);
MEMO.set(false, FALSE);
exports.toAST = FREEZE((value) => {
    if (1/value === -Infinity) return NEG_ZERO;
    else if (MEMO.has(value)) {
      return MEMO.get(value);
    }
    else if (typeof value === 'string') {
      const AST = ASSIGN_CONST(
        new ast.LiteralStringExpression({
          value
        }), value); 
      MEMO.set(value, AST);
      return AST;
    }
    else if (typeof value === 'number') {
      const AST = ASSIGN_CONST(
        new ast.LiteralNumericExpression({
          value
        }), value); 
      MEMO.set(value, AST);
      return AST;
    }
    throw TypeError('value is not constant');
  });
exports.fromAST = FREEZE((node) => {
    if (node[CONST_VALUE]) {
      return node[CONST_VALUE];
    }
    else if (node.type === 'UnaryExpression' &&
      node.operator === '-' &&
      node.operand.type === 'LiteralNumericExpression') {
      const {value} = -node.operand;
      if (value === -0) return NEG_ZERO[CONST_VALUE];
      if (MEMO.has(value)) {
        return MEMO.get(value)[CONST_VALUE];
      }
      return Option.Some(value);
    }
    else if (node.type === 'LiteralNumericExpression' ||
    node.type === 'LiteralStringExpression' ||
    node.type === 'LiteralBooleanExpression') {
      const {value} = node;
      if (MEMO.has(value)) {
        return MEMO.get(value)[CONST_VALUE];
      }
      return Option.Some(value);
    }
    else if (node.type === 'LiteralNullExpression') {
      return NULL[CONST_VALUE];
    }
    return Option.None();
  });
exports.isASTConst = FREEZE((node) => CONST_VALUE in node);
