// ast-engine.js
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
  constructor() {
    this.reset();
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

      if (/\s/.test(char)) {
        i++;
        continue;
      }

      // Разбор Чисел (целая, дробная, периодическая часть)
      if (/\d/.test(char)) {
        let numStr = '';
        let hasDot = false;
        let hasPeriod = false;

        while (i < text.length) {
          let c = text[i];
          if (/\d/.test(c)) {
            numStr += c;
          } else if ((c === '.' || c === ',') && !hasDot && !hasPeriod) {
            hasDot = true;
            numStr += '.';
          } else if (c === '(' && hasDot && !hasPeriod) {
            hasPeriod = true;
            numStr += '(';
          } else if (c === ')' && hasPeriod) {
            numStr += ')';
            i++;
            break; // Период завершен, блок числа полностью сформирован!
          } else {
            break;
          }
          i++;
        }

        if (numStr === '.' || numStr.endsWith('.')) {
          throw new Error(`Невалидный формат числа "${numStr}" в позиции ${i}`);
        }

        tokens.push({ 
          type: 'NUMBER', 
          value: numStr, 
          isPeriodic: hasPeriod && numStr.endsWith(')') 
        });
        continue;
      }

      // Переменные и Функции
      if (/[a-zA-Z]/.test(char)) {
        let name = '';
        while (i < text.length && /[a-zA-Z]/.test(text[i])) {
          name += text[i];
          i++;
        }

        let index = '';
        if (i < text.length && text[i] === '_') {
          i++;
          while (i < text.length && /[\da-zA-Z]/.test(text[i])) {
            index += text[i];
            i++;
          }
        }

        if (FunctionRegistry.has(name)) {
          tokens.push({ type: 'FUNCTION', name: name });
        } else {
          tokens.push({ type: 'VARIABLE', name: name, index: index || null });
        }
        continue;
      }

      // Знаки сравнения
      if (['=', '>', '<', '!'].includes(char)) {
        let op = char;
        if (i + 1 < text.length && text[i + 1] === '=') {
          op += '=';
          i++;
        }

        if (op === '=') {
          if (this.hasEquationOp) {
            throw new Error(`Повторный знак равенства заблокирован в позиции ${i + 1}`);
          }
          this.hasEquationOp = true;
          tokens.push({ type: 'EQUATION_OP', value: op });
          i++;
          continue;
        }
      }

      if (PostfixUnaryRegistry.has(char)) {
        tokens.push({ type: 'POSTFIX_OP', value: char });
        i++;
        continue;
      }

      if (['+', '-', '*', '/', '^'].includes(char)) {
        tokens.push({ type: 'OPERATOR', value: char });
        i++;
        continue;
      }

      if (char === '(' || char === ')') {
        tokens.push({ type: char === '(' ? 'PAREN_OPEN' : 'PAREN_CLOSE' });
        i++;
        continue;
      }

      if (char === ',') {
        tokens.push({ type: 'COMMA' });
        i++;
        continue;
      }

      throw new Error(`Недопустимый символ "${char}" в позиции ${i + 1}`);
    }

    return tokens;
  }

  /**
   * ПОЛИЦЕЙСКИЕ ПРАВИЛА (Police Rules)
   * Автоматическая коррекция связей и добавление неявного умножения
   */
  applyPoliceRules(tokens) {
    let result = [];

    for (let i = 0; i < tokens.length; i++) {
      let current = tokens[i];
      let next = tokens[i + 1];

      // Валидация повторяющихся бинарных операторов (например: * *, + *)
      if (current.type === 'OPERATOR' && next && next.type === 'OPERATOR') {
        // Исключение: разрешен префиксный унарный минус/плюс после бинарного оператора (напр. 3 * -5)
        if (!PrefixUnaryRegistry.has(next.value)) {
          throw new Error(`Дублирование операторов "${current.value}${next.value}" недопустимо`);
        }
      }

      result.push(current);

      if (next) {
        // 1. Повторяющиеся операнды (Число -> Число)
        // Если первое число было с периодической частью 1.(3)4 -> преобразуется в 1.(3) * 4
        // Если это два обычных числа при разделительном вводе -> вставляется неявное умножение
        if (current.type === 'NUMBER' && next.type === 'NUMBER') {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 2. Число -> Переменная / Функция (3x, 2sin(x))
        else if (current.type === 'NUMBER' && (next.type === 'VARIABLE' || next.type === 'FUNCTION')) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 3. Число -> Открывающая скобка (3(a+b))
        else if (current.type === 'NUMBER' && next.type === 'PAREN_OPEN') {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 4. Переменная -> Переменная (x y -> x * y)
        else if (current.type === 'VARIABLE' && (next.type === 'VARIABLE' || next.type === 'FUNCTION')) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 5. Постфиксный оператор -> Операнд (5! x -> 5! * x)
        else if (current.type === 'POSTFIX_OP' && (next.type === 'NUMBER' || next.type === 'VARIABLE' || next.type === 'PAREN_OPEN')) {
          result.push({ type: 'OPERATOR', value: '*' });
        }
        // 6. Закрывающая скобка -> Операнд ((a+b)c -> (a+b) * c)
        else if (current.type === 'PAREN_CLOSE' && (next.type === 'NUMBER' || next.type === 'VARIABLE' || next.type === 'FUNCTION' || next.type === 'PAREN_OPEN')) {
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
        throw new Error("Уравнение должно иметь вычисление слева и справа от '='");
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
      if (index >= tokens.length) throw new Error("Неожиданный конец выражения");
      let token = tokens[index];

      if (token.type === 'FUNCTION') {
        let fnName = token.name;
        index++;
        if (index >= tokens.length || tokens[index].type !== 'PAREN_OPEN') {
          throw new Error(`Ожидалась '(' после функции ${fnName}`);
        }
        index++;
        let args = [];
        if (tokens[index].type !== 'PAREN_CLOSE') {
          args.push(parseExpr(0));
          while (index < tokens.length && tokens[index].type === 'COMMA') {
            index++;
            args.push(parseExpr(0));
          }
        }
        if (index >= tokens.length || tokens[index].type !== 'PAREN_CLOSE') {
          throw new Error(`Ожидалась ')' в конце аргументов функции ${fnName}`);
        }
        index++;
        return new FunctionNode(fnName, args);
      }

      if (token.type === 'PAREN_OPEN') {
        index++;
        let expr = parseExpr(0);
        if (index >= tokens.length || tokens[index].type !== 'PAREN_CLOSE') {
          throw new Error("Незакрытая скобка '('");
        }
        index++;
        return new GroupNode(expr);
      }

      if (token.type === 'OPERATOR' && PrefixUnaryRegistry.has(token.value)) {
        let op = token.value;
        index++;
        let operand = parsePrimary();
        return new UnaryNode(op, 'prefix', operand);
      }

      if (token.type === 'NUMBER') {
        index++;
        return new NumberNode(token.value, token.isPeriodic);
      }

      if (token.type === 'VARIABLE') {
        index++;
        return new VariableNode(token.name, token.index);
      }

      throw new Error(`Неожиданная сущность "${token.value || token.type}"`);
    };

    const parsePostfix = () => {
      let node = parsePrimary();
      while (index < tokens.length && tokens[index].type === 'POSTFIX_OP') {
        let op = tokens[index].value;
        index++;
        node = new UnaryNode(op, 'postfix', node);
      }
      return node;
    };

    const parseExpr = (minPrecedence) => {
      let left = parsePostfix();

      while (index < tokens.length && tokens[index].type === 'OPERATOR') {
        let op = tokens[index].value;
        let prec = OperatorPrecedence[op] || 0;

        if (prec < minPrecedence) break;

        index++;
        let nextMinPrec = (op === '^') ? prec : prec + 1;
        let right = parseExpr(nextMinPrec);

        left = new BinaryNode(op, left, right);
      }

      return left;
    };

    const ast = parseExpr(0);
    if (index < tokens.length) {
      throw new Error(`Синтаксическая ошибка рядом с "${tokens[index].value || tokens[index].type}"`);
    }
    return ast;
  }
}