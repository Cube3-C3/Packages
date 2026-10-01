const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, data, plain, construction } = require('./helpers.cjs');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
test('public runtime exports and frame roundtrip remain available', () => {
  const r = runtime();
  for (const key of ['expandConstruction', 'resolveElementParams', 'indexConstructionSlots', 'resolveLinkInstance', 'applyConstructionLinks', 'createFrame', 'toScreen', 'fromScreen', 'resolveGraphAxes']) assert.equal(typeof r.GeoCompute[key], 'function', key);
  for (const key of ['instantiateLaw', 'parseDimension', 'formatUnitForQuantity']) assert.equal(typeof r.FisUnits[key], 'function', key);
  const f = r.GeoCompute.createFrame({ viewportW: 500, viewportH: 300, scale_x: 100, scale_y: 100 });
  const p = r.GeoCompute.fromScreen(f, r.GeoCompute.toScreen(f, {x: .3, y: .7}));
  close(p.x, .3); close(p.y, .7);
});
test('thin defaults and role overrides preserve source data', () => {
  const r = runtime(), pack = data(), c = construction(pack, 'C001'), before = JSON.stringify(c);
  const p = r.GeoCompute.resolveElementParams(c.elements.E001[0], pack.components.components.E001);
  assert.equal(p.find(x => x.role === 'spring_constant').value, 100);
  assert.equal(p.find(x => x.role === 'natural_length').value, .2);
  assert.equal(p.find(x => x.role === 'extension').value, 0);
  assert.equal(JSON.stringify(c), before);
});
test('legacy link computation is characterized for C001/C002/C003/C010', () => {
  const r = runtime(), pack = data();
  for (const [id, elastic] of [['C001', 4.9], ['C002', 9.8], ['C003', 4.9]]) {
    const res = r.GeoCompute.applyConstructionLinks(construction(pack, id), { ...pack, constructions: pack.constructs.constructions, equilibrium: true });
    const ds = res.derived.filter(d => d.law === 'P014');
    const n = res.derived.find(d => d.law === 'P005');
    assert.ok(ds.length); close(n.F_elastic, elastic);
    // Historical parallel equilibrium is not a physical oracle: it applies mg/k to each spring.
    close(n.a, id === 'C002' ? -9.8 : 0);
  }
});
test('include expansion prefixes participants and applies local overrides', () => {
  const r = runtime(), pack = data();
  const c = r.GeoCompute.expandConstruction(construction(pack, 'C010'), { constructions: pack.constructs.constructions });
  assert.deepEqual(plain(c.elements.map(e => e.id)), ['main_ceiling', 'main_spring', 'main_mass']);
  assert.equal(c.elements.find(e => e.id === 'main_spring').overrides.spring_constant, 150);
  // Baseline defect: named of{} is discarded by include expansion.
  assert.equal(c.links[0].of, undefined);
});
test('recursive P014/P291 AST and output semantics are retained', () => {
  const r = runtime(), pack = data(), law = pack.formulas.formulas.find(l => l.law_id === 'P014');
  const inst = r.FisUnits.instantiateLaw(law, pack.structures, pack.usages, pack.formulas);
  assert.ok(JSON.stringify(inst.ast).includes('delta'));
  const axes = r.GeoCompute.resolveGraphAxes(law, { formulas: pack.formulas, physiQuant: pack.physi_quant, units: pack.units, usages: pack.usages });
  assert.ok(axes);
});
test('legacy layout and SVG still render C001', () => {
  const r = runtime(), pack = data();
  const model = r.ConstructLayout.layout(construction(pack, 'C001'), pack);
  assert.equal(model.nodes.length, 3);
  assert.ok(r.ConstructLayout.toSVG(model).includes('<svg'));
});
