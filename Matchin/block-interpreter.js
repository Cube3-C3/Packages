// Matchin — block interpreter
// Stage 1: turn raw input into typed blocks.
// No autopilot, normalization, implicit multiplication, or AST repair here.

import {
  BlockType,
  BlockRole,
  OperatorType,
  Associativity,
  createBlock
} from './block-model.js';

export const FunctionRegistry = new Set([
  'sin', 'cos', 'tan', 'log', 'ln', 'sqrt'
]);

export const PrefixUnaryRegistry = new Set(['-', '+']);
export const PostfixUnaryRegistry = new Set(['!']);

export const BinaryOperatorRegistry = new Set([
  '+', '-', '*', '/', '^'
]);

export const OperatorMeta = Object.freeze({
  '+': { type: OperatorType.BINARY, precedence: 10, associativity: Associativity.LEFT },
  '-': { type: OperatorType.BINARY, precedence: 10, associativity: Associativity.LEFT },
  '*': { type: OperatorType.BINARY, precedence: 20, associativity: Associativity.LEFT },
  '/': { type: OperatorType.BINARY, precedence: 20, associativity: Associativity.LEFT },
  '^': { type: OperatorType.BINARY, precedence: 30, associativity: Associativity.RIGHT },
  '!': { type: OperatorType.POSTFIX, precedence: 40, associativity: Associativity.LEFT }
});

function operatorBlock(value, type) {
  const meta = OperatorMeta[value] || {
    type,
    precedence: 0,
    associativity: Associativity.LEFT
  };

  return createBlock(BlockType.OPERATOR, {
    role: BlockRole.OPERATOR,
    value,
    meta: {
      operatorType: type,
      precedence: meta.precedence,
      associativity: meta.associativity
    }
  });
}

function readNumber(text, start) {
  let i = start;
  let integer = '';
  let fractional = '';
  let separator = null;
  let periodic = null;

  while (i < text.length && /\d/.test(text[i])) {
    integer += text[i++];
  }

  if (text[i] === '.' || text[i] === ',') {
    separator = text[i++];

    while (i < text.length && /\d/.test(text[i])) {
      fractional += text[i++];
    }

    if (text[i] === '(') {
      const open = i++;
      let digits = '';

      while (i < text.length && /\d/.test(text[i])) {
        digits += text[i++];
      }

      if (digits.length > 0 && text[i] === ')') {
        periodic = {
          open: text[open],
          value: digits,
          close: text[i++]
        };
      } else {
        // Leave an unfinished periodic component in the number.
        // Normalization is deliberately not performed here.
        i = open;
      }
    }
  }

  return {
    next: i,
    block: createBlock(BlockType.NUMBER, {
      value: integer +
        (separator || '') +
        fractional +
        (periodic ? `(${periodic.value})` : ''),
      parts: [
        { type: 'integer', value: integer },
        ...(separator
          ? [{ type: 'separator', value: separator }]
          : []),
        ...(fractional
          ? [{ type: 'fractional', value: fractional }]
          : []),
        ...(periodic
          ? [{ type: 'periodic', value: periodic.value }]
          : [])
      ],
      meta: {
        hasSeparator: Boolean(separator),
        hasFractional: fractional.length > 0,
        hasPeriodic: Boolean(periodic),
        separator
      }
    })
  };
}

function readVariable(text, start) {
  let i = start;
  let name = '';

  while (i < text.length && /[a-zA-Z]/.test(text[i])) {
    name += text[i++];
  }

  // A known function name remains a FUNCTION block.
  if (FunctionRegistry.has(name)) {
    return {
      next: i,
      block: createBlock(BlockType.FUNCTION, {
        value: name,
        meta: { name }
      })
    };
  }

  let index = null;

  if (text[i] === '_') {
    i++;
    let indexValue = '';

    while (
      i < text.length &&
      /[a-zA-Z0-9,]/.test(text[i])
    ) {
      indexValue += text[i++];
    }

    index = {
      value: indexValue,
      parts: indexValue
        .split(',')
        .map(value => ({ type: 'index-part', value }))
    };
  }

  return {
    next: i,
    block: createBlock(BlockType.VARIABLE, {
      value: name,
      parts: index ? [
        { type: 'name', value: name },
        { type: 'index', value: index.value, parts: index.parts }
      ] : [
        { type: 'name', value: name }
      ],
      meta: {
        name,
        indexed: Boolean(index),
        index: index ? index.value : null
      }
    })
  };
}

function readGroup(text, start) {
  const children = [];
  let i = start + 1;
  let depth = 1;

  while (i < text.length) {
    const char = text[i];

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth === 0) {
        return {
          next: i + 1,
          block: createBlock(BlockType.GROUP, {
            value: null,
            parts: children,
            meta: {
              closed: true,
              depth: 1
            }
          })
        };
      }
    }

    // Nested content is interpreted recursively only at the block level.
    // This keeps the stage structural without constructing AST nodes.
    const child = readSingleBlock(text, i);

    if (child) {
      children.push(child.block);
      i = child.next;
    } else {
      i++;
    }
  }

  return {
    next: i,
    block: createBlock(BlockType.GROUP, {
      value: null,
      parts: children,
      meta: {
        closed: false,
        depth: 1
      }
    })
  };
}

function readSingleBlock(text, start) {
  const char = text[start];

  if (/\d/.test(char)) {
    return readNumber(text, start);
  }

  if (/[a-zA-Z]/.test(char)) {
    return readVariable(text, start);
  }

  if (char === '(') {
    return readGroup(text, start);
  }

  if (char === '=') {
    return {
      next: start + 1,
      block: createBlock(BlockType.RELATION, {
        value: '=',
        meta: { relation: '=' }
      })
    };
  }

  if (PostfixUnaryRegistry.has(char)) {
    return {
      next: start + 1,
      block: operatorBlock(char, OperatorType.POSTFIX)
    };
  }

  if (PrefixUnaryRegistry.has(char)) {
    return {
      next: start + 1,
      block: operatorBlock(char, OperatorType.PREFIX)
    };
  }

  if (BinaryOperatorRegistry.has(char)) {
    return {
      next: start + 1,
      block: operatorBlock(char, OperatorType.BINARY)
    };
  }

  return null;
}

export function interpretBlocks(text = '') {
  const blocks = [];
  let i = 0;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }

    const parsed = readSingleBlock(text, i);

    if (!parsed) {
      // Unknown input is deliberately represented, not repaired.
      blocks.push(createBlock(BlockType.RELATION, {
        role: BlockRole.SEPARATOR,
        value: text[i],
        meta: { unknown: true }
      }));
      i++;
      continue;
    }

    blocks.push(parsed.block);
    i = parsed.next;
  }

  return blocks;
}

export function interpret(text = '') {
  return {
    type: 'block-stream',
    blocks: interpretBlocks(text)
  };
}
