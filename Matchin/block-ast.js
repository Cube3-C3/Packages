// Matchin — AST Builder (Pratt Parser)
// Stage 5: Transforms a normalized stream of blocks into an Abstract Syntax Tree.

import { BlockType, OperatorType, Associativity } from './block-model.js';

// ==========================================
// 1. AST Узлы (Nodes)
// ==========================================
export class EquationNode {
  constructor(relation, left, right) {
    this.type = 'Equation';
    this.relation = relation;
    this.left = left;
    this.right = right;
  }
}

export class BinaryNode {
  constructor(operator, left, right) {
    this.type = 'Binary';
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
}

export class UnaryNode {
  constructor(operator, position, operand) {
    this.type = 'Unary';
    this.operator = operator;
    this.position = position; // 'prefix' | 'postfix'
    this.operand = operand;
  }
}

export class FunctionNode {
  constructor(name, args) {
    this.type = 'Function';
    this.name = name;
    this.args = args;
  }
}

export class GroupNode {
  constructor(innerNode) {
    this.type = 'Group';
    this.innerNode = innerNode;
  }
}

export class NumberNode {
  constructor(value, hasPeriodic) {
    this.type = 'Number';
    this.value = value;
    this.hasPeriodic = hasPeriodic;
  }
}

export class VariableNode {
  constructor(name, index) {
    this.type = 'Variable';
    this.name = name;
    this.index = index;
  }
}

// ==========================================
// 2. Движок Парсера
// ==========================================
export class ASTBuilder {
  constructor(blocks) {
    this.blocks = blocks;
    this.index = 0;
  }

  peek() {
    return this.blocks[this.index] || null;
  }

  consume() {
    return this.blocks[this.index++];
  }

  build() {
    if (this.blocks.length === 0) return null;

    // Ищем знак равенства на верхнем уровне, чтобы разбить на левую и правую части уравнения
    const relationIndex = this.blocks.findIndex(b => b.type === BlockType.RELATION || b.type === BlockType.EQUATION);

    if (relationIndex !== -1) {
      const relationBlock = this.blocks[relationIndex];
      const leftBlocks = this.blocks.slice(0, relationIndex);
      const rightBlocks = this.blocks.slice(relationIndex + 1);

      if (leftBlocks.length === 0 || rightBlocks.length === 0) {
        throw new Error("Уравнение требует выражений по обе стороны от знака равенства");
      }

      const leftAST = new ASTBuilder(leftBlocks).parseExpression(0);
      const rightAST = new ASTBuilder(rightBlocks).parseExpression(0);

      return new EquationNode(relationBlock.value, leftAST, rightAST);
    }

    const ast = this.parseExpression(0);
    
    if (this.index < this.blocks.length) {
      const unexpected = this.peek();
      throw new Error(`Неожиданный блок при построении AST: ${unexpected.value || unexpected.type}`);
    }

    return ast;
  }

  parseExpression(minPrecedence) {
    let left = this.parsePrefix();

    let nextToken = this.peek();
    while (
      nextToken &&
      nextToken.type === BlockType.OPERATOR &&
      nextToken.meta.operatorType === OperatorType.BINARY &&
      nextToken.meta.precedence >= minPrecedence
    ) {
      const operatorBlock = this.consume();
      const meta = operatorBlock.meta;

      // Правоассоциативные операторы (например, ^) сохраняют свой приоритет для правого операнда,
      // левоассоциативные (+, -, *, /) требуют приоритет + 1, чтобы не захватить операторы того же уровня
      const nextMinPrecedence = meta.associativity === Associativity.RIGHT 
        ? meta.precedence 
        : meta.precedence + 1;

      const right = this.parseExpression(nextMinPrecedence);
      left = new BinaryNode(operatorBlock.value, left, right);
      
      nextToken = this.peek();
    }

    return left;
  }

  parsePrefix() {
    const nextToken = this.peek();
    
    if (
      nextToken &&
      nextToken.type === BlockType.OPERATOR &&
      nextToken.meta.operatorType === OperatorType.PREFIX
    ) {
      const operatorBlock = this.consume();
      // Рекурсивный вызов parsePrefix позволяет обрабатывать цепочки префиксов (например, --x)
      return new UnaryNode(operatorBlock.value, 'prefix', this.parsePrefix());
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    let left = this.parsePrimary();

    let nextToken = this.peek();
    while (
      nextToken &&
      nextToken.type === BlockType.OPERATOR &&
      nextToken.meta.operatorType === OperatorType.POSTFIX
    ) {
      const operatorBlock = this.consume();
      left = new UnaryNode(operatorBlock.value, 'postfix', left);
      nextToken = this.peek();
    }

    return left;
  }

  parsePrimary() {
    const block = this.consume();
    if (!block) throw new Error("Неожиданный конец выражения. Ожидался операнд.");

    switch (block.type) {
      case BlockType.NUMBER:
        return new NumberNode(block.value, block.meta.hasPeriodic);

      case BlockType.VARIABLE:
        return new VariableNode(block.meta.name, block.meta.index);

      case BlockType.FUNCTION:
        // Функция обязательно требует группы после себя (скобок)
        const nextBlock = this.peek();
        if (!nextBlock || nextBlock.type !== BlockType.GROUP) {
          throw new Error(`Ожидались скобки с аргументами после функции ${block.meta.name}`);
        }
        const groupBlock = this.consume();
        
        // Разбираем аргументы внутри скобок
        // В будущем здесь можно добавить логику парсинга запятых (BlockType.SEPARATOR) для множества аргументов
        const argAST = new ASTBuilder(groupBlock.parts).build();
        // Упаковываем в массив (для sin/cos обычно один аргумент, для max/min может быть список)
        return new FunctionNode(block.meta.name, [argAST]);

      case BlockType.GROUP:
        // Рекурсивно собираем AST из блоков внутри скобок
        if (!block.meta.closed) {
          throw new Error("Обнаружена незакрытая скобка");
        }
        if (block.parts.length === 0) {
          throw new Error("Пустые скобки недопустимы");
        }
        const innerAST = new ASTBuilder(block.parts).build();
        return new GroupNode(innerAST);

      default:
        throw new Error(`Невозможно обработать блок типа ${block.type} как операнд`);
    }
  }
}

/**
 * Главная точка входа для сборки AST
 */
export function buildAST(blocks) {
  const builder = new ASTBuilder(blocks);
  return builder.build();
}
