import { filterInput, AdmissionContext } from './block-filter.js';
import { interpretBlocks } from './block-interpreter.js';
import { applyAutopilot } from './block-autopilot.js';
import { buildAST } from './block-ast.js';

// 1. Класс движка (теперь живет прямо здесь)
export class MatchinEngine {
  constructor(options = {}) {
    this.strictMode = options.strictMode !== undefined ? options.strictMode : false;
    this.lastProcessedBlocks = [];
  }

  setStrictMode(value) {
    this.strictMode = Boolean(value);
  }

  process(text, isFinal = false) {
    let safeText = text;
    
    if (this.strictMode) {
      const filterResult = filterInput(text, AdmissionContext.EMPTY);
      safeText = filterResult.accepted;
      if (filterResult.rejected.length > 0) {
        throw new Error(`[Защита] Ввод заблокирован. Недопустимые символы отброшены.`);
      }
    }

    const rawBlocks = interpretBlocks(safeText);

    this.lastProcessedBlocks = applyAutopilot(rawBlocks, {
      isFinal,
      strictMode: this.strictMode
    });

    return buildAST(this.lastProcessedBlocks);
  }
}

// 2. Инициализация движка в строгом режиме
const engine = new MatchinEngine({ strictMode: true });

// 3. UI Логика
const input = document.getElementById('code-input');
const output = document.getElementById('ast-output');
const statusMsg = document.getElementById('status-message');
const blockedMsg = document.getElementById('blocked-message');

// Переменные для аппаратного отката ввода
let lastValidValue = '';
let lastSelectionStart = 0;
let lastSelectionEnd = 0;

function createTreeHTML(data, isRoot = true) {
  if (data === null) return '<span class="null">null</span>';
  if (typeof data === 'string') return `<span class="string">"${data}"</span>`;
  if (typeof data === 'number') return `<span class="number">${data}</span>`;
  if (typeof data === 'boolean') return `<span class="boolean">${data}</span>`;

  if (typeof data === 'object') {
    let html = `<ul class="${isRoot ? 'tree' : ''}">`;
    if (Array.isArray(data)) {
      if (data.length === 0) return '<span>[ ]</span>';
      for (let i = 0; i < data.length; i++) {
        html += `<li><span class="key">${i}:</span> ${createTreeHTML(data[i], false)}</li>`;
      }
    } else {
      const keys = Object.keys(data);
      for (let key of keys) {
        const val = data[key];
        const keyClass = (key === 'type') ? 'node-type' : 'key';
        html += `<li><span class="${keyClass}">${key}:</span> ${createTreeHTML(val, false)}</li>`;
      }
    }
    html += '</ul>';
    return html;
  }
  return String(data);
}

function updateAST(isFinal = false) {
  const code = input.value;
  
  if (!code.trim()) {
    output.innerHTML = '';
    input.classList.remove('invalid');
    statusMsg.textContent = 'Ожидание ввода...';
    statusMsg.className = 'status ok';
    if (blockedMsg) blockedMsg.textContent = '';
    lastValidValue = code;
    return;
  }

  try {
    const ast = engine.process(code, isFinal);
    
    output.innerHTML = createTreeHTML(ast);
    input.classList.remove('invalid');
    statusMsg.textContent = '✓ Ввод валиден. AST сформирован';
    statusMsg.className = 'status ok';
    if (blockedMsg) blockedMsg.textContent = '';
    
    // Сохраняем валидное состояние
    lastValidValue = code;
    lastSelectionStart = input.selectionStart;
    lastSelectionEnd = input.selectionEnd;

  } catch (err) {
    if (err.message.includes('[Защита]')) {
      // Аппаратный откат: возвращаем текст и каретку
      input.value = lastValidValue;
      input.setSelectionRange(lastSelectionStart, lastSelectionEnd);
      
      if (blockedMsg) blockedMsg.textContent = err.message;
    } else {
      // Ошибка парсера (ввод разрешен, но AST сломано)
      output.innerHTML = `<span class="error">Ошибка Парсера:\n${err.message}</span>`;
      input.classList.add('invalid');
      statusMsg.textContent = `✗ Заблокировано: Ошибка синтаксиса`;
      statusMsg.className = 'status err';
      
      lastValidValue = code;
      lastSelectionStart = input.selectionStart;
      lastSelectionEnd = input.selectionEnd;
    }
  }
}

// 4. Обработчики событий
input.addEventListener('input', () => updateAST(false));

// Нормализация при потере фокуса (схлопывание оторванных запятых/индексов)
input.addEventListener('blur', () => updateAST(true));

// Первичный запуск
updateAST();
