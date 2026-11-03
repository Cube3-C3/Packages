async () => {
  const M=Matchin,U=M.units,X=M.expansion,F=M.physics,E=M.equivalence,R=M.registry.measurements,
    catalogue=F.store.catalogue,results=[];
  const assert=(condition,detail='')=>{if(!condition)throw Error(detail||'assertion failed');};
  const test=(name,fn)=>{try{const evidence=fn();results.push({name,status:'PASS',evidence:evidence??null});}catch(error){results.push({name,status:'FAIL',error:error.stack||error.message});}};
  const editor=text=>{const e=new M.Editor();e.dispatch({type:'REPLACE',start:0,end:0,text});e.dispatch({type:'FOCUS',position:e.view().text.length,exit:true});assert(e.view().complete,'incomplete '+text);assert(e.view().text===text,'text changed '+text+' → '+e.view().text);return e;};
  const value=tree=>{const r=U.evaluate(tree);return r.n+'/'+r.d;};
  const coefficient=(id,options={})=>X.coefficient(id,{representation:'blocks',catalogue,...options});
  const constant=(id,options={})=>X.constant(id,{representation:'blocks',catalogue,...options});
  const parsed=text=>editor(text).view();
  const numeric=text=>parsed(text).tree;
  const normalized=text=>{const v=parsed(text);return U.normalized(v.tree,R);};
  const physical=(text,domain)=>{const v=parsed(text),session=F.createSession();session.setContext({domains:domain?[domain]:[]});const resolution=M.physicsHistory.resolve(v.expressionTree,{session,registry:M.registry,complete:true});return {v,session,rows:resolution.rows};};
  const compare=(a,b,domain)=>{const left=physical(a,domain),right=parsed(b);return E.evaluate(left.v.expressionTree,right.expressionTree,undefined,{physicsSession:left.session,registry:M.registry});};

  test('registry: eight physical constants carry coefficient values',()=>{const cs=catalogue.quantities.filter(q=>/^C\d+$/u.test(q.id));assert(cs.length===8);assert(cs.every(q=>q.coefficient_value?.source?.edition));return cs.map(q=>q.id);});
  test('registry: every physical usage receives its coefficient',()=>assert(catalogue.usages.filter(u=>/^C\d+$/u.test(u.quantity_id)).every(u=>u.coefficient_value)));
  test('registry: all 72 law entries have structural coefficients',()=>{assert(catalogue.coefficientIndex.byLaw.size===72);for(const id of catalogue.coefficientIndex.byLaw.keys())assert(coefficient(id).tree);return {laws:72,expressions:catalogue.coefficientIndex.expressions.size};});
  for(const [id,expected] of Object.entries({C001:'299792458',C002:'0.000000000000000000000000000000000662607015',C003:'0.000000000066743',C004:'8.31446261815324',C005:'0.00000000000000000000001380649',C006:'0.0000000000088541878128',C007:'0.00000125663706212',C008:'0.0000000000000000001602176634'})){
    test('constant '+id+': published SI coefficient',()=>{const x=constant(id,{exactOnly:false});assert(value(x.tree)===value(numeric(expected)),U.format(U.evaluate(x.tree)));return {rational:value(x.tree),exact:x.exact};});
  }
  test('h: all defining SI digits retained',()=>assert(M.nodeText(constant('C002').tree).includes('6,62607015')));
  test('R: full exact SI value replaces truncated decimal',()=>assert(value(constant('C004').tree)!==value(numeric('8.314462618'))));
  test('approximate G cannot authenticate an exact equality',()=>{let rejected=false;try{constant('C003');}catch(e){rejected=e.message.includes('Приближённая');}assert(rejected);});
  test('approximate constants preserve standard uncertainties',()=>{for(const id of ['C003','C006','C007']){const r=constant(id,{exactOnly:false});assert(!r.exact&&r.expansions[0].standard_uncertainty.mantissa!=='0');}});

  for(const [text,expected,power] of [
    ['23 см','0,23','1'],['23 см²','0,0023','2'],['23 см^2','0,0023','2'],
    ['(23 см)^2','0,0529','2'],['23 см⁻²','230000','-2'],['23 см^0','23','0'],
    ['23 мм²','0,000023','2'],['23 км²','23000000','2'],['(2 см²)^2','0,00000004','4'],
    ['(2 см)^-2','2500','-2'],['23 °С','296,15','1'],['(2 °С)^2','75707,5225','2'],
    ['23 г','0,023','1']
  ])test(text+': SI value and power scope',()=>{const out=normalized(text);assert(out?.value===expected&&out.power===power,JSON.stringify(out));return out;});
  test('unregistered hour is not silently treated as an SI unit',()=>assert(normalized('2 ч')===null));
  test('square centimetres and a squared quantity differ by 23',()=>assert(value(numeric(normalized('(23 см)^2').value.replace(',','.')))!==value(numeric(normalized('23 см²').value.replace(',','.')))));
  test('dimension exponent is attached to prefix, never to 23',()=>{const result=U.expand(parsed('23 см²').tree,R),q=U.quantityForm(result).quantity,v=q.parts[0],children=v.parts.filter(n=>n.kind);assert(v.meta.operatorKey==='*');assert(M.nodeText(children[0])==='23');assert(children[1].meta.operatorKey==='^');assert(M.nodeText(children[1])==='10^−2^2');});
  test('linear centimetres have exactly one prefix power',()=>{const out=U.expand(parsed('23 см').tree,R);assert([...M.walk(out)].filter(n=>n.kind==='binod'&&n.meta.operatorKey==='^').length===1);});
  test('prefix and base unit glyphs keep separate source token ids',()=>{const v=parsed('23 см²'),src=[...M.characters(v.tree)],prefix=src.find(t=>t.char==='с').id,metre=src.find(t=>t.char==='м').id,exp=src.find(t=>t.char==='²').id,projected=U.expand(v.tree,R),ts=[...M.characters(projected)];assert(ts.filter(t=>t.char==='м').every(t=>t.sourceIds.length===1&&t.sourceIds[0]===metre));assert(ts.some(t=>t.char==='0'&&t.sourceIds[0]===prefix));assert(ts.filter(t=>t.sourceIds?.includes(exp)).length>=2);});
  test('projection creates no duplicate token ids or owners',()=>{const out=U.expand(parsed('23 см²+2 мм²').tree,R),tokens=[...M.characters(out)],ids=tokens.map(t=>t.id);assert(ids.length===new Set(ids).size);for(const n of M.walk(out))for(const t of n.parts.filter(p=>p.char))assert(t.owner===n.id);});
  test('block and semantic factories preserve the same SI scalar',()=>{const v=parsed('23 см²'),block=U.expand(v.tree,R),semantic=X.expand(v.expressionTree,{representation:'expression',measurements:R,constants:false}).tree,b=M.buildExpressionTree(block);assert(E.criteria.trees(b,semantic).ok);});
  test('projection leaves EDIT tape, tree, selection and journal unchanged',()=>{const e=editor('(23 см)^2'),before=JSON.stringify({tokens:e.tokens,tree:e.tree,caret:e.caret,journal:e.journal,history:e.history});U.expand(e.tree,R);assert(before===JSON.stringify({tokens:e.tokens,tree:e.tree,caret:e.caret,journal:e.journal,history:e.history}));});
  test('derived projection is idempotent for square centimetres',()=>{const first=U.expand(parsed('23 см²').tree,R),second=U.expand(first,R);assert(E.criteria.trees(M.buildExpressionTree(first),M.buildExpressionTree(second)).ok);});
  test('incomplete dimension exponent stays a draft',()=>{const e=new M.Editor();e.dispatch({type:'REPLACE',start:0,end:0,text:'23 см^'});assert(!e.view().complete);});
  test('undo and redo retain the exponent scope',()=>{const e=editor('23 см');e.dispatch({type:'REPLACE',start:e.view().text.length,end:e.view().text.length,text:'²'});assert(U.normalized(e.tree,R).value==='0,0023');e.dispatch({type:'UNDO'});assert(U.normalized(e.tree,R).value==='0,23');e.dispatch({type:'REDO'});assert(U.normalized(e.tree,R).value==='0,0023');});

  test('Planck law expands h through a selected physical role',()=>{const {v,session,rows}=physical('E=hν','quantum_mechanics'),out=X.expand(v.tree,{representation:'blocks',physicsSession:session,rows,measurements:R});assert(out.expansions.some(r=>r.id.includes('planck_constant')));assert(M.nodeText(out.tree).includes('6,62607015'));assert([...M.walk(out.tree)].some(n=>n.kind==='dimension'));return M.nodeText(out.tree);});
  test('Planck law remains accepted by numeric and dimensional criteria',()=>{const out=compare('E=hν','E=hν','quantum_mechanics');assert(out.accepted);assert(out.factors.find(f=>f.id==='numericIntegrity').proof.registeredLaws.reference.law_ids.includes('P035'));});
  test('twice Planck law is rejected',()=>assert(!compare('E=hν','E=2*hν','quantum_mechanics').accepted));
  test('wrong initial Planck-law coefficient is rejected',()=>assert(!compare('E=2*hν','E=2*hν','quantum_mechanics').accepted));
  test('height h remains symbolic after explicit ordinary choice',()=>{const v=parsed('h'),s=F.createSession();s.setContext({domains:['quantum_mechanics']});const row=s.inspect(v.expressionTree,R).find(r=>r.symbol==='h');s.select(v.expressionTree,row.id,'ordinary',R);const out=X.expand(v.tree,{representation:'blocks',physicsSession:s,measurements:R});assert(out.expansions.length===0&&M.nodeText(out.tree)==='h');});
  test('unselected h is never guessed to be Planck constant',()=>{const v=parsed('h'),out=X.expand(v.tree,{representation:'blocks',physicsSession:F.createSession(),measurements:R});assert(out.expansions.length===0);});
  test('reduced Planck constant is h/(2pi), not h',()=>{const {v,session,rows}=physical('ℏ','quantum_mechanics'),out=X.expand(v.tree,{representation:'blocks',physicsSession:session,rows,coefficientOnly:true,measurements:R});assert(M.nodeText(out.tree).includes('/2*pi'));assert(!E.criteria.trees(M.buildExpressionTree(out.tree),M.buildExpressionTree(constant('C002').tree)).ok);});
  test('exact physical scalar algebra uses numerical c',()=>{const {v,rows}=physical('c','special_relativity'),projected=M.physicsHistory.project(v.expressionTree,rows).tree,expected=parsed('299792458').expressionTree;assert(E.criteria.trees(projected,expected).ok);});
  test('dimensional checks still reject a dimensionless replacement of h',()=>assert(!compare('E=hν','E=6.62607015*10^-34*ν','quantum_mechanics').accepted));
  test('prefix and constant expand in the same traversal',()=>{const {v,session,rows}=physical('h*(23 см²)','quantum_mechanics'),out=X.expand(v.tree,{representation:'blocks',physicsSession:session,rows,measurements:R});assert(out.expansions.some(r=>r.kind==='usage')&&out.expansions.some(r=>r.kind==='prefix'));assert(M.nodeText(out.tree).includes('6,62607015'));});
  for(const [label,expected] of [['1/2','1/2'],['2/3','2/3'],['-1','-1'],['2','2']])test('law coefficient '+label+': exact scalar',()=>assert(value(coefficient(label).tree)===value(numeric(expected))));
  test('kinetic-energy law resolves its registered one-half',()=>assert(value(coefficient('P007').tree)==='1/2'));
  test('all 67 law right-hand sides use the shared interpreter',()=>{assert(catalogue.coefficientIndex.lawExpressions.size===67);for(const id of catalogue.coefficientIndex.lawExpressions.keys())assert(X.law(id,{catalogue,representation:'expression'}).tree);return {rightHandSides:67,equationCoefficientEntries:5};});
  test('law recursion collects the one-half of kinetic energy',()=>{const x=X.law('P007',{catalogue,representation:'blocks',bindings:{'Q003.mass':['integer','2'],'Q005.velocity':['integer','3']},requireBindings:true});assert(value(x.tree)==='9/1');assert(x.expansions.some(r=>r.kind==='law'&&r.id==='P213'));});
  test('symbolic law coefficients use bound parameters recursively',()=>assert(value(coefficient('(2*k+1)/2',{bindings:{k:['integer','3']}}).tree)==='7/2'));
  test('two-pi law coefficient preserves pi symbolically',()=>assert(M.nodeText(coefficient('2*pi').tree)==='2*pi'));
  test('trigonometric coefficients preserve the structured argument',()=>{const out=coefficient('sin(omega*t+phi0)').tree,fn=[...M.walk(out)].find(n=>n.kind==='function');assert(fn);assert([...M.walk(fn)].some(n=>n.kind==='binod'&&n.meta.operatorKey==='+'));});
  test('changing coefficient data changes the shared interpreter result',()=>{const c={...catalogue,coefficientIndex:{...catalogue.coefficientIndex,expressions:new Map(catalogue.coefficientIndex.expressions)}};c.coefficientIndex.expressions.set('1/2',['/',['integer','1'],['integer','3']]);assert(value(coefficient('P007',{catalogue:c}).tree)==='1/3');});
  test('recursive coefficient references are detected',()=>{const c={...catalogue,coefficientIndex:{...catalogue.coefficientIndex,expressions:new Map(catalogue.coefficientIndex.expressions)}};c.coefficientIndex.expressions.set('cycle',['ref','coefficient','cycle']);let rejected=false;try{coefficient('cycle',{catalogue:c});}catch(e){rejected=e.message.includes('Цикл');}assert(rejected);});
  test('untrusted decimal strings cannot inject operators',()=>{let rejected=false;try{X.expand(['decimal','1+2']);}catch(e){rejected=true;}assert(rejected);});
  test('bounded work stops excessive expansion',()=>{let rejected=false;try{coefficient('(2*k+1)/2',{maxWork:2});}catch(e){rejected=e.message.includes('Предел');}assert(rejected);});

  for(const [a,b] of [['x+x','2*x'],['(a+b)^2','a^2+2*a*b+b^2'],['1/2','0.5'],['2+2','4']])test('existing algebra: '+a+' = '+b,()=>assert(compare(a,b).accepted));
  test('existing algebra rejects false arithmetic',()=>assert(!compare('2+2','5').accepted));
  test('kinetic energy with one-half is recognized',()=>assert(compare('E=m*v^2/2','E=m*v^2/2','mechanics').accepted));
  test('kinetic energy with missing one-half is rejected',()=>assert(!compare('E=m*v^2','E=m*v^2','mechanics').accepted));
  test('existing SI conversion equality still matches',()=>assert(compare('23 см²','0.0023 м²').accepted));
  test('area cannot be replaced with length',()=>assert(!compare('23 см²','0.0023 м').accepted));

  const field=M.fields[0],set=text=>{field.act({type:'REPLACE',start:0,end:field.editor.view().text.length,text});field.act({type:'FOCUS',position:field.editor.view().text.length,exit:true});field.refreshPhysicsUI();};
  test('UI: square centimetres show a visible SI projection',()=>{set('23 см²');assert(!field.measurementProjection.hidden);assert(getComputedStyle(field.measurementProjection).display!=='none');});
  test('UI: no developer structure viewer is added',()=>assert(!document.querySelector('.expanded-structure')));
  test('UI: physical selection updates numerical projection immediately',()=>{set('h');const select=field.physicsRows.querySelector('select'),choice=catalogue.usages.find(c=>c.quantity_id==='C002'&&c.role==='planck_constant');select.value=choice.key;select.dispatchEvent(new Event('change',{bubbles:true}));assert(!field.measurementProjection.hidden&&field.measurementProjection.textContent.includes('6,62607015'));select.value='ordinary';select.dispatchEvent(new Event('change',{bubbles:true}));assert(field.measurementProjection.hidden);});
  test('UI: measured constant uses approximation sign and uncertainty',()=>{field.physicsSession.setContext({domains:['mechanics']});set('G');assert(field.measurementProjection.textContent.includes('≈'));assert(field.measurementProjection.textContent.includes('0.00015'));});
  test('UI: unfinished expressions hide stale numerical values',()=>{set('h+');assert(field.measurementProjection.hidden);});
  return {version:'48-registry-expansion',engine:navigator.userAgent,results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}};
}
