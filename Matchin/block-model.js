// Matchin — typed block model
// The block is the primary unit between raw input and AST.

export const BlockType = Object.freeze({
  NUMBER: 'number',
  VARIABLE: 'variable',
  GROUP: 'group',
  FUNCTION: 'function',
  OPERATOR: 'operator',
  EXPRESSION: 'expression',
  RELATION: 'relation',
  EQUATION: 'equation'
});

export const OperatorType = Object.freeze({
  PREFIX: 'prefix',
  POSTFIX: 'postfix',
  BINARY: 'binary'
});

export const Associativity = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right'
});

export const BlockRole = Object.freeze({
  OPERAND: 'operand',
  OPERATOR: 'operator',
  SEPARATOR: 'separator',
  CONTAINER: 'container'
});

export function createBlock(type, props = {}) {
  return {
    type,
    role: props.role || defaultRole(type),
    value: props.value ?? null,
    parts: props.parts || [],
    meta: props.meta || {},
    range: props.range || null
  };
}

export function defaultRole(type) {
  switch (type) {
    case BlockType.OPERATOR:
      return BlockRole.OPERATOR;
    case BlockType.EXPRESSION:
    case BlockType.GROUP:
    case BlockType.EQUATION:
      return BlockRole.CONTAINER;
    default:
      return BlockRole.OPERAND;
  }
}

export function isOperand(block) {
  return Boolean(block) && block.role === BlockRole.OPERAND;
}

export function isOperator(block) {
  return Boolean(block) && block.role === BlockRole.OPERATOR;
}

export function isSeparator(block) {
  return Boolean(block) && block.role === BlockRole.SEPARATOR;
}
