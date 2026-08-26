
export const BLOCK_TYPES = {
  NUMBER: 'number',
  VARIABLE: 'variable',
  EXPRESSION: 'expression',
  EQUATION: 'equation'
};

const COMMON = /[0-9a-zA-Z_.,]/;
const OPERATORS = /[+\-*/^()!,<>]/;

export class InputFilter {
  constructor(options = {}) {
    this.defaultBlock = options.defaultBlock || BLOCK_TYPES.EXPRESSION;
  }

  resolveBlock(element) {
    let node = element;

    while (node) {
      if (node.dataset?.matchinBlock) {
        return node.dataset.matchinBlock;
      }
      node = node.parentElement;
    }

    return this.defaultBlock;
  }

  isAllowedChar(char, blockType) {
    if (/\s/.test(char)) return true;

    switch (blockType) {
      case BLOCK_TYPES.NUMBER:
        return /[0-9.,()]/.test(char);

      case BLOCK_TYPES.VARIABLE:
        return /[a-zA-Z0-9_]/.test(char);

      case BLOCK_TYPES.EQUATION:
        return COMMON.test(char) || OPERATORS.test(char) || char === '=';

      case BLOCK_TYPES.EXPRESSION:
      default:
        return COMMON.test(char) || OPERATORS.test(char);
    }
  }

  sanitize(text, blockType = this.defaultBlock) {
    let result = '';
    let equationSeen = false;

    for (const char of text) {
      if (!this.isAllowedChar(char, blockType)) continue;

      // "=" принадлежит только уравнению и только один раз.
      if (char === '=') {
        if (blockType !== BLOCK_TYPES.EQUATION) continue;
        if (equationSeen) continue;
        equationSeen = true;
      }

      result += char;
    }

    return result;
  }

  filterInsertion(currentValue, start, end, insertedText, blockType) {
    const candidate =
      currentValue.slice(0, start) +
      insertedText +
      currentValue.slice(end);

    const sanitized = this.sanitize(candidate, blockType);

    const prefix = currentValue.slice(0, start);
    const suffix = currentValue.slice(end);

    let filteredInsertion = sanitized;

    if (sanitized.startsWith(prefix) && sanitized.endsWith(suffix)) {
      filteredInsertion = sanitized.slice(
        prefix.length,
        sanitized.length - suffix.length || undefined
      );
    }

    return {
      value: sanitized,
      insertedText: filteredInsertion
    };
  }
}
