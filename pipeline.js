'use strict';
const spec = require('shift-spec').default;
const ast = require('shift-ast');
const codegen = require('shift-codegen').default;
const ConstValue = require('./ConstValue');

class NodePath {
  constructor(node, parent = null, key = null) {
    this.node = node;
    this.parent = parent;
    this.key = key;
    Object.freeze(this);
    return this;
  }
  child(key) {
    // TODO, verify against spec that `key` is valid
    return new NodePath(this.node[key], this, key);
  }
}
Object.freeze(NodePath);
const SECRET = Symbol();
class Operation {
  constructor(GUARD) {
    if (GUARD !== SECRET) throw Error(`Cannot extend Operation`);
  }
};
Object.freeze(Operation);
class Replace extends Operation {
  constructor(dirty, fresh) {
    super(SECRET);
    if (dirty instanceof NodePath) {
      // TODO, check fresh??
      // Coerce/to a Shift-AST and snapshot
      // Is path.parent[path.key] a valid location for `fresh`
      this.path = new NodePath(fresh, dirty.parent, dirty.key);
      Object.freeze(this);
      return this;
    }
    throw new TypeError('invalid arguments');
  }
  perform() {
    this.path.parent.node[this.path.key] = this.path.node;
  }
  *taints() {
    yield this.path;
    yield this.path.parent;
  }
}
Object.freeze(Replace);
class Remove extends Operation {
  constructor(dead) {
    super(SECRET);
    if (dead instanceof NodePath) {
      this.path = dead;
      Object.freeze(this);
      return this;
    }
    throw new TypeError('invalid arguments');
  }
  perform() {
    if (!this.path.parent) {
      throw Error('Cannot replace without a parent');
    }
    // TODO check validity
    if (Array.isArray(this.path.parent.node)) {
      this.path.parent.node.splice(this.path.key, 1);
    }
    else {
      this.path.parent[this.path.key] = null;
    }
  }
  *taints() {
    yield this.path.parent;
  }
}
Object.freeze(Remove);
class Batch extends Operation {
  constructor(ops) {
    super(SECRET);
    this.operations = Object.freeze([...ops]);
    Object.freeze(this);
  }
  perform(queue, walker) {
    for (const op of this.operations) {
      op.perform(queue, walker);
    }
  }
  *taints() {
    for (const op of this.operations) {
      yield* op.taints();
    }
  }
}
Object.freeze(Batch);
class Pipeline {
  constructor(
    stages
  ) {
    this.stages = Object.freeze([...stages]);
    Object.freeze(this);
  }

  process(node) {
    const process = (path) => {
      const finish = this.stages.length;
      for (let stage = 0; stage !== finish; stage++) {
        const handler = this.stages[stage];
        // console.log(handler.name, 'running on', path.node.type)
        const ret = handler(path);
        if (ret instanceof Operation === true) {
          ret.perform();
          const seen = new Set;
          const tainted = new Set;
          for (let dirty of ret.taints()) {
            while (Array.isArray(dirty.node)) {
              dirty = dirty.parent;
            }
            if (seen.has(dirty.node)) continue;
            seen.add(dirty.node);
            tainted.add(dirty);
          }
          for (const dirty of tainted) {
            const key = dirty.node;
            for (let i = 0; i < queue.length; i++) {
              if (queue[i].key === key) {
                queue.splice(i, 1);
                break;
              }
            }
            queue.unshift({
              iter: DEPTH_FIRST(dirty, walker), key
            });
          }
          break;
        }
      }
    };

    const walker = Object.freeze({
      leave: process
    });

    const queue = [
      {iter: DEPTH_FIRST(new NodePath(node), walker), key: node}
    ];

    while (queue.length) {
      const task = queue[0];
      const {iter, key} = task;
      const {value, done} = iter.next();
      if (done === true) {
        if (queue[0] === task) {
          queue.shift();
        }
      }
      else {
        process(value);
      }
    }
  }
}

const FIELD_NAMES = (node) => {
  const {type} = node;
  const {fields} = spec[type];
  return fields.map(field => field.name);
}
const DEPTH_FIRST = Object.freeze(function* (path, walker) {
  if (path instanceof NodePath !== true) {
    throw TypeError('invalid argument');
  }
  const {node} = path;
  if (!node || typeof node !== 'object') {
    return;
  }
  // DO THIS BEFORE ANY MUTATION REQUESTS
  const fields = Array
    .from(Array.isArray(node) ? Object.keys(node) : FIELD_NAMES(node))
    .map(name => path.child(name));
  if (typeof walker.enter === 'function') {
    walker.enter(path);
  }
  for (const child of fields) {
    yield* DEPTH_FIRST(child, walker);
  }
  if (typeof walker.leave === 'function') {
    walker.leave(path);
  }
});


const EXPRESSIONSTATEMENTS_TO_SEQUENCE = (path) => {
  if (path.parent && Array.isArray(path.node) && !Array.isArray(path.parent.node)) {
    let field = spec[path.parent.node.type].fields.find(field => field.name === path.key);
    if (!field) return;
    if (field.type.typeName !== 'List') return;
    const replacements = [];
    const removals = [];
    const {length} = path.node;
    for (let i = 0; i < length; i++) {
      const left = i;
      const first = path.node[left];
      if (first.type === 'ExpressionStatement') {
        let right = left + 1;
        while (right < length && first.type === path.node[right].type) {
          right++;
        }
        if (right !== left + 1) {
          let rep = first.expression;
          for (let ii = left + 1; ii < right; ii++) {
            const dead = path.child(ii);
            removals.push(new Remove(dead));
            rep = new ast.BinaryExpression({
              operator: ',',
              left: rep,
              right: dead.node.expression
            })
          }
          rep = new ast.ExpressionStatement({expression: rep});
          replacements.push(new Replace(path.child(left), rep));
          i = right;
        }
      }
    }
    if (replacements.length) {
      return new Batch([...replacements, ...removals.reverse()]);
    }
  }
}
const DROPDEAD = (path) => {
  if (path.parent && Array.isArray(path.node) && !Array.isArray(path.parent.node)) {
    let field = spec[path.parent.node.type].fields.find(field => field.name === path.key);
    if (!field) return;
    if (field.type.typeName !== 'List') return;
    const {length} = path.node;
    for (let i = 0; i < length; i++) {
      const child = path.child(i);
      if (child.node.type === 'ThrowStatement' ||
      child.node.type === 'ReturnStatement' ||
      child.node.type === 'ContinueStatement' ||
      child.node.type === 'BreakStatement') {
        let ops = [];
        for (let ii = i + 1; ii < length; ii++) {
          ops.push(new Remove(path.child(ii)));
        }
        if (ops.length) {
          return new Batch(ops.reverse());
        }
      }
    }
  }
}
const DEBLOCK = (path) => {
  if (path.node.type === 'BlockStatement') {
    if (path.node.block.statements.length === 1) {
      return new Replace(path, path.node.block.statements[0]);
    }
    else if (path.node.block.statements.length === 0) {
      return new Replace(path, new AST.EmptyStatement());
    }
  }
}
const COMBINE_COMPLETION = (path) => {
  if (path.parent && Array.isArray(path.node) && !Array.isArray(path.parent.node)) {
    let field = spec[path.parent.node.type].fields.find(field => field.name === path.key);
    if (!field) return;
    if (field.type.typeName !== 'List') return;
    const {length} = path.node;
    for (let i = 1; i < length; i++) {
      const child = path.child(i);
      if (child.node.type === 'ThrowStatement' || child.node.type === 'ReturnStatement') {
        let left = path.child(i - 1);
        if (left.node.type === 'ExpressionStatement') {
          return new Batch([
            new Replace(left, new ast.ThrowStatement({
              expression: new ast.BinaryExpression({
                left: left.node.expression,
                operator: ',',
                right: child.node.expression
              })
            })),
            new Remove(child)
          ])
        }
      }
    }
  }
}
const BINARY_OPERATORS = Object.freeze(Object.assign(Object.create(null), {
  "+": ((l,r) => l+r),
  "-": ((l,r) => l-r),
  "*": ((l,r) => l*r),
  "/": ((l,r) => l/r),
  "%": ((l,r) => l%r),
  "^": ((l,r) => l^r),
  "|": ((l,r) => l|r),
  "&": ((l,r) => l&r),
  //"**": ((l,r) => l**r),
  "<<": ((l,r) => l<<r),
  ">>": ((l,r) => l>>r),
  ">>>": ((l,r) => l>>>r),
  "==": ((l,r) => l==r),
  "===": ((l,r) => l===r),
  "!=": ((l,r) => l!=r),
  "!==": ((l,r) => l!==r),
  "<": ((l,r) => (l<r)),
  "<=": ((l,r) => (l<=r)),
  ">": ((l,r) => l>r),
  ">=": ((l,r) => l>=r),
  "||": ((l,r) => l||r),
  "&&": ((l,r) => l&&r),
}))
const UNARY_OPERATORS = Object.freeze(Object.assign(Object.create(null), {
  "+": ((r) => +r),
  "-": ((r) => -r),
  "~": ((r) => ~r),
  "!": ((r) => !r),
  "typeof": ((r) => typeof r),
  "void": ((r) => void 0),
}))
const FOLD_CONSTANT = (path) => {
  if (ConstValue.isASTConst(path.node)) return;
  else if (path.node.type === 'BinaryExpression') {
    if (!(path.node.operator in BINARY_OPERATORS)) return;
    const operator = BINARY_OPERATORS[path.node.operator];
    const left = ConstValue.fromAST(path.node.left);
    if (left.type === 'None') return;
    const right = ConstValue.fromAST(path.node.right);
    if (right.type === 'None') return;
    return new Replace(path, ConstValue.toAST(operator(left.value, right.value)));
  }
  else if (path.node.type === 'UnaryExpression') {
    if (!(path.node.operator in UNARY_OPERATORS)) return;
    const operator = UNARY_OPERATORS[path.node.operator];
    const arg = ConstValue.fromAST(path.node.operand);
    if (arg.type === 'None') return;
    return new Replace(path, ConstValue.toAST(operator(arg.value)));
  }
}
const FOLD_CONDITIONAL = (path) => {
  if (path.node.type === 'ConditionalExpression') {
    const test = ConstValue.fromAST(path.node.test);
    if (test.type === 'None') return;
    return new Replace(path, test.value ? path.node.consequent : path.node.alternate);
  }
  else if (path.node.type === 'UnaryExpression') {
    if (!(path.node.operator in UNARY_OPERATORS)) return;
    const operator = UNARY_OPERATORS[path.node.operator];
    const arg = ConstValue.fromAST(path.node.operand);
    if (arg.type === 'None') return;
    return new Replace(path, ConstValue.toAST(operator(arg.value)));
  }
}
const IF_TO_LOGICAL = (path) => {
  if (path.node.type === 'IfStatement') {
    let {consequent, alternate} = path.node;
    if (!alternate) {
      // TODO: if not in completion, &&
    }
    else {
      if (alternate.type === consequent.type) {
        if (consequent.type === 'ReturnStatement') {
          return new Replace(path, new ast.ReturnStatement({
            expression: new ast.ConditionalExpression({
              test: path.child('test').node,
              consequent: consequent.expression,
              alternate: alternate.expression
            })
          }));
        }
        else if (consequent.type === 'ThrowStatement') {
          return new Replace(path, new ast.ThrowStatement({
            expression: new ast.ConditionalExpression({
              test: path.child('test').node,
              consequent: consequent.expression,
              alternate: alternate.expression
            })
          }));
        }
        else if (consequent.type !== 'BlockStatement') {
          return new Replace(path, new ast.ExpressionStatement({
            expression: new ast.ConditionalExpression({
              test: path.child('test').node,
              consequent: consequent.expression,
              alternate: alternate.expression
            })
          }));
        }
      }
    }
  }
}

const AST = require('shift-parser').parseScript('!!true');
{
  const pipeline = new Pipeline([
    DEBLOCK,
    DROPDEAD,
  ])
  pipeline.process(AST);
}
{
  const pipeline = new Pipeline([
    EXPRESSIONSTATEMENTS_TO_SEQUENCE,
    COMBINE_COMPLETION,
    IF_TO_LOGICAL,
    FOLD_CONSTANT,
    FOLD_CONDITIONAL,
  ]);
  pipeline.process(AST);
}
console.log(AST)
console.log(codegen(AST));
