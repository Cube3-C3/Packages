// MatchinEngine.js
import { filterInput, AdmissionContext } from './block-filter.js';
import { interpretBlocks } from './block-interpreter.js';
import { applyAutopilot } from './block-autopilot.js';
import { buildAST } from './block-ast.js';

export class MatchinEngine {
  constructor(options = {}) {
    this.strictMode = options.strictMode !== undefined ? options.strictMode : false;
    this.lastProcessedBlocks = [];
  }

  setStrictMode(value) {
    this.strictMode = Boolean(value);
  }

  process(text, isFinal = false) {
    // 1. Фильтрация ввода (если строгий режим)
    let safeText = text;
    if (this.strictMode) {
      const filterResult = filterInput(text, AdmissionContext.EMPTY);
      safeText = filterResult.accepted;
      if (filterResult.rejected.length > 0) {
        throw new Error(`[Защита] Ввод заблокирован. Недопустимые символы отброшены.`);
      }
    }

    // 2. Блочный Интерпретатор (сырые Typed Blocks)
    const rawBlocks = interpretBlocks(safeText);

    // 3 & 4. Автопилот, Полиция и Нормализация
    this.lastProcessedBlocks = applyAutopilot(rawBlocks, {
      isFinal,
      strictMode: this.strictMode
    });

    // 5. Построение AST
    return buildAST(this.lastProcessedBlocks);
  }
}
