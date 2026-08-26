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
    this.strictMode =
      options.strictMode !== undefined
        ? Boolean(options.strictMode)
        : false;

    // Автопилот — отдельная функция от режима защиты.
    this.autopilot =
      options.autopilot !== undefined
        ? Boolean(options.autopilot)
        : true;

    this.lastProcessedTokens = [];

    this.reset();
  }

  setStrictMode(value) {
    this.strictMode = Boolean(value);
  }

  setAutopilot(value) {
    this.autopilot = Boolean(value);
  }

  reset() {
    this.hasEquationOp = false;
    this.lastProcessedTokens = [];
  }

  /**
   * Основной live-конвейер.
   *
   * isFinal = false:
   * пользователь ещё редактирует.
   *
   * isFinal = true:
   * пользователь завершил редактирование / ушёл из блока.
   */
  validateAndParse(text, isFinal = false) {
    this.reset();

    const tokens = this.tokenize(text);

    this.lastProcessedTokens =
      this.applyPoliceRules(tokens, isFinal);

    return this.buildAST(this.lastProcessedTokens);
  }

  /**
   * Финализация блока.
   *
   * Автопилот включён:
   *   разрешаем локальные конфликты на завершении.
   *
   * Автопилот выключен:
   *   ничего не ремонтируем;
   *   если состояние невозможно завершить —
   *   возвращаем минимальный операнд.
   */
  finalizeText(text) {
    if (!text || !text.trim()) {
      return '1';
    }

    try {
      this.validateAndParse(text, true);

      if (this.autopilot) {
        return this.reconstructText();
      }

      return text;
    } catch (error) {
      if (this.autopilot) {
        return '1';
      }

      // Без автопилота единственный fallback.
      return '1';
    }
  }

  tokenize(text) {
    const tokens = [];
    let i = 0;

    while (i < text.length) {
      const char = text[i];

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // =========================
      // ЧИСЛА
      // =========================

      if (/\d/.test(char)) {
        let numStr = '';
        let hasDot = false;
        let hasPeriod = false;

        while (i < text.length) {
          const c = text[i];

          if (/\d/.test(c)) {
            numStr += c;
            i++;

          } else if (
            (c === '.' || c === ',') &&
            !hasDot
          ) {
            hasDot = true;
            numStr += '.';
            i++;

          } else if (c === '(' && hasDot) {
            const lookahead = text.slice(i);
            const periodMatch =
              lookahead.match(/^\(\d+\)/);

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
          if (this.strictMode) {
            throw new Error(
              `[Защита] Разделитель разорван`
            );
          }

          numStr = numStr.slice(0, -1);
        }

        if (numStr.length > 0) {
          tokens.push({
            type: 'NUMBER',
            value: numStr,
            isPeriodic: hasPeriod
          });
        }

        continue;
      }

      // =========================
      // ПЕРЕМЕННЫЕ / ФУНКЦИИ
      // =========================

      if (/[a-zA-Z]/.test(char)) {
        let name = '';

        while (
          i < text.length &&
          /[a-zA-Z]/.test(text[i])
        ) {
          name += text[i];
          i++;
        }

        let index = '';

        if (i < text.length && text[i] === '_') {
          i++;

          while (
            i < text.length &&
            /[\da-zA-Z]/.test(text[i])
          ) {
            index += text[i];
            i++;
          }

          if (
            index.length === 0 &&
            this.strictMode
          ) {
            throw new Error(
              `[Защита] Оторванный индекс`
            );
          }
        }

        if (FunctionRegistry.has(name)) {
          tokens.push({
            type: 'FUNCTION',
            name
          });
        } else {
          tokens.push({
            type: 'VARIABLE',
            name,
            index: index || null
          });
        }

        continue;
      }

      // Изолированные разделители.
      if (['.', ',', '_'].includes(char)) {
        if (this.strictMode) {
          throw new Error(
            `[Защита] Изолированный разделитель`
          );
        }

        i++;
        continue;
      }

      // =========================
      // УРАВНЕНИЕ
      // =========================

      if (['=', '>', '<', '!'].includes(char)) {
        let op = char;

        if (
          i + 1 < text.length &&
          text[i + 1] === '='
        ) {
          op += '=';
          i++;
        }

        if (op === '=') {
          if (this.hasEquationOp) {
            if (this.strictMode) {
              throw new Error(
                `[Защита] Повторный "="`
              );
            }

            i++;
            continue;
          }

          this.hasEquationOp = true;

          tokens.push({
            type: 'EQUATION_OP',
            value: op
          });

          i++;
          continue;
        }
      }

      // =========================
      // ОПЕРАТОРЫ
      // =========================

      if (PostfixUnaryRegistry.has(char)) {
        tokens.push({
          type: 'POSTFIX_OP',
          value: char
        });

        i++;
        continue;
      }

      if (['+', '-', '*', '/', '^'].includes(char)) {
        tokens.push({
          type: 'OPERATOR',
          value: char
        });

        i++;
        continue;
      }

      if (char === '(' || char === ')') {
        tokens.push({
          type:
            char === '('
              ? 'PAREN_OPEN'
              : 'PAREN_CLOSE'
        });

        i++;
        continue;
      }

      if (char === ',') {
        tokens.push({
          type: 'COMMA'
        });

        i++;
        continue;
      }

      // Всё остальное.
      if (this.strictMode) {
        throw new Error(
          `[Защита] Недопустимый символ "${char}"`
        );
      }

      i++;
    }

    return tokens;
  }

  /**
   * Автопилот / разрешение локальных конфликтов.
   *
   * ВАЖНО:
   * strictMode отвечает за защиту.
   * autopilot отвечает за автоматическое разрешение.
   */
  applyPoliceRules(tokens, isFinal) {
    const result = [];

    for (let i = 0; i < tokens.length; i++) {
      const current = tokens[i];
      const next = tokens[i + 1];

      // =====================================
      // 1. ВИСЯЧИЙ ОПЕРАТОР
      // =====================================

      if (
        !next &&
        current.type === 'OPERATOR'
      ) {
        if (this.strictMode && isFinal) {
          throw new Error(
            `Ожидается операнд после "${current.value}"`
          );
        }

        // Live-редактирование:
        // оператор может временно оставаться.
        //
        // При автопилоте на финализации
        // удаляем его из результата.
        if (this.autopilot && isFinal) {
          continue;
        }

        // Без автопилота ничего не исправляем.
        if (!this.autopilot) {
          result.push(current);
          continue;
        }

        // Live autopilot:
        // ждём дальнейшего ввода.
        continue;
      }

      // =====================================
      // 2. ДУБЛИРОВАНИЕ ОПЕРАТОРОВ
      // =====================================

      if (
        current.type === 'OPERATOR' &&
        next &&
        next.type === 'OPERATOR' &&
        !PrefixUnaryRegistry.has(next.value)
      ) {
        if (this.strictMode) {
          throw new Error(
            `Дублирование операторов заблокировано`
          );
        }

        // Без автопилота конфликт остаётся.
        if (!this.autopilot) {
          result.push(current);
          continue;
        }

        // Автопилот только на финале
        // удаляет конфликтующий второй оператор.
        if (isFinal) {
          tokens.splice(i + 1, 1);
          i--;
          continue;
        }

        // Во время ввода просто ждём.
        throw new Error(
          `[Автопилот] Конфликт операторов. Ожидание действия...`
        );
      }

      // =====================================
      // 3. ДВА ЧИСЛА
      // =====================================

      if (
        current.type === 'NUMBER' &&
        next &&
        next.type === 'NUMBER'
      ) {
        if (!current.isPeriodic) {
          if (this.strictMode) {
            throw new Error(
              `Пропущен оператор между числами`
            );
          }

          if (!this.autopilot) {
            result.push(current);
            continue;
          }

          if (isFinal) {
            tokens.splice(i + 1, 1);
            i--;
            continue;
          }

          throw new Error(
            `[Автопилот] Однородные числа. Ожидание оператора...`
          );
        }
      }

      // =====================================
      // 4. ДВЕ ПЕРЕМЕННЫЕ
      // =====================================

      if (
        current.type === 'VARIABLE' &&
        next &&
        next.type === 'VARIABLE'
      ) {
        if (!current.index) {
          if (this.strictMode) {
            throw new Error(
              `Пропущен оператор между переменными`
            );
          }

          if (!this.autopilot) {
            result.push(current);
            continue;
          }

          if (isFinal) {
            tokens.splice(i + 1, 1);
            i--;
            continue;
          }

          throw new Error(
            `[Автопилот] Однородные переменные. Ожидание оператора...`
          );
        }
      }

      // =====================================
      // СОХРАНЕНИЕ ТЕКУЩЕГО ТОКЕНА
      // =====================================

      result.push(current);

      // =====================================
      // НЕЯВНОЕ УМНОЖЕНИЕ
      // =====================================

      if (next) {
        if (
          current.type === 'NUMBER' &&
          [
            'NUMBER',
            'VARIABLE',
            'FUNCTION',
            'PAREN_OPEN'
          ].includes(next.type)
        ) {
          result.push({
            type: 'OPERATOR',
            value: '*'
          });

        } else if (
          current.type === 'VARIABLE' &&
          [
            'VARIABLE',
            'NUMBER',
            'FUNCTION',
            'PAREN_OPEN'
          ].includes(next.type)
        ) {
          result.push({
            type: 'OPERATOR',
            value: '*'
          });

        } else if (
          current.type === 'POSTFIX_OP' &&
          [
            'NUMBER',
            'VARIABLE',
            'PAREN_OPEN'
          ].includes(next.type)
        ) {
          result.push({
            type: 'OPERATOR',
            value: '*'
          });

        } else if (
          current.type === 'PAREN_CLOSE' &&
          [
            'NUMBER',
            'VARIABLE',
            'FUNCTION',
            'PAREN_OPEN'
          ].includes(next.type)
        ) {
          result.push({
            type: 'OPERATOR',
            value: '*'
          });
        }
      }
    }

    return result;
  }

  buildAST(tokens) {
    if (tokens.length === 0) {
      return null;
    }

    const eqIndex =
      tokens.findIndex(
        t => t.type === 'EQUATION_OP'
      );

    if (eqIndex !== -1) {
      const leftTokens =
        tokens.slice(0, eqIndex);

      const rightTokens =
        tokens.slice(eqIndex + 1);

      if (
        leftTokens.length === 0 ||
        rightTokens.length === 0
      ) {
        throw new Error(
          'Уравнение требует операндов по обе стороны'
        );
      }

      return new EquationNode(
        tokens[eqIndex].value,
        this.parseExpression(leftTokens),
        this.parseExpression(rightTokens)
      );
    }

    return this.parseExpression(tokens);
  }

  parseExpression(tokens) {
    let index = 0;

    const parsePrimary = () => {
      if (index >= tokens.length) {
        throw new Error(
          'Неожиданный конец выражения'
        );
      }

      const token = tokens[index];

      if (token.type === 'FUNCTION') {
        const fnName = token.name;
        index++;

        if (
          index >= tokens.length ||
          tokens[index].type !== 'PAREN_OPEN'
        ) {
          throw new Error(
            `Ожидалась '(' после ${fnName}`
          );
        }

        index++;

        const args = [];

        if (
          index < tokens.length &&
          tokens[index].type !== 'PAREN_CLOSE'
        ) {
          args.push(parseExpr(0));

          while (
            index < tokens.length &&
            tokens[index].type === 'COMMA'
          ) {
            index++;
            args.push(parseExpr(0));
          }
        }

        if (
          index >= tokens.length ||
          tokens[index].type !== 'PAREN_CLOSE'
        ) {
          throw new Error(
            `Ожидалась ')' для ${fnName}`
          );
        }

        index++;

        return new FunctionNode(
          fnName,
          args
        );
      }

      if (token.type === 'PAREN_OPEN') {
        index++;

        const expr = parseExpr(0);

        if (
          index >= tokens.length ||
          tokens[index].type !== 'PAREN_CLOSE'
        ) {
          throw new Error(
            "Незакрытая скобка '('"
          );
        }

        index++;

        return new GroupNode(expr);
      }

      if (token.type === 'NUMBER') {
        index++;

        return new NumberNode(
          token.value,
          token.isPeriodic
        );
      }

      if (token.type === 'VARIABLE') {
        index++;

        return new VariableNode(
          token.name,
          token.index
        );
      }

      throw new Error(
        `Неожиданный токен "${token.value || token.type}"`
      );
    };

    const parsePostfix = () => {
      let node = parsePrimary();

      while (
        index < tokens.length &&
        tokens[index].type === 'POSTFIX_OP'
      ) {
        node = new UnaryNode(
          tokens[index].value,
          'postfix',
          node
        );

        index++;
      }

      return node;
    };

    const parsePrefix = () => {
      if (
        index < tokens.length &&
        tokens[index].type === 'OPERATOR' &&
        PrefixUnaryRegistry.has(
          tokens[index].value
        )
      ) {
        const op = tokens[index].value;
        index++;

        return new UnaryNode(
          op,
          'prefix',
          parsePrefix()
        );
      }

      return parsePostfix();
    };

    const parseExpr = minPrecedence => {
      let left = parsePrefix();

      while (
        index < tokens.length &&
        tokens[index].type === 'OPERATOR'
      ) {
        const op = tokens[index].value;
        const prec =
          OperatorPrecedence[op] || 0;

        if (prec < minPrecedence) {
          break;
        }

        index++;

        const nextMinPrec =
          op === '^'
            ? prec
            : prec + 1;

        left = new BinaryNode(
          op,
          left,
          parseExpr(nextMinPrec)
        );
      }

      return left;
    };

    const ast = parseExpr(0);

    if (index < tokens.length) {
      throw new Error(
        `Синтаксическая ошибка рядом с "${tokens[index].value || tokens[index].type}"`
      );
    }

    return ast;
  }

  /**
   * Восстанавливает текст из обработанных токенов.
   */
  reconstructText() {
    return this.lastProcessedTokens
      .map(token => {
        if (token.type === 'NUMBER') {
          return token.value;
        }

        if (token.type === 'VARIABLE') {
          return (
            token.name +
            (token.index
              ? '_' + token.index
              : '')
          );
        }

        if (token.type === 'FUNCTION') {
          return token.name;
        }

        if (
          [
            'EQUATION_OP',
            'OPERATOR',
            'POSTFIX_OP'
          ].includes(token.type)
        ) {
          return token.value;
        }

        if (token.type === 'PAREN_OPEN') {
          return '(';
        }

        if (token.type === 'PAREN_CLOSE') {
          return ')';
        }

        if (token.type === 'COMMA') {
          return ',';
        }

        return '';
      })
      .join(' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .replace(/\* \*/g, '**');
  }
}
