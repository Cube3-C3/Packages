import { InputEngine } from './ast-engine.js';
import { InputFilter } from './input-filter.js';
import { 
  FunctionRegistry, 
  PrefixUnaryRegistry, 
  PostfixUnaryRegistry, 
  OperatorPrecedence,
  EquationNode,
  BinaryNode,
  UnaryNode,
  FunctionNode,
  GroupNode,
  NumberNode,
  VariableNode
} from './ast-nodes.js';

export class InputEngine {
  constructor(options = {}) {
    this.strictMode = options.strictMode !== undefined ? options.strictMode : false;
    this.lastProcessedTokens = [];
    this.reset();
  }

  setStrictMode(value) {
    this.strictMode = Boolean(value);
  }

  reset() {
    this.hasEquationOp = false;
  }
  const filter = new InputFilter({
  defaultBlock: input.dataset.matchinBlock || 'expression'
  });
  function getBlockType() {
  return filter.resolveBlock(input);
}

function applyInputFilter() {
  const blockType = getBlockType();
  const oldValue = input.value;

  const cursor = input.selectionStart ?? oldValue.length;

  const sanitized = filter.sanitize(oldValue, blockType);

  if (sanitized !== oldValue) {
    const delta = sanitized.length - oldValue.length;

    input.value = sanitized;

    const nextCursor = Math.max(
      0,
      Math.min(sanitized.length, cursor + delta)
    );

    input.setSelectionRange(nextCursor, nextCursor);
  }
}
  input.addEventListener('input', () => {
  applyInputFilter();
  updateAST();
});
input.addEventListener('beforeinput', event => {
  if (
    !event.data ||
    !['insertText', 'insertFromPaste', 'insertFromDrop']
      .includes(event.inputType)
  ) {
    return;
  }

  const blockType = getBlockType();

  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;

  const candidate =
    input.value.slice(0, start) +
    event.data +
    input.value.slice(end);

  const sanitized = filter.sanitize(candidate, blockType);

  if (sanitized === candidate) return;

  event.preventDefault();

  input.setRangeText(
    sanitized.slice(start, sanitized.length - (input.value.length - end)),
    start,
    end,
    'end'
  );

  updateAST();
});
  // Добавлен флаг isFinal (потеря фокуса)
  validateAndParse(text, isFinal = false) {
    this.reset();
    let tokens = this.tokenize(text);
    this.lastProcessedTokens = this.applyPoliceRules(tokens, isFinal);
    return this.buildAST(this.lastProcessedTokens);
  }

  tokenize(text) {
    let tokens = [];
    let i = 0;

    while (i < text.length) {
      let char = text[i];
      if (/\s/.test(char)) { i++; continue; }

      // Числа
      if (/\d/.test(char)) {
        let numStr = '';
        let hasDot = false;
        let hasPeriod = false;

        while (i < text.length) {
          let c = text[i];
          if (/\d/.test(c)) {
            numStr += c;
            i++;
          } else if ((c === '.' || c === ',') && !hasDot) {
            hasDot = true;
            numStr += '.';
            i++;
          } else if (c === '(' && hasDot) {
            let lookahead = text.slice(i);
            let periodMatch = lookahead.match(/^\(\d+\)/);
            if (periodMatch) {
              numStr += periodMatch[0];
              i += periodMatch[0].length;
              hasPeriod = true;
            }
            break; 
          } else {
            break;
          }
        }
        if (numStr.endsWith('.')) {
          if (this.strictMode) throw new Error(`[Защита] Разделитель разорван`);
          numStr = numStr.slice(0, -1);
        }
        if (numStr.length > 0) tokens.push({ type: 'NUMBER', value: numStr, isPeriodic: hasPeriod });
        continue;
      }

      // Переменные
      if (/[a-zA-Z]/.test(char)) {
        let name = '';
        while (i < text.length && /[a-zA-Z]/.test(text[i])) { name += text[i]; i++; }
        let index = '';
        if (i < text.length && text[i] === '_') {
          i++; 
          while (i < text.length && /[\da-zA-Z]/.test(text[i])) { index += text[i]; i++; }
          if (index.length === 0 && this.strictMode) throw new Error(`[Защита] Оторванный индекс`);
        }
        if (FunctionRegistry.has(name)) tokens.push({ type: 'FUNCTION', name: name });
        else tokens.push({ type: 'VARIABLE', name: name, index: index || null });
        continue;
      }

      if (['.', ',', '_'].includes(char)) {
        if (this.strictMode) throw new Error(`[Защита] Изолированный разделитель`);
        i++; continue;
      }

      if (['=', '>', '<', '!'].includes(char)) {
        let op = char;
        if (i + 1 < text.length && text[i + 1] === '=') { op += '='; i++; }
        if (op === '=') {
          if (this.hasEquationOp) {
            if (this.strictMode) throw new Error(`[Защита] Повторный "="`);
            i++; continue;
          }
          this.hasEquationOp = true;
          tokens.push({ type: 'EQUATION_OP', value: op });
          i++; continue;
        }
      }

      if (PostfixUnaryRegistry.has(char)) { tokens.push({ type: 'POSTFIX_OP', value: char }); i++; continue; }
      if (['+', '-', '*', '/', '^'].includes(char)) { tokens.push({ type: 'OPERATOR', value: char }); i++; continue; }
      if (char === '(' || char === ')') { tokens.push({ type: char === '(' ? 'PAREN_OPEN' : 'PAREN_CLOSE' }); i++; continue; }
      if (char === ',') { tokens.push({ type: 'COMMA' }); i++; continue; }

      if (this.strictMode) throw new Error(`[Защита] Недопустимый символ "${char}"`);
      i++; 
    }
    return tokens;
  }

  // ПРАВИЛА ПОЛИЦЕЙСКИХ С УЧЕТОМ УХОДА ФОКУСА (isFinal)
  applyPoliceRules(tokens, isFinal) {
    let result = [];

    for (let i = 0; i < tokens.length; i++) {
      let current = tokens[i];
      let next = tokens[i + 1];

      // 1. НОРМАЛИЗАЦИЯ НА КОНЦАХ: Висячий бинарный оператор (напр. "2 + ")
      if (!next && current.type === 'OPERATOR') {
        if (!this.strictMode) {
          continue; // Просто пропускаем его (не добавляем в result), чтобы AST строилось
        } else if (isFinal) {
          throw new Error(`Ожидается операнд после "${current.value}"`);
        }
      }

      // 2. ДУБЛИРОВАНИЕ ОПЕРАТОРОВ (+ +)
      if (current.type === 'OPERATOR' && next && next.type === 'OPERATOR' && !PrefixUnaryRegistry.has(next.value)) {
        if (!this.strictMode) {
          if (isFinal) {
            tokens.splice(i + 1, 1); // Удаляем второй блок
            i--; continue; // Переоцениваем текущий с новым next
          } else {
            throw new Error(`[Автопилот] Конфликт операторов. Ожидание действия...`);
          }
        } else {
          throw new Error(`Дублирование операторов заблокировано`);
        }
      }

      // 3. ОДНОРОДНЫЕ ОПЕРАНДЫ (ЧИСЛА: 3 4)
      if (current.type === 'NUMBER' && next && next.type === 'NUMBER') {
        if (!current.isPeriodic) { // Периодические исключены (ждут умножения)
          if (!this.strictMode) {
            if (isFinal) {
              tokens.splice(i + 1, 1); // Удаляем второе число
              i--; continue;
            } else {
              throw new Error(`[Автопилот] Однородные числа. Ожидание оператора...`);
            }
          } else {
            throw new Error(`Пропущен оператор между числами`);
          }
        }
      }

      // 4. ОДНОРОДНЫЕ ОПЕРАНДЫ (ПЕРЕМЕННЫЕ: x y)
      if (current.type === 'VARIABLE' && next && next.type === 'VARIABLE') {
        if (!current.index) { // С индексами исключены (ждут умножения)
          if (!this.strictMode) {
            if (isFinal) {
              tokens.splice(i + 1, 1); // Удаляем вторую переменную
              i--; continue;
            } else {
              throw new Error(`[Автопилот] Однородные переменные. Ожидание оператора...`);
            }
          } else {
            throw new Error(`Пропущен оператор между переменными`);
          }
        }
      }

      result.push(current);

      // НЕЯВНОЕ УМНОЖЕНИЕ (Работает всегда, если операнды выжили)
      if (next) {
        if (current.type === 'NUMBER' && ['NUMBER', 'VARIABLE', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        } else if (current.type === 'VARIABLE' && ['VARIABLE', 'NUMBER', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        } else if (current.type === 'POSTFIX_OP' && ['NUMBER', 'VARIABLE', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        } else if (current.type === 'PAREN_CLOSE' && ['NUMBER', 'VARIABLE', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
      }
    }
    return result;
  }

  // ... (buildAST и parseExpression остаются без изменений, берем из предыдущей версии)
  buildAST(tokens) {
    if (tokens.length === 0) return null;
    const eqIndex = tokens.findIndex(t => t.type === 'EQUATION_OP');
    if (eqIndex !== -1) {
      const leftTokens = tokens.slice(0, eqIndex);
      const rightTokens = tokens.slice(eqIndex + 1);
      if (leftTokens.length === 0 || rightTokens.length === 0) throw new Error("Уравнение требует операндов по обе стороны");
      return new EquationNode(tokens[eqIndex].value, this.parseExpression(leftTokens), this.parseExpression(rightTokens));
    }
    return this.parseExpression(tokens);
  }

  parseExpression(tokens) {
    let index = 0;
    const parsePrimary = () => {
      if (index >= tokens.length) throw new Error("Неожиданный конец выражения");
      let token = tokens[index];
      if (token.type === 'FUNCTION') {
        let fnName = token.name;
        index++;
        if (index >= tokens.length || tokens[index].type !== 'PAREN_OPEN') throw new Error(`Ожидалась '(' после ${fnName}`);
        index++;
        let args = [];
        if (tokens[index].type !== 'PAREN_CLOSE') {
          args.push(parseExpr(0));
          while (index < tokens.length && tokens[index].type === 'COMMA') { index++; args.push(parseExpr(0)); }
        }
        if (index >= tokens.length || tokens[index].type !== 'PAREN_CLOSE') throw new Error(`Ожидалась ')' для ${fnName}`);
        index++;
        return new FunctionNode(fnName, args);
      }
      if (token.type === 'PAREN_OPEN') {
        index++;
        let expr = parseExpr(0);
        if (index >= tokens.length || tokens[index].type !== 'PAREN_CLOSE') throw new Error("Незакрытая скобка '('");
        index++;
        return new GroupNode(expr);
      }
      if (token.type === 'NUMBER') { index++; return new NumberNode(token.value, token.isPeriodic); }
      if (token.type === 'VARIABLE') { index++; return new VariableNode(token.name, token.index); }
      throw new Error(`Неожиданный токен "${token.value || token.type}"`);
    };

    const parsePostfix = () => {
      let node = parsePrimary();
      while (index < tokens.length && tokens[index].type === 'POSTFIX_OP') { node = new UnaryNode(tokens[index].value, 'postfix', node); index++; }
      return node;
    };

    const parsePrefix = () => {
      if (index < tokens.length && tokens[index].type === 'OPERATOR' && PrefixUnaryRegistry.has(tokens[index].value)) {
        let op = tokens[index].value; index++; return new UnaryNode(op, 'prefix', parsePrefix());
      }
      return parsePostfix();
    };

    const parseExpr = (minPrecedence) => {
      let left = parsePrefix();
      while (index < tokens.length && tokens[index].type === 'OPERATOR') {
        let op = tokens[index].value;
        let prec = OperatorPrecedence[op] || 0;
        if (prec < minPrecedence) break;
        index++;
        let nextMinPrec = (op === '^') ? prec : prec + 1;
        left = new BinaryNode(op, left, parseExpr(nextMinPrec));
      }
      return left;
    };

    const ast = parseExpr(0);
    if (index < tokens.length) throw new Error(`Синтаксическая ошибка рядом с "${tokens[index].value || tokens[index].type}"`);
    return ast;
  }

  /** Утилита для восстановления чистого текста после отработки Автопилота */
  reconstructText() {
    return this.lastProcessedTokens.map(t => {
      if (t.type === 'NUMBER') return t.value;
      if (t.type === 'VARIABLE') return t.name + (t.index ? '_' + t.index : '');
      if (t.type === 'FUNCTION') return t.name;
      if (['EQUATION_OP', 'OPERATOR', 'POSTFIX_OP'].includes(t.type)) return t.value;
      if (t.type === 'PAREN_OPEN') return '(';
      if (t.type === 'PAREN_CLOSE') return ')';
      if (t.type === 'COMMA') return ',';
      return '';
    }).join(' ')
      .replace(/\( /g, '(') // Красивые скобки
      .replace(/ \)/g, ')')
      .replace(/\* \*/g, '**'); // Фикс пробелов
  };
  finalizeText(text) {
  // Без автопилота:
  // никакого ремонта структуры.
  // Только проверка и минимальный откат.
  if (this.strictMode) {
    try {
      this.validateAndParse(text, true);
      return text;
    } catch {
      return '1';
    }
  }

  // Автопилот:
  // разрешаем локальные конфликты только при завершении.
  try {
    this.validateAndParse(text, true);
    return this.reconstructText();
  } catch {
    // Автопилот не обязан уметь восстановить всё.
    // Абсолютный fallback — минимальный операнд.
    return '1';
  }
}
}
