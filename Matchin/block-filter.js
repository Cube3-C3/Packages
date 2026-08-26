// Matchin — contextual block admission filter
// Stage 2: decide which symbols may enter the currently active block.
// The filter does not repair input and does not build AST.

import {
  BlockType,
  OperatorType
} from './block-model.js';

export const AdmissionContext = Object.freeze({
  EMPTY: 'empty',
  NUMBER: 'number',
  VARIABLE: 'variable',
  VARIABLE_INDEX: 'variable-index',
  GROUP: 'group',
  FUNCTION: 'function',
  EXPRESSION: 'expression',
  EQUATION: 'equation',
  PREFIX_OPERATOR: 'prefix-operator',
  POSTFIX_OPERATOR: 'postfix-operator',
  BINARY_OPERATOR: 'binary-operator'
});

const NUMBER_CHARS = new Set('0123456789.,'.split(''));
const VARIABLE_CHARS = new Set(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_,'.split('')
);
const BINARY_OPERATORS = new Set(['+', '-', '*', '/', '^']);
const PREFIX_OPERATORS = new Set(['+', '-']);
const POSTFIX_OPERATORS = new Set(['!']);

const CONTEXT_RULES = Object.freeze({
  [AdmissionContext.EMPTY]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || BINARY_OPERATORS.has(char) || char === '=' || POSTFIX_OPERATORS.has(char)
  },
  [AdmissionContext.NUMBER]: {
    test: char => NUMBER_CHARS.has(char) || char === '('
  },
  [AdmissionContext.VARIABLE]: {
    test: char => VARIABLE_CHARS.has(char) || char === '(' || BINARY_OPERATORS.has(char) || char === '=' || POSTFIX_OPERATORS.has(char)
  },
  [AdmissionContext.VARIABLE_INDEX]: {
    test: char => VARIABLE_CHARS.has(char)
  },
  [AdmissionContext.GROUP]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || char === ')' || BINARY_OPERATORS.has(char) || char === '=' || char === ',' || POSTFIX_OPERATORS.has(char)
  },
  [AdmissionContext.FUNCTION]: {
    test: char => char === '(' || /[a-zA-Z]/.test(char)
  },
  [AdmissionContext.EXPRESSION]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || BINARY_OPERATORS.has(char) || char === ')' || POSTFIX_OPERATORS.has(char)
  },
  [AdmissionContext.EQUATION]: {
    // A relation belongs only at the equation boundary. A second '=' is denied.
    test: char => char !== '=' && char !== ','
  },
  [AdmissionContext.PREFIX_OPERATOR]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || PREFIX_OPERATORS.has(char)
  },
  [AdmissionContext.POSTFIX_OPERATOR]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || BINARY_OPERATORS.has(char) || char === ')' || POSTFIX_OPERATORS.has(char)
  },
  [AdmissionContext.BINARY_OPERATOR]: {
    test: char => /\d/.test(char) || /[a-zA-Z]/.test(char) || char === '(' || PREFIX_OPERATORS.has(char)
  }
});

export function contextForBlock(block) {
  if (!block) return AdmissionContext.EMPTY;

  if (block.type === BlockType.NUMBER) return AdmissionContext.NUMBER;
  if (block.type === BlockType.VARIABLE) {
    return block.meta?.indexed
      ? AdmissionContext.VARIABLE_INDEX
      : AdmissionContext.VARIABLE;
  }
  if (block.type === BlockType.FUNCTION) return AdmissionContext.FUNCTION;
  if (block.type === BlockType.GROUP) return AdmissionContext.GROUP;

  if (block.type === BlockType.OPERATOR) {
    switch (block.meta?.operatorType) {
      case OperatorType.PREFIX:
        return AdmissionContext.PREFIX_OPERATOR;
      case OperatorType.POSTFIX:
        return AdmissionContext.POSTFIX_OPERATOR;
      default:
        return AdmissionContext.BINARY_OPERATOR;
    }
  }

  if (block.type === BlockType.EQUATION) return AdmissionContext.EQUATION;
  return AdmissionContext.EXPRESSION;
}

export function canAdmit(context, char) {
  const rule = CONTEXT_RULES[context];
  return Boolean(rule && rule.test(char));
}

export function filterInput(text, context = AdmissionContext.EMPTY) {
  let accepted = '';
  const rejected = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (/\s/.test(char) || canAdmit(context, char)) {
      accepted += char;
    } else {
      rejected.push({ index: i, char, context });
    }
  }

  return { accepted, rejected };
}

export function createBlockFilter(getContext) {
  return {
    canAdmit(char) {
      return canAdmit(getContext(), char);
    },
    filter(text) {
      return filterInput(text, getContext());
    }
  };
}
