// ast-nodes.js

export const FunctionRegistry = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'sqrt']);
export const PrefixUnaryRegistry = new Set(['-', '+']);
export const PostfixUnaryRegistry = new Set(['!']);

export const OperatorPrecedence = {
  '+': 10, '-': 10,
  '*': 20, '/': 20,
  '^': 30 // правоассоциативный
};

export class EquationNode {
  constructor(operator, left, right) {
    this.type = 'EquationNode';
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export class BinaryNode {
  constructor(operator, left, right) {
    this.type = 'BinaryNode';
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export class UnaryNode {
  constructor(operator, position, operand) {
    this.type = 'UnaryNode';
    this.operator = operator;
    this.position = position; // 'prefix' | 'postfix'
    this.operand = operand;
  }
}

export class FunctionNode {
  constructor(name, args) {
    this.type = 'FunctionNode';
    this.name = name;
    this.arguments = args;
  }
}

export class GroupNode {
  constructor(expression) {
    this.type = 'GroupNode';
    this.expression = expression;
  }
}

export class NumberNode {
  constructor(value, isPeriodic = false) {
    this.type = 'NumberNode';
    this.value = value;
    this.isPeriodic = isPeriodic;
  }
}

export class VariableNode {
  constructor(name, index = null) {
    this.type = 'VariableNode';
    this.name = name;
    this.index = index;
  }
}