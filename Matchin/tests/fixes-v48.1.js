async () => {
  const M=Matchin,E=M.equivalence,F=M.physics,H=M.physicsHistory,R=M.registry,X=M.expansion,results=[];
  const assert=(value,reason='Проверка не выполнена')=>{if(!value)throw Error(reason);};
  const test=(name,fn)=>{try{results.push({name,status:'PASS',evidence:fn()??null});}catch(error){results.push({name,status:'FAIL',error:error.stack||String(error)});}};
  const parse=(text,typing=false)=>{
    const editor=new M.Editor();
    if(typing)for(const char of text)editor.dispatch({type:'INSERT',position:editor.view().text.length,text:char});
    else editor.dispatch({type:'REPLACE',start:0,end:0,text});
    editor.dispatch({type:'FOCUS',position:editor.view().text.length,exit:true});
    const v=editor.view();assert(v.complete&&v.text===text,'Незавершённый или изменённый ввод '+text+' → '+v.text);return {editor,v};
  };
  const physical=(text,options={})=>{
    const parsed=parse(text),session=options.session||F.createSession();
    session.setContext({domains:options.domain===null?[]:[options.domain||'special_relativity']});
    for(const row of session.inspect(parsed.v.expressionTree,R.measurements)){
      const role=options.roles?.[row.symbol];if(!role)continue;
      const choice=row.candidates.find(c=>c.quantity_id===role||c.role===role||c.key===role);
      assert(choice||role==='ordinary','Нет роли '+row.symbol+' / '+role);
      session.select(parsed.v.expressionTree,row.id,choice?.key||'ordinary',R.measurements);
    }
    const resolution=H.resolve(parsed.v.expressionTree,{session,registry:R,complete:true});
    return {...parsed,session,rows:resolution.rows};
  };
  const simplifyDomain=d=>({impossible:d.impossible,pending:d.pending,unsupported:d.unsupported,
    components:d.components,conditions:d.conditions.map(c=>({expression:c.expression,bound:c.bound,relation:c.relation,source:c.source,variables:c.variables,disposition:c.disposition,canonical:c.canonical})),projection:d.projection});
  const check=(a,b,expected,options={})=>{
    const source=physical(a,options),candidate=parse(b),reference=H.project(source.v.expressionTree,source.rows).tree;
    const result=E.evaluate(source.v.expressionTree,candidate.v.expressionTree,undefined,{registry:R,physicsSession:source.session,...options.evaluate});
    const candidateRows=result.semanticSnapshot?.rows||H.inspect(candidate.v.expressionTree,{session:source.session,registry:R});
    const projected=H.project(candidate.v.expressionTree,candidateRows).tree;
    const projection=tree=>{try{return X.scalar(tree,{catalogue:source.session.catalogue,measurements:R.measurements});}catch(e){return {error:e.message};}};
    const diagnostic={input:{reference:a,candidate:b},parsedAST:{reference:source.v.expressionTree,candidate:candidate.v.expressionTree},
      physicalRoles:{reference:source.rows,candidate:candidateRows},coefficients:{reference:projection(reference),candidate:projection(projected)},
      dimensions:result.factors.find(f=>f.id==='dimensionalClasses'),
      admittedSets:{reference:simplifyDomain(E.physicalRestrictions(reference,R,{quantityRows:source.rows,physicsSession:source.session})),
        candidate:simplifyDomain(E.physicalRestrictions(projected,R,{quantityRows:candidateRows,physicsSession:source.session}))},
      verdict:{accepted:result.accepted,fullyVerified:result.fullyVerified,conditional:result.conditional,method:result.method,
        factors:result.factors.map(f=>({id:f.id,ok:f.ok,status:f.status,reason:f.reason})),reason:result.factors.filter(f=>!f.ok).map(f=>f.reason)},
      numericProof:result.factors.find(f=>f.id==='numericIntegrity')?.proof,domainHistory:result.domainHistory};
    assert(result.accepted===expected,JSON.stringify(diagnostic.verdict));
    return diagnostic;
  };
  const roles={E:'energy',m:'mass',c:'speed_of_light'};
  for(const [text,expected] of [
    ['c=299792458 м/с',true],['c=2 м/с',false],['c=299792,458 км/с',true],['c=300000000 м/с',false],
    ['c=2 м/1 с',false],['c>2 м/с',true],['c<2 м/с',false],['c≠2 м/с',true],
    ['c=299792458,00000000000000000001 м/с',false]
  ])test('Константа: '+text,()=>check(text,text,expected,{roles}));
  test('Обязательный: sqrt(E/m)=c → E=mc²',()=>check('sqrt(E/m)=c','E=mc²',true,{roles}));
  test('Обязательный: sqrt(E/m)=-c',()=>check('sqrt(E/m)=-c','sqrt(E/m)=-c',false,{roles}));
  test('Оператор √: √(E/m)=c → E=m*c^2',()=>check('√(E/m)=c','E=m*c^2',true,{roles}));
  test('Обратный переход с сохранением m≠0',()=>{
    const source=physical('sqrt(E/m)=c',{roles}),middle=parse('E=m*c^2'),target=parse('sqrt(E/m)=c');
    const first=E.evaluate(source.v.expressionTree,middle.v.expressionTree,undefined,{registry:R,physicsSession:source.session});assert(first.accepted);
    const second=E.evaluate(source.v.expressionTree,target.v.expressionTree,undefined,{registry:R,physicsSession:source.session,
      initialPhysics:H.capture(source.v.expressionTree,{session:source.session,registry:R,rows:source.rows}),previousTree:middle.v.expressionTree,
      previousPhysics:first.semanticSnapshot,preservedSemanticDomain:first.preservedSemanticDomain});
    assert(second.accepted,JSON.stringify(second.factors.map(f=>[f.id,f.reason])));return second.factors.map(f=>({id:f.id,ok:f.ok,reason:f.reason}));
  });
  test('Отрицательный корень нельзя спасти ручным подтверждением',()=>{
    const d=check('sqrt(E/m)=-c','E=m*c^2',false,{roles,evaluate:{confirmTreeReference:true}});return d;
  });
  test('Общий корень без физических букв: sqrt(x)=2 → x=4',()=>check('sqrt(x)=2','x=4',true,{domain:null,roles:{x:'ordinary'}}));
  test('Симметрия равенства корня: 2=sqrt(x) → 4=x',()=>check('2=sqrt(x)','4=x',true,{domain:null,roles:{x:'ordinary'}}));
  test('Корень без доказанного знака не даёт лишнюю ветвь',()=>check('sqrt(x)=y','x=y^2',false,{domain:null,roles:{x:'ordinary',y:'ordinary'}}));
  test('Неподходящий знак: sqrt(x)=-2 → x=4',()=>check('sqrt(x)=-2','x=4',false,{domain:null,roles:{x:'ordinary'}}));
  test('Неправильный коэффициент после корня',()=>check('sqrt(E/m)=c','E=2*m*c^2',false,{roles}));
  test('Равенство с неправильной размерностью',()=>check('c=299792458 м/с','c=299792458 м',false,{roles}));
  test('При смене компонентов численные условия сохраняются',()=>check('c=299792458 м/с','2 м/с=2 м/с',false,{roles}));
  test('Разные физические роли не получают успех из пустого среза',()=>check('m','E',false,{roles}));
  test('Одинаковые размерности разных ролей не заменяют числовое свидетельство',()=>{
    const d=check('E','A',false,{domain:'mechanics',roles:{E:'energy',A:'work'},evaluate:{confirmTreeReference:true}});
    assert(d.dimensions.ok);assert(d.verdict.factors.some(f=>f.id==='numericIntegrity'&&!f.ok));assert(d.numericProof&&!d.numericProof.numericWitness.available);return d;
  });
  test('Численная константа не равна произвольной скорости',()=>check('c','v',false,{roles:{c:'speed_of_light',v:'velocity'},evaluate:{confirmTreeReference:true}}));
  test('Численный коэффициент символического выражения не обходится подтверждением',()=>check('m+1 кг','2*m+1 кг',false,{roles,evaluate:{confirmTreeReference:true}}));

  for(const text of ['sqrt(E/m)','√(E/m)','2sqrt(E/m)','xsqrt(E/m)','sqrt(E/m)+sqrt(x)','sin(x)','f(x;y)'])for(const typing of [false,true])test('Блочная грамматика '+(typing?'посимвольно: ':'вставка: ')+text,()=>{
    const {v}=parse(text,typing),nodes=[];const walk=n=>{nodes.push(n);for(const c of n.children||[])walk(c);};walk(v.expressionTree);
    const rows=F.createSession().inspect(v.expressionTree,R.measurements);
    assert(!rows.some(r=>r.symbol==='sqrt'),'sqrt оказался переменной');
    if(text.includes('sqrt'))assert(nodes.some(n=>n.kind==='function'&&n.children.find(c=>c.kind==='function_name')?.value==='sqrt'),'Нет функции sqrt');
    if(text.includes('√'))assert(nodes.some(n=>n.kind==='unod'&&n.operator==='√'),'Нет унарного корня');
    return {parsedAST:v.expressionTree,physicalRoles:rows.map(r=>r.symbol)};
  });
  test('Имя sqrt до ввода скобки — незавершённая функция',()=>{
    const e=new M.Editor();for(const c of 'sqrt')e.dispatch({type:'INSERT',position:e.view().text.length,text:c});
    const v=e.view();assert(!v.complete,'Имя без аргументов завершено');assert(!F.createSession().inspect(v.expressionTree,R.measurements).some(r=>r.symbol==='sqrt'));
    return {complete:v.complete,drafts:v.drafts,ast:v.expressionTree};
  });
  test('Переименование функции и undo/redo сохраняют аргументы',()=>{
    const {editor:e}=parse('sin(x)');e.dispatch({type:'REPLACE',start:0,end:3,text:'sqrt'});
    assert(e.view().complete&&e.view().text==='sqrt(x)');
    e.dispatch({type:'UNDO'});assert(e.view().text==='sin(x)');e.dispatch({type:'REDO'});assert(e.view().text==='sqrt(x)');
    const rows=F.createSession().inspect(e.view().expressionTree,R.measurements);assert(!rows.some(r=>r.symbol==='sqrt'));return e.view().expressionTree;
  });
  test('Обязательный: x/x → 1 сохраняет x≠0',()=>{
    const d=check('x/x','1',true,{domain:null,roles:{x:'ordinary'}});
    const domains=d.numericProof.domains;
    assert(domains.candidate.conditions.some(c=>c.relation==='≠'&&c.variables.some(v=>v.includes('"x"'))));
    assert(domains.candidate.components.find(c=>c.symbol==='x').intervals.length===2);return d;
  });
  for(const [a,b] of [['2+2=5','2+2=5'],['1=2','3=4'],['sqrt(-1)=2','sqrt(-1)=2']])test('Ложное или неопределённое исходное утверждение: '+a,()=>check(a,b,false,{domain:null}));
  test('Фокус пустых множеств: истинность и эквивалентность различаются',()=>{
    const t=parse('1').v.expressionTree,empty={components:[],conditions:[],unsupported:[],pending:false,impossible:true};
    const assertion=E.criteria.solutionRanges(t,t,null,{registry:R,initialDomain:empty,candidateDomain:empty,compareEmptySets:true});
    const sets=E.criteria.solutionRanges(t,t,null,{registry:R,initialDomain:empty,candidateDomain:empty,compareEmptySets:true,focus:'set-equivalence'});
    assert(!assertion.ok&&sets.ok);return {assertion,sets};
  });
  const custom=(coefficient,options={})=>{
    const original=F.store.catalogue,base=original.usages.find(u=>u.role==='speed_of_light'),entry=structuredClone(base);
    Object.assign(entry,{quantity_id:'C901',key:'quantity:registry-test-C901',role:'registry_test',name_id:'registry_test',symbol:'z',coefficient_value:coefficient,
      constraint:{...entry.constraint,quantity_id:'C901',role:'registry_test',kind:options.kind||'positive'}});
    const catalogue={...original,quantities:[...original.quantities,{id:'C901',dimension:entry.dimension,coefficient_value:coefficient}],usages:[...original.usages,entry],
      lookupSymbol:(symbol,context)=>symbol==='z'?[entry]:original.lookupSymbol(symbol,context)};
    return {session:F.createSession({catalogue}),roles:{z:entry.key}};
  };
  const registryBundle=Object.fromEntries(await Promise.all(Object.entries(F.store.source.files).map(async([key,path])=>[key,await (await fetch('https://raw.githubusercontent.com/Cube3-C3/Packages/'+F.store.source.revision+'/'+path)).json()])));
  test('Новая константа загружается полным адаптером JSON без изменения ядра',()=>{
    const bundle=structuredClone(registryBundle),constants=bundle.physi_quant.quantities['физическая величина']['фундаментальная константа'],entry=structuredClone(constants.find(q=>q.id==='C001'));
    entry.id='C901';entry.coefficient_value={expression:['integer','17'],unit_system:'SI',exact:true,source:{edition:'Тест данных реестра'}};constants.push(entry);
    bundle.usages.usages.C901=[{name_id:'S901',symbol:'z',name:['registry constant','константа реестра'],domains:['general'],role:'test_constant'}];
    bundle.quantity_constraints.ranges.positive.push('C901');
    const catalogue=F.buildCatalogue(bundle,F.store.source),s=F.createSession({catalogue});
    const record=catalogue.usages.find(r=>r.quantity_id==='C901');assert(record.coefficient_value.expression[1]==='17');
    return check('z=17 м/с','z=17 м/с',true,{session:s,roles:{z:record.key}});
  });
  const coefficient=(expression,exact=true,uncertainty=null)=>({expression,exact,unit_system:'SI',source:{edition:'Регрессионная запись'},...(uncertainty?{standard_uncertainty:uncertainty}:{})});
  test('Новая константа только через реестр: z=7/3 м/с',()=>check('z=7 м/3 с','z=7 м/3 с',true,custom(coefficient(['/',['integer','7'],['integer','3']]))));
  test('Новая константа только через реестр: ложное z=2 м/с',()=>check('z=2 м/с','z=2 м/с',false,custom(coefficient(['/',['integer','7'],['integer','3']]))));
  test('Точное значение приоритетнее общего положительного диапазона',()=>{
    const opts=custom(coefficient(['integer','-2'])),d=check('z=-2 м/с','z=-2 м/с',true,opts);
    const range=d.admittedSets.reference.components.find(c=>c.symbol==='z');assert(range.intervals[0].lo.n==='-2');return d;
  });
  test('Обязательный: неизвестная физическая константа без значения',()=>{
    const d=check('z=2 м/с','z=2 м/с',false,custom(null));
    assert(d.coefficients.reference.expansions.length===0);assert(d.verdict.factors.some(f=>f.id==='numericIntegrity'&&f.status==='unknown'));return d;
  });
  const measured=()=>custom(coefficient(['decimal','10'],false,{mantissa:'0.25',exponent:'0',unit_system:'SI'}));
  test('Приближённая константа: точное равенство центру не удостоверено',()=>check('z=10 м/с','z=10 м/с',false,measured()));
  test('Приближённая константа: несовместимое значение отвергнуто',()=>check('z=11 м/с','z=11 м/с',false,measured()));
  test('Приближённая константа: неравенство в пределах u помечено условным',()=>{
    const d=check('z>9 м/с','z>9 м/с',true,measured());assert(d.verdict.conditional&&!d.verdict.fullyVerified);return d;
  });
  test('Приближённая константа: неравенство внутри интервала не доказано',()=>check('z>10 м/с','z>10 м/с',false,measured()));
  test('Приближённая константа: явная точность сохраняет рациональные границы',()=>{
    const options=measured(),source=physical('z',options),tree=H.project(source.v.expressionTree,source.rows).tree,
      domain=E.physicalRestrictions(tree,R,{quantityRows:source.rows,physicsSession:source.session});
    const c=domain.components.find(c=>c.symbol==='z');assert(c.intervals[0].lo.n==='39'&&c.intervals[0].lo.d==='4'&&c.intervals[0].hi.n==='41'&&c.intervals[0].hi.d==='4');return domain;
  });
  test('Приближённая константа без зарегистрированной точности не получает допуск',()=>check('z=10 м/с','z=10 м/с',false,custom(coefficient(['decimal','10'],false))));
  test('Рекурсивная ссылка нового значения на зарегистрированную константу',()=>check('z=299792459 м/с','z=299792459 м/с',true,custom(coefficient(['+',['ref','constant','C001'],['integer','1']]))));
  test('deriveRestrictions читает значение из физического AST без списка строк',()=>{
    const s=physical('c',{roles}),tree=H.project(s.v.expressionTree,s.rows).tree,domain=E.deriveRestrictions(tree,R,{physicsSession:s.session});
    assert(domain.components.find(c=>c.symbol==='c').domain==='{299792458}');return domain;
  });
  for(const [a,b] of [['c²','c^2'],['mc²','m*c^2'],['(x+1)²','(x+1)^2'],['x⁻²','x^-2'],['x¹²','x^12']])test('Надстрочная степень через блочный EDIT: '+a,()=>check(a,b,true,{roles,domain:a.includes('x')?null:undefined}));
  test('SI-проекция сохраняет каноническое дерево и EDIT',()=>{
    const source=physical('c*(23 см²)',{roles}),before=JSON.stringify({tree:source.editor.tree,tokens:source.editor.tokens,history:source.editor.history,journal:source.editor.journal,caret:source.editor.caret}),projected=H.project(source.v.expressionTree,source.rows).tree,semBefore=JSON.stringify(projected);
    const out=X.scalar(projected,{physicsSession:source.session,rows:source.rows,measurements:R.measurements});
    assert(JSON.stringify(projected)===semBefore);assert(JSON.stringify({tree:source.editor.tree,tokens:source.editor.tokens,history:source.editor.history,journal:source.editor.journal,caret:source.editor.caret})===before);
    assert(out.expansions.some(r=>r.kind==='usage')&&out.expansions.some(r=>r.kind==='prefix'));return out;
  });
  const uiField=()=>M.createField(70,120,false);
  const set=(f,text,choiceRoles=roles)=>{
    f.physicsSession.setContext({domains:['special_relativity']});f.act({type:'REPLACE',start:0,end:f.editor.view().text.length,text});f.act({type:'FOCUS',position:f.editor.view().text.length,exit:true});
    for(const row of f.physicsSession.inspect(f.editor.view().expressionTree,R.measurements))if(choiceRoles[row.symbol]){
      const choice=row.candidates.find(c=>c.role===choiceRoles[row.symbol]||c.quantity_id===choiceRoles[row.symbol]);if(choice)f.physicsSession.select(f.editor.view().expressionTree,row.id,choice.key,R.measurements);
    }
    f.refreshPhysicsUI();f.refreshComponentRestrictions?.(f.editor.view());
  };
  test('UI: точное ОДЗ c отображается как одноточечное множество в СИ',()=>{
    const f=uiField();set(f,'c=299792458 м/с');
    const c=f.componentRestrictions.components.find(c=>c.symbol==='c');assert(c.domain==='{299792458}',JSON.stringify(c));
    if(document.querySelector('.restrictions-dock')?.dataset.domainView!=='list')document.querySelector('.domain-toggle').click();
    const row=[...f.physicsRows.children].find(r=>r.dataset.physicsSymbol==='c');assert(row.domainView.now.textContent==='c {299792458} м/с',row.domainView.now.textContent);
    assert(!row.domainView.now.hidden&&getComputedStyle(row.domainView.box).display!=='none');assert(row.domainView.now.title.includes('SI 2019'));
    const out={text:row.domainView.now.textContent,title:row.domainView.now.title,domain:c};f.destroy();return out;
  });
  test('UI: начальная каретка отвергает c=2 м/с',()=>{
    const f=uiField();set(f,'c=2 м/с');const started=f.startTransformationHistory();assert(!started&&!f.transformationHistory);const out={started,text:f.editor.view().text};f.destroy();return out;
  });
  test('UI: история принимает корень, сохраняет ограничения и undo/redo',()=>{
    const f=uiField();set(f,'sqrt(E/m)=c');assert(f.startTransformationHistory(),'История корня не началась');
    const initial=JSON.stringify(f.transformationHistory.initialSemanticDomain);set(f,'E=m*c^2');
    assert(f.transformationHistory.lastResult.accepted,JSON.stringify(f.transformationHistory.lastResult.factors.map(f=>[f.id,f.reason])));
    assert(f.transformationHistory.entries.length===2);assert(JSON.stringify(f.transformationHistory.initialSemanticDomain)===initial);
    const domain=f.transformationHistory.lastResult.preservedSemanticDomain,mass=domain.components.find(c=>c.symbol==='m'),light=domain.components.find(c=>c.symbol==='c');
    assert(mass.intervals[0].lo.n==='0'&&!mass.intervals[0].lc);assert(light.domain==='{299792458}');
    f.act({type:'UNDO'});assert(f.editor.view().text==='sqrt(E/m)=c');f.act({type:'REDO'});assert(f.editor.view().text==='E=m*c^2');
    const out={entries:f.transformationHistory.entries.length,domain:simplifyDomain(domain)};f.destroy();return out;
  });
  return {version:'48.1-fixed',results,counts:{PASS:results.filter(r=>r.status==='PASS').length,FAIL:results.filter(r=>r.status==='FAIL').length}};
}
