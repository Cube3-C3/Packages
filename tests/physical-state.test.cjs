const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtime,data,construction,plain}=require('./helpers.cjs');
const modules=['Geo_style/physical_geometry.js','Fis_runtime/law_executor.js','Fis_runtime/physical_state.js'];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function scene(){const r=runtime(modules),p=data(),c=construction(p,'C001');c.elements.E002[0].overrides.radius_vector=[.5,.65,0];return {r,p,c};}
function good(s){assert.equal(s.ok,true,JSON.stringify(s.diagnostics));return s;}
function q(s,id,role){return s.instances[id].quantities[role];}
test('C001 geometry, delta/P014, gravity, inverse P005 and projection share one state',()=>{
 const {r,p,c}=scene(),before=JSON.stringify(c),s=good(r.PhysicalState.compute(c,p));
 close(q(s,'spring','extension').value,.05);close(q(s,'mass','force').value[1],.1);close(q(s,'mass','acceleration').value[1],.2);
 assert.equal(s.instances.mass.geometry.sort,'Shape2');assert.equal(s.instances.mass.geometry.contour.length,4);
 close(s.instances.spring.geometry.length,.25);
 const interaction=s.interactions.link_hooke,elastic=s.occurrences[interaction.force_key];
 close(elastic.value[1],5);assert.equal(elastic.frame_id,'E0');close(elastic.application_point.value[1],.65);
 assert.ok(s.dependencies.some(d=>d.law_id==='P014'&&d.inputs.some(i=>i.path==='P014/O3/P291/O2')));
 assert.ok(s.dependencies.some(d=>d.law_id==='P005'&&d.target==='O3'));
 assert.equal(JSON.stringify(c),before);
 const model=r.ConstructLayout.fromPhysicalState(s,{pxPerMeter:300});
 assert.equal(model.physicalState,s);assert.equal(model.nodes.find(n=>n.id==='mass').quantities.acceleration.value,q(s,'mass','acceleration').value);
 const edge=model.edges.find(e=>e.occurrence_key===elastic.key);assert.ok(edge.y2>edge.y1);
 const svg=r.ConstructLayout.toSVG(model);assert.ok(svg.includes('<polygon'));assert.ok(svg.includes('<polyline'));assert.ok(svg.includes('elastic_force'));
});
test('parameter and position changes produce new snapshots without moving the prescribed body',()=>{
 const {r,p,c}=scene(),s=good(r.PhysicalState.compute(c,p)),s2=good(r.PhysicalState.recompute(s,{slotId:'spring.spring_constant',value:200}));
 close(q(s2,'mass','acceleration').value[1],10.2);close(q(s2,'mass','radius_vector').value[1],.65);close(q(s,'spring','spring_constant').value,100);
 const s3=good(r.PhysicalState.recompute(s2,{slotId:'mass.radius_vector',value:[.5,.7,0],event_id:'after'}));
 close(q(s3,'spring','extension').value,0);close(q(s3,'mass','acceleration').value[1],-9.8);
 assert.notEqual(q(s3,'mass','mass').key,q(s,'mass','mass').key);
 assert.throws(()=>r.PhysicalState.recompute(s2,{slotId:'spring.extension',value:.1}),/DERIVED_VALUE/);
 assert.throws(()=>r.PhysicalState.recompute(s,{slotId:'missing',value:1}),/UNKNOWN_OCCURRENCE/);
});
test('compressed and oblique spring directions come from geometry, with y up',()=>{
 const {r,p,c}=scene();c.elements.E002[0].overrides.radius_vector=[.5,.75,0];
 const compressed=good(r.PhysicalState.compute(c,p));close(q(compressed,'spring','extension').value,-.05);close(compressed.occurrences[compressed.interactions.link_hooke.force_key].value[1],-5);
 c.elements.E002[0].overrides.radius_vector=[.65,.7,0];const diagonal=good(r.PhysicalState.compute(c,p));
 const f=diagonal.occurrences[diagonal.interactions.link_hooke.force_key];close(f.value[0],-3);close(f.value[1],4);
});
test('law registry drives results and dimensional errors fail explicitly',()=>{
 const {r,p,c}=scene();const law=p.formulas.formulas.find(l=>l.law_id==='P014');
 law.ast={op:'eq',lhs:{operand_id:'O1'},rhs:{op:'mul',args:[{num:2},{operand_id:'O2'},{operand_id:'O3'}]}};
 const s=good(r.PhysicalState.compute(c,p));close(s.occurrences[s.interactions.link_hooke.force_key].value[1],10);
 law.ast.rhs.op='add';const bad=r.PhysicalState.compute(c,p);assert.ok(bad.diagnostics.some(d=>d.code==='DIMENSION_MISMATCH'&&d.relation_id==='link_hooke'));
});
test('link ordering and display scale do not change state; zero force has no arrow',()=>{
 const {r,p,c}=scene(),a=good(r.PhysicalState.compute(c,p));c.links.reverse();c.layout='horizontal';const b=good(r.PhysicalState.compute(c,p));
 assert.deepEqual(plain(q(a,'mass','acceleration').value),plain(q(b,'mass','acceleration').value));
 const before=JSON.stringify(plain(q(a,'mass','force')));
 const low=r.ConstructLayout.fromPhysicalState(a,{pxPerMeter:100}),high=r.ConstructLayout.fromPhysicalState(a,{pxPerMeter:900});
 assert.equal(JSON.stringify(plain(q(a,'mass','force'))),before);close(high.nodes[0].position[0]/low.nodes[0].position[0],9);
 c.elements.E001[0].overrides.natural_length=.25;
 const zero=good(r.PhysicalState.compute(c,p));
 const elastic=zero.occurrences[zero.interactions.link_hooke.force_key];assert.equal(elastic.magnitude,0);assert.equal(elastic.direction,null);
 assert.ok(!r.ConstructLayout.fromPhysicalState(zero).edges.some(e=>e.occurrence_key===elastic.key));
});
test('arbitrary dotted names and repeated include preserve participant identity',()=>{
 const {r,p,c}=scene(),renames={ceiling:'anchor.a',spring:'elastic.b',mass:'body.c'};
 Object.values(c.elements).flat().forEach(e=>e.id=renames[e.id]);
 for(const l of c.links)for(const k of Object.keys(l.of))l.of[k]=Array.isArray(l.of[k])?l.of[k].map(id=>renames[id]):renames[l.of[k]];
 p.constructs.constructions=p.constructs.constructions.map(x=>x.id==='C001'?c:x);
 const lab={id:'lab',include:[{construction:'C001',as:'left'},{construction:'C001',as:'right',overrides:{'elastic.b':{spring_constant:200}}}],elements:{},links:[]};
 const s=good(r.PhysicalState.compute(lab,p));close(q(s,'left_body.c','acceleration').value[1],.2);close(q(s,'right_body.c','acceleration').value[1],10.2);
 assert.notEqual(q(s,'left_body.c','mass').key,q(s,'right_body.c','mass').key);
 const changed=good(r.PhysicalState.recompute(s,{slotId:'left_body.c.radius_vector',value:[.5,.7,0]}));
 close(q(changed,'left_body.c','acceleration').value[1],-9.8);close(q(changed,'right_body.c','acceleration').value[1],10.2);
});
test('C010 include is executable, and C002 sums addressed forces on its body',()=>{
 const {r,p}=scene();const included=good(r.PhysicalState.compute(construction(p,'C010'),p));close(q(included,'main_mass','acceleration').value[1],-.425);
 const c=construction(p,'C002'),s=good(r.PhysicalState.compute(c,p));
 const fs=Object.values(s.interactions).filter(i=>i.kind==='attachment').map(i=>s.occurrences[i.force_key]);
 close(q(s,'mass','force').value[1],fs.reduce((n,f)=>n+f.value[1],-4.9));
 assert.equal(fs.length,2);assert.notEqual(fs[0].key,fs[1].key);
});
test('missing participants, zero mass, zero axis and series junctions have addressed blockers',()=>{
 const {r,p,c}=scene();c.links[0].of.end='absent';assert.ok(r.PhysicalState.compute(c,p).diagnostics.some(d=>d.code==='MISSING_PARTICIPANT'));
 c.links[0].of.end='mass';c.elements.E002[0].overrides.mass=0;assert.ok(r.PhysicalState.compute(c,p).diagnostics.some(d=>d.code==='INVALID_MASS'));
 c.elements.E002[0].overrides.mass=.5;c.elements.E002[0].overrides.radius_vector=[.5,.9,0];assert.ok(r.PhysicalState.compute(c,p).diagnostics.some(d=>d.code==='ZERO_VECTOR'));
 assert.ok(r.PhysicalState.compute(construction(p,'C003'),p).diagnostics.some(d=>d.code==='UNSUPPORTED_SERIES_JUNCTION'));
});
test('nonfinite geometry and duplicate instance identities are rejected',()=>{
 const {r,p,c}=scene();c.elements.E002[0].overrides.radius_vector=[Infinity,.65,0];assert.equal(r.PhysicalState.compute(c,p).ok,false);
 const lab={id:'lab',include:[{construction:'C001',as:'same'},{construction:'C001',as:'same'}],elements:{},links:[]};
 assert.ok(r.PhysicalState.compute(lab,p).diagnostics.some(d=>d.code==='DUPLICATE_INSTANCE'));
});
test('law executor requires explicit delta reference and rejects wrong quantities',()=>{
 const {r,p}=scene(),base={formulas:p.formulas,structures:p.structures,physiQuant:p.physi_quant,resolve:()=>({quantity_id:'Q008',value:.25})};
 assert.throws(()=>r.LawExecutor.execute('P291',base),e=>e.code==='DELTA_REQUIRES_PAIR');
 assert.throws(()=>r.LawExecutor.execute('P014',{...base,resolve:()=>({quantity_id:'Q003',value:1})}),e=>e.code==='QUANTITY_MISMATCH');
 assert.throws(()=>r.LawExecutor.execute('P005',{...base,target:'O3',output:{value:1,dimension:{M:1,L:1,T:-2}},resolve:()=>({quantity_id:'Q003',value:0})}),e=>e.code==='DIVISION_BY_ZERO');
});
test('geometry anchors and rotated contour share transform; zero unit is undefined',()=>{
 const {r}=scene(),g=r.GeoGeometry;
 const shape=g.build({constructor:'rect',width:2,height:1,anchors:{attachment:[1,0,0]}},[2,3,0],Math.PI/2);
 close(g.reference(shape,'attachment').value[0],2);close(g.reference(shape,'attachment').value[1],4);
 assert.throws(()=>g.unit([0,0,0]),/ZERO_VECTOR/);
});
test('construction passport renders contours/vectors from supplied state, preserves navigation exports',()=>{
 const r=runtime([...modules,'Fis_runtime/projection.js','Fis_runtime/presentation.js','Fis_runtime/package.js']),p=data(),c=construction(p,'C001');
 c.elements.E002[0].overrides.radius_vector=[.5,.65,0];const s=good(r.PhysicalState.compute(c,p));
 const calls=[],ctx=new Proxy({}, {get(target,key){return key in target?target[key]:(...args)=>{calls.push([key,args]);return key==='measureText'?{width:30}:undefined;};},set(target,key,value){target[key]=value;return true;}});
 const canvas={width:560,height:320,getContext:()=>ctx};
 const container={innerHTML:'',querySelector(selector){return selector==='.construction-env-canvas'?canvas:null;}};
 r.Projection.render(container,{data:p,projection:{kind:'construction_passport'},state:{construction_id:'C001',physical_state:s}});
 assert.ok(!container.innerHTML.includes('Ошибка рендера'),container.innerHTML);
 assert.ok(container.innerHTML.includes('<polygon'));
 assert.ok(container.innerHTML.includes('0.2000')); // acceleration is read from the supplied state
 assert.ok(calls.some(([name])=>name==='closePath'));
 assert.ok(calls.some(([name])=>name==='lineTo'));
 for(const [,args] of calls)for(const value of args)if(typeof value==='number')assert.ok(Number.isFinite(value));
 assert.equal(typeof r.FisPresentation.resolveSlotAction,'function');
 assert.equal(typeof r.FisPackage.handleSignal,'function');
});
