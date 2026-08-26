import { InputEngine } from './ast-engine.js';

const input = document.getElementById('code-input');
const output = document.getElementById('ast-output');
const statusMsg = document.getElementById('status-message');
const strictCheckbox = document.getElementById('strict-mode-toggle');

const engine = new InputEngine({ strictMode: false });

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

function updateAST() {
  const code = input.value;
  engine.setStrictMode(strictCheckbox ? strictCheckbox.checked : false);

  if (!code.trim()) {
    output.innerHTML = '';
    input.classList.remove('invalid');
    statusMsg.textContent = 'Ожидание ввода...';
    statusMsg.className = 'status ok';
    return;
  }

  try {
    const ast = engine.validateAndParse(code);
    output.innerHTML = createTreeHTML(ast);
    input.classList.remove('invalid');
    statusMsg.textContent = `✓ AST сформирован [Режим: ${engine.strictMode ? 'Защита' : 'Автопилот'}]`;
    statusMsg.className = 'status ok';
  } catch (err) {
    output.innerHTML = `<span class="error">Ошибка Парсера:\n${err.message}</span>`;
    input.classList.add('invalid');
    statusMsg.textContent = `✗ Заблокировано: ${err.message}`;
    statusMsg.className = 'status err';
  }
}

input.addEventListener('input', updateAST);
if (strictCheckbox) strictCheckbox.addEventListener('change', updateAST);
updateAST();
input.addEventListener('blur', () => {
  engine.setStrictMode(
    strictCheckbox ? strictCheckbox.checked : false
  );

  const before = input.value;
  const after = engine.finalizeText(before);

  if (after !== before) {
    input.value = after;
  }

  updateAST();
});
