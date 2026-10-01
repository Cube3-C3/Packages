const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function runtime(extra = []) {
  const ctx = vm.createContext({ console }); ctx.window = ctx;
  for (const file of ['Fis_runtime/units.js', 'Fis_runtime/geo_compute.js', 'Fis_runtime/mechanics.js', 'Fis_runtime/construct_layout.js', ...extra]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}
function data() {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'Fis_data', name + '.json'), 'utf8'));
  return { components: read('components'), constructs: read('constructs'), formulas: read('physi_formulas'), structures: read('AST'), usages: read('usages'), physi_quant: read('physi_quant'), units: read('units') };
}
const plain = value => JSON.parse(JSON.stringify(value));
const construction = (pack, id) => pack.constructs.constructions.find(c => c.id === id);
module.exports = { runtime, data, plain, construction, root };
