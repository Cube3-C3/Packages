const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runtime, data, construction, plain } = require('./helpers.cjs');
test('occurrence retains copied value and optional indexes normalize successfully', () => {
  const m = runtime().Mechanics, value = [1, 2, 3];
  const o = m.makeOccurrence({quantity_id:'Q008', value});
  assert.equal(o.ok, true); value[0] = 9;
  assert.deepEqual(plain(o.value.value), [1,2,3]);
  assert.deepEqual(plain(o.value.indexes), []);
});
test('identity includes role, Frame and canonical index fields, independent of order', () => {
  const m = runtime().Mechanics;
  const a = {quantity_id:'Q008', role:'extension', indexes:[{kind:'membership',construction_id:'C',element_id:'a.b|e:c'}, {kind:'event',event_id:'t'}]};
  const b = {...a, indexes:[{event_id:'t',kind:'event'}, {element_id:'a.b|e:c',construction_id:'C',kind:'membership'}]};
  assert.equal(m.occurrenceKey(a), m.occurrenceKey(b));
  assert.notEqual(m.occurrenceKey(a), m.occurrenceKey({...a,role:'natural_length'}));
  assert.notEqual(m.occurrenceKey(a), m.occurrenceKey({...a,frame_id:'other'}));
  assert.notEqual(m.occurrenceKey(a), m.occurrenceKey({...a,indexes:[{kind:'membership',construction_id:'C',element_id:'a.b',relation_id:'c'}]}));
  assert.equal(m.makeOccurrence({...a,indexes:[...a.indexes,{kind:'event',event_id:'u'}]}).error, 'INDEX_DUPLICATE');
});
test('thin and legacy occurrences use actual instance values', () => {
  const r=runtime(),p=data();
  const os=r.Mechanics.findQuantityOccurrences(construction(p,'C001'),'Q008',p.components);
  assert.ok(os.some(o=>o.role==='natural_length' && o.value===.2));
  assert.ok(os.some(o=>o.role==='extension' && o.value===0));
  assert.equal(new Set(os.map(r.Mechanics.occurrenceKey)).size,os.length);
  const legacy={id:'old',elements:[{id:'body',quantities:{m:{quantity:'Q003',value:7}}}]};
  assert.equal(r.Mechanics.findQuantityOccurrences(legacy,'Q003')[0].value,7);
});
test('repeated include keeps named participant addresses and local overrides separate',()=>{
  const r=runtime(),p=data();
  const c={id:'lab',include:[{construction:'C001',as:'left'},{construction:'C001',as:'right',overrides:{spring:{spring_constant:200}}}],elements:{},links:[]};
  const f=r.GeoCompute.expandConstruction(c,{constructions:p.constructs.constructions});
  assert.equal(f.links[0].of.end,'left_mass');
  assert.equal(f.links[2].of.end,'right_mass');
  assert.equal(f.elements.find(e=>e.id==='right_spring').overrides.spring_constant,200);
  assert.equal(f.elements.find(e=>e.id==='left_spring').overrides.spring_constant,100);
});
test('direct formula occurrence matching respects role and coordinate Frame',()=>{
 const r=runtime(),p=data();
 const law={law_id:'probe',bindings:{O2:{quantity:'Q008',role:'natural_length'}}};
 const result=r.Mechanics.linkLawToConstruction(law,construction(p,'C001'),p.components);
 assert.equal(result.value.links.length,1);assert.equal(result.value.links[0].role,'natural_length');
 assert.equal(r.Mechanics.makeOccurrence({quantity_id:'Q008',indexes:{kind:'coordinate',axis:'x'}}).error,'INDEX_FRAME');
 const a={quantity_id:'Q005',role:'velocity',indexes:[{kind:'coordinate',frame_id:'E0',axis:'x'}]};
 assert.notEqual(r.Mechanics.occurrenceKey(a),r.Mechanics.occurrenceKey({...a,indexes:[{kind:'coordinate',frame_id:'moving',axis:'x'}]}));
});
