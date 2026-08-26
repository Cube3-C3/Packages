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
    // strictMode = true -> Нерушимость операндов (блокировка чужеродных символов)
    // strictMode = false -> Автопилот (поедание разделителей и расщепление блоков)
    this.strictMode = options.strictMode !== undefined ? options.strictMode : false;
    this.reset();
  }

  setStrictMode(value) {
    this.strictMode = Boolean(value);
  }

  reset() {
    this.hasEquationOp = false;
  }

  validateAndParse(text) {
    this.reset();
    let tokens = this.tokenize(text);
    let processedTokens = this.applyPoliceRules(tokens);
    return this.buildAST(processedTokens);
  }

  tokenize(text) {
    let tokens = [];
    let i = 0;

    while (i < text.length) {
      let char = text[i];
      if (/\s/.test(char)) { i++; continue; }

      // =========================================================
      // 1. ОПЕРАНД: ЧИСЛО И ЕГО ТРАНСФОРМАЦИЯ / ПОЕДАНИЕ РАЗДЕЛИТЕЛЕЙ
      // =========================================================
      if (/\d/.test(char)) {
        let numStr = '';
        let hasDot = false;
        let hasPeriod = false;

        while (i < text.length) {
          let c = text[i];

          if (/\d/.test(c)) {
            numStr += c;
          } else if ((c === '.' || c === ',') && !hasDot && !hasPeriod) {
            // Проверка границы разделителя: если дальше идет чужеродный операнд/оператор
            let nextChar = text[i + 1];
            if (!this.strictMode && nextChar && /[a-zA-Z+\-*/^!]/.test(nextChar)) {
              // АВТОПИЛОТ: Оператор/переменная съедает разделительную точку
              i++; // Пропускаем '.' (съели разделитель)
              break; // Завершаем текущее целое число, дальше пойдет чужеродный символ
            }
            hasDot = true;
            numStr += '.';
          } else if (c === '(' && hasDot && !hasPeriod) {
            let nextChar = text[i + 1];
            if (!this.strictMode && nextChar && /[a-zA-Z+\-*/^!]/.test(nextChar)) {
              // АВТОПИЛОТ: Съедаем скобку периода при вводе чужеродного операнда
              i++; 
              break; 
            }
            hasPeriod = true;
            numStr += '(';
          } else if (c === ')' && hasPeriod) {
            numStr += ')';
            i++;
            break; 
          } else {
            // Прерывание числа чужеродным символом
            break; 
          }
          i++;
        }

        // Проверка повреждения разделительных элементов
        if (numStr.endsWith('.') || numStr.endsWith('(')) {
          if (this.strictMode) {
            throw new Error(`[Защита] Внутренний разделитель числа разорван в позиции ${i}. Нерушимость операнда активирована.`);
          } else {
            // Автопилот срезает висящий разделитель, превращая выжившую часть в валидный NumberNode
            numStr = numStr.slice(0, -1);
          }
        }

        if (numStr.length > 0) {
          tokens.push({ 
            type: 'NUMBER', 
            value: numStr, 
            isPeriodic: hasPeriod && numStr.endsWith(')') 
          });
        }
        continue;
      }

      // =========================================================
      // 2. ПЕРЕМЕННЫЕ (В Т.Ч. С ИНДЕКСАМИ) И ФУНКЦИИ
      // =========================================================
      if (/[a-zA-Z]/.test(char)) {
        let name = '';
        while (i < text.length && /[a-zA-Z]/.test(text[i])) {
          name += text[i];
          i++;
        }

        let index = '';
        if (i < text.length && text[i] === '_') {
          i++; // Пропуск '_'
          while (i < text.length && /[\da-zA-Z]/.test(text[i])) {
            index += text[i];
            i++;
          }
          // Если индекс обрывается неоконченным (напр. x_)
          if (index.length === 0) {
            if (this.strictMode) {
              throw new Error(`[Защита] Неполный индекс переменной в позиции ${i}`);
            }
          }
        }

        if (FunctionRegistry.has(name)) {
          tokens.push({ type: 'FUNCTION', name: name });
        } else {
          tokens.push({ type: 'VARIABLE', name: name, index: index || null });
        }
        continue;
      }

      // =========================================================
      // 3. ЗНАКИ СРАВНЕНИЯ, УРАВНЕНИЯ И ОПЕРАТОРЫ
      // =========================================================
      if (['=', '>', '<', '!'].includes(char)) {
        let op = char;
        if (i + 1 < text.length && text[i + 1] === '=') { op += '='; i++; }
        if (op === '=') {
          if (this.hasEquationOp) {
            if (this.strictMode) throw new Error(`[Защита] Повторный знак "=" заблокирован в позиции ${i + 1}`);
            i++; continue; // Автопилот просто игнорирует дублирующий знак равенства
          }
          this.hasEquationOp = true;
          tokens.push({ type: 'EQUATION_OP', value: op });
          i++;
          continue;
        }
      }

      if (PostfixUnaryRegistry.has(char)) {
        tokens.push({ type: 'POSTFIX_OP', value: char });
        i++; continue;
      }
      if (['+', '-', '*', '/', '^'].includes(char)) {
        tokens.push({ type: 'OPERATOR', value: char });
        i++; continue;
      }
      if (char === '(' || char === ')') {
        tokens.push({ type: char === '(' ? 'PAREN_OPEN' : 'PAREN_CLOSE' });
        i++; continue;
      }
      if (char === ',') {
        tokens.push({ type: 'COMMA' });
        i++; continue;
      }

      if (this.strictMode) {
        throw new Error(`[Защита] Недопустимый символ "${char}" в позиции ${i + 1}`);
      }
      i++; // Автопилот пропускает неизвестный шум
    }

    return tokens;
  }

  /**
   * ПОЛИЦЕЙСКИЕ ПРАВИЛА (Расширенное неявное умножение и контроль связей)
   */
  applyPoliceRules(tokens) {
    let result = [];

    for (let i = 0; i < tokens.length; i++) {
      let current = tokens[i];
      let next = tokens[i + 1];

      // Валидация повтора операторов
      if (current.type === 'OPERATOR' && next && next.type === 'OPERATOR') {
        if (!PrefixUnaryRegistry.has(next.value)) {
          throw new Error(`Дублирование операторов "${current.value}${next.value}" недопустимо`);
        }
      }

      result.push(current);

      if (next) {
        // 1. Число -> [Число, Переменная, Функция, (]
        if (current.type === 'NUMBER' && ['NUMBER', 'VARIABLE', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 2. Переменная (в т.ч. с индексом x_1) -> [Переменная, Число, Функция, (]
        else if (current.type === 'VARIABLE' && ['VARIABLE', 'NUMBER', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 3. Постфикс -> [Число, Переменная, (]
        else if (current.type === 'POSTFIX_OP' && ['NUMBER', 'VARIABLE', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 4. Закрывающая скобка ) -> [Число, Переменная, Функция, (]
        else if (current.type === 'PAREN_CLOSE' && ['NUMBER', 'VARIABLE', 'FUNCTION', 'PAREN_OPEN'].includes(next.type)) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
      }
    }

    return result;
  }

  buildAST(tokens) {
    if (tokens.length === 0) return null;
    const eqIndex = tokens.findIndex(t => t.type === 'EQUATION_OP');
    if (eqIndex !== -1) {
      const leftTokens = tokens.slice(0, eqIndex);
      const rightTokens = tokens.slice(eqIndex + 1);
      if (leftTokens.length === 0 || rightTokens.length === 0) {
        throw new Error("Уравнение требует операндов по обе стороны от '='");
      }
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
          while (index < tokens.length && tokens[index].type === 'COMMA') {
            index++;
            args.push(parseExpr(0));
          }
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

    // Приоритет 1: Постфиксные операторы (x!)
    const parsePostfix = () => {
      let node = parsePrimary();
      while (index < tokens.length && tokens[index].type === 'POSTFIX_OP') {
        node = new UnaryNode(tokens[index].value, 'postfix', node);
        index++;
      }
      return node;
    };

    // Приоритет 2: Префиксные операторы (-x!)
    const parsePrefix = () => {
      if (index < tokens.length && tokens[index].type === 'OPERATOR' && PrefixUnaryRegistry.has(tokens[index].value)) {
        let op = tokens[index].value;
        index++;
        return new UnaryNode(op, 'prefix', parsePrefix());
      }
      return parsePostfix();
    };

    // Приоритет 3: Бинарные операторы (+, *, ^)
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
}
