// Matchin — block autopilot & police
// Stage 3 & 4: Implicit multiplication, conflict resolution, and blur normalization.
// Transforms a stream of raw blocks into a normalized stream ready for AST.

import {
  BlockType,
  OperatorType,
  createBlock
} from './block-model.js';

/**
 * Создает блок неявного умножения
 */
function createImplicitMultiplication() {
  return createBlock(BlockType.OPERATOR, {
    value: '*',
    meta: {
      operatorType: OperatorType.BINARY,
      precedence: 20,
      associativity: 'left',
      implicit: true // Помечаем, что это сгенерировано автопилотом
    }
  });
}

/**
 * Нормализует незавершенный блок при потере фокуса (blur / isFinal = true)
 */
function normalizeBlock(block) {
  if (block.type === BlockType.NUMBER) {
    // Убираем висячий разделитель (например, "3,")
    if (block.meta?.hasSeparator && !block.meta?.hasFractional && !block.meta?.hasPeriodic) {
      const integerPart = block.parts.find(p => p.type === 'integer');
      return createBlock(BlockType.NUMBER, {
        value: integerPart ? integerPart.value : block.value.replace(/[.,]$/, ''),
        parts: integerPart ? [integerPart] : block.parts,
        meta: { ...block.meta, hasSeparator: false, separator: null }
      });
    }
  }

  if (block.type === BlockType.VARIABLE) {
    // Убираем висячий индекс (например, "x_")
    if (block.meta?.indexed && !block.meta?.index) {
      const namePart = block.parts.find(p => p.type === 'name');
      return createBlock(BlockType.VARIABLE, {
        value: block.meta.name,
        parts: namePart ? [namePart] : block.parts,
        meta: { ...block.meta, indexed: false, index: null }
      });
    }
  }

  return block;
}

/**
 * Пропускает массив сырых блоков через правила Автопилота и Полиции
 * @param {Array} blocks Массив блоков из block-interpreter
 * @param {Object} options { isFinal: boolean, strictMode: boolean }
 * @returns {Array} Очищенный массив блоков
 */
export function applyAutopilot(blocks, options = {}) {
  const { isFinal = false, strictMode = false } = options;
  const result = [];

  for (let i = 0; i < blocks.length; i++) {
    let current = blocks[i];
    let next = blocks[i + 1];

    // 1. Нормализация текущего блока при blur (схлопывание оторванных концов)
    if (isFinal) {
      current = normalizeBlock(current);
    }

    // 2. Игнорирование неизвестных "шумовых" сепараторов (если автопилот включен)
    if (current.type === BlockType.RELATION && current.meta?.unknown) {
      if (strictMode) throw new Error(`[Защита] Недопустимый символ: ${current.value}`);
      continue; // Автопилот просто съедает мусор
    }

    // 3. Отсечение висячего бинарного оператора на конце выражения
    if (isFinal && current.type === BlockType.OPERATOR && current.meta?.operatorType === OperatorType.BINARY && !next) {
      continue; // Просто не добавляем его в результат
    }

    // 4. Дублирование операторов (например, "+ +")
    if (current.type === BlockType.OPERATOR && next?.type === BlockType.OPERATOR) {
      const currentIsBinary = current.meta?.operatorType === OperatorType.BINARY;
      const nextIsBinaryOrPostfix = next.meta?.operatorType !== OperatorType.PREFIX;
      
      if (currentIsBinary && nextIsBinaryOrPostfix) {
        if (strictMode) {
          throw new Error("Дублирование операторов заблокировано");
        }
        if (isFinal) {
          // При blur безжалостно удаляем второй (конфликтный) оператор
          i++; // Пропускаем следующий блок
          next = blocks[i + 1]; // Переопределяем next для текущего
        } else {
          // В процессе ввода не трогаем, оставим для AST (может выдать ошибку парсинга, это нормально)
        }
      }
    }

    result.push(current);

    // 5. ПОЛИЦИЯ: Неявное умножение
    if (next) {
      const currentIsOperand = current.type === BlockType.NUMBER || current.type === BlockType.VARIABLE || current.type === BlockType.FUNCTION;
      const currentIsPostfix = current.type === BlockType.OPERATOR && current.meta?.operatorType === OperatorType.POSTFIX;
      const currentIsGroup = current.type === BlockType.GROUP;

      const nextIsOperand = next.type === BlockType.NUMBER || next.type === BlockType.VARIABLE || next.type === BlockType.FUNCTION;
      const nextIsGroup = next.type === BlockType.GROUP;

      // Правила стыковки блоков (Number->Number, Var->Number, Postfix->Var, Group->Group и т.д.)
      if (
        (currentIsOperand && (nextIsOperand || nextIsGroup)) ||
        (currentIsPostfix && (nextIsOperand || nextIsGroup)) ||
        (currentIsGroup && (nextIsOperand || nextIsGroup))
      ) {
        result.push(createImplicitMultiplication());
      }
    }
  }

  return result;
}
