/** C001 checkpoint: geometry -> addressed interactions -> P/AST -> state.
 * Pure runtime; no DOM, screen coordinates, time integration or equilibrium solver. */
(function(global){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  function compute(construction,pack,options={}){
    const GC=global.GeoCompute,M=global.Mechanics,G=global.GeoGeometry,LE=global.LawExecutor,FU=global.FisUnits;
    if(!GC||!M||!G||!LE||!FU)throw new Error('PhysicalState requires GeoCompute, Mechanics, GeoGeometry, LawExecutor and FisUnits');
    const source=clone(construction), flat=GC.expandConstruction(source,{constructs:pack.constructs,constructions:pack.constructions || pack.constructs && pack.constructs.constructions});
    const comps=pack.components.components || pack.components, frameId=flat.environment || 'E0', env=comps[frameId]||{};
    const state={construction_id:flat.id,event_id:options.event_id||'initial',frame_id:frameId,
      frame:GC.frameFromEnv(Object.assign({},env,env.frame||{})),instances:Object.create(null),occurrences:Object.create(null),
      interactions:Object.create(null),dependencies:[],diagnostics:[],slot_addresses:Object.create(null),
      source,pack,change_options:{event_id:options.event_id||'initial'},construction:null,derived:[]};
    function fail(code,message,address={}){state.diagnostics.push({code,message,...address});}
    const dimensionById=Object.create(null);
    (function walk(v){if(!v||typeof v!=='object')return;if(v.id&&v.dimension!=null)dimensionById[v.id]=FU.parseDimension(v.dimension);Object.values(v).forEach(walk);})(pack.physi_quant);
    function dimension(q){if(!dimensionById[q])throw new Error('MISSING_DIMENSION');return dimensionById[q];}
    function occurrence(element,quantity,role,value,provenance,relation){
      const result=M.makeOccurrence({quantity_id:quantity,role,value,
        indexes:[{kind:'membership',construction_id:flat.id,...(element?{element_id:element}:{}),...(relation?{relation_id:relation}:{})},{kind:'event',event_id:state.event_id}],
        ...(Array.isArray(value)?{frame_id:frameId}:{}),provenance});
      if(!result.ok)throw new Error(result.error);
      const o=result.value;o.key=M.occurrenceKey(o);o.dimension=dimension(quantity);
      if(Array.isArray(value)){o.magnitude=G.length(value);o.direction=o.magnitude?value.map(v=>v/o.magnitude):null;}
      state.occurrences[o.key]=o;return o;
    }
    function param(instance,role){
      if(!instance || !instance.quantities[role]){const e=new Error('Missing role: '+role);e.code='MISSING_OCCURRENCE';throw e;}
      return instance.quantities[role];
    }
    function write(instance,role,o){const old=instance.quantities[role];if(old&&old.key!==o.key)delete state.occurrences[old.key];instance.quantities[role]=o;const p=instance.params.find(p=>p.role===role);if(p){p.value=clone(o.value);state.slot_addresses[p.id]=o.key;}else instance.params.push({id:instance.id+'.'+role,quantity:o.quantity_id,role,value:clone(o.value)});}
    const ids=new Set();
    for(const el of flat.elements){
      if(ids.has(el.id)){fail('DUPLICATE_INSTANCE','Duplicate expanded instance id',{element_id:el.id});continue;}ids.add(el.id);
      const comp=comps[el.component];if(!comp){fail('UNKNOWN_COMPONENT',el.component,{element_id:el.id});continue;}
      const instance={id:el.id,component:el.component,params:GC.resolveElementParams(el,comp),quantities:Object.create(null)};
      state.instances[el.id]=instance;
      try{
        for(const p of instance.params){
          if(!p.quantity)continue;
          if(instance.quantities[p.role]){fail('DUPLICATE_ROLE',p.role,{element_id:el.id});continue;}
          const o=occurrence(el.id,p.quantity,p.role,p.value,{source:'parameter',slot_id:p.id});
          instance.quantities[p.role]=o;
          if(state.slot_addresses[p.id])fail('DUPLICATE_SLOT',p.id,{element_id:el.id});else state.slot_addresses[p.id]=o.key;
        }
        const position=param(instance,'radius_vector').value;
        instance.transform={position:clone(position),rotation:el.rotation || 0,frame_id:frameId};
        instance.geometry=G.build(el.geometry || comp.geometry,position,instance.transform.rotation);
      }catch(e){fail(e.code||e.message,e.message,{element_id:el.id});}
    }
    state.input_construction={...flat,elements:Object.values(state.instances).map(i=>({id:i.id,component:i.component,params:clone(i.params),geometry:flat.elements.find(e=>e.id===i.id).geometry,rotation:flat.elements.find(e=>e.id===i.id).rotation}))};
    const gravityParam=GC.resolveElementParams({id:frameId},env).find(p=>p.role==='free_fall_acceleration');
    const g=gravityParam?gravityParam.value:null;
    const axes=env.frame && env.frame.axes || env.axes || {y:'up'};
    const gravity=Array.isArray(g)&&[2,3].includes(g.length)&&g.every(Number.isFinite)?[g[0],g[1],g[2]||0]:typeof g==='number'&&Number.isFinite(g)&&g>=0?[0,axes.y==='down'?g:-g,0]:null;
    if(!gravity)fail('INVALID_GRAVITY','Environment requires finite gravity');
    function execute(id,relation,resolver,extra={}){
      const result=LE.execute(id,{formulas:pack.formulas||pack.physi_formulas,structures:pack.structures||pack.AST,physiQuant:pack.physi_quant,resolve:resolver,...extra});
      const dependency={relation_id:relation,law_id:id,target:result.target,inputs:result.inputs};
      state.dependencies.push(dependency);result.dependency=dependency;return result;
    }
    const relationIds=new Set(), springs=new Set();
    // Phase order comes from dependencies, not input link order.
    for(const link of flat.links.filter(l=>l.law==='P014')){
      try{
        if(!link.id||relationIds.has(link.id))throw Object.assign(new Error('Duplicate or missing relation id'),{code:'RELATION_ID'});
        relationIds.add(link.id);
        const of=link.of || {},spring=state.instances[of.spring],anchor=state.instances[of.anchor],end=state.instances[of.end];
        if(!spring||!anchor||!end)throw Object.assign(new Error('Missing attachment participant'),{code:'MISSING_PARTICIPANT'});
        if(springs.has(spring.id))throw Object.assign(new Error('One spring has multiple axis definitions'),{code:'AMBIGUOUS_ATTACHMENT'});springs.add(spring.id);
        if(end.component==='E001')throw Object.assign(new Error('Series spring junction needs an explicit constraint solver'),{code:'UNSUPPORTED_SERIES_JUNCTION'});
        const names=link.anchors || {},anchorName=names.anchor||(anchor.geometry.anchors.attachment?'attachment':'center'),endName=names.end||(end.geometry.anchors.attachment?'attachment':'center'),a=G.reference(anchor.geometry,anchorName),b=G.reference(end.geometry,endName);
        const axis=G.segment(a,b),k=param(spring,'spring_constant'),rest=param(spring,'natural_length');
        if(!(Number.isFinite(k.value)&&k.value>=0&&Number.isFinite(rest.value)&&rest.value>=0))throw Object.assign(new Error('Invalid spring parameters'),{code:'INVALID_PARAMETER'});
        spring.geometry={...axis,anchors:{start:a,end:b,center:G.point(a.value.map((v,i)=>(v+b.value[i])/2))}};
        spring.transform.position=a.value.slice();
        write(spring,'radius_vector',occurrence(spring.id,'Q008','radius_vector',a.value,{source:'geometry',relation_id:link.id}));
        const locus={kind:'attachment',relation_id:link.id,construction_id:flat.id,event_id:state.event_id,frame_id:frameId,
          participants:[anchor.id,spring.id,end.id],loci:[{element_id:anchor.id,reference:anchorName,point:a},{element_id:end.id,reference:endName,point:b}],geometry:axis,direction:axis.direction};
        state.interactions[link.id]=locus;
        const current=occurrence(spring.id,'Q008','length',axis.length,{source:'geometry',relation_id:link.id},link.id);
        state.dependencies.push({relation_id:link.id,operation:'geometry:length',inputs:[param(anchor,'radius_vector').key,param(end,'radius_vector').key],output:current.key});
        const deltaPath='P014/O3/P291/O2';
        const extensionResult=execute('P291',link.id,(path)=>path==='P291/O2'?current:null,{deltas:{'P291/O2':{reference:rest}}});
        const extension=occurrence(spring.id,'Q008','extension',extensionResult.value,{source:'law',law_id:'P291',relation_id:link.id});write(spring,'extension',extension);extensionResult.dependency.output=extension.key;
        const result=execute('P014',link.id,(path)=>path==='P014/O2'?k:path===deltaPath?current:null,{deltas:{[deltaPath]:{reference:rest}}});
        const value=axis.direction.map(v=>-v*result.value);
        const force=occurrence(end.id,'Q004','elastic_force',value,{source:'law',law_id:'P014',relation_id:link.id},link.id);
        force.application_point=b;locus.force_key=force.key;result.dependency.output=force.key;result.dependency.orientation=axis.direction;
        state.derived.push({link:link.id,law:'P014',from:anchor.id,to:end.id,k:k.value,L0:rest.value,delta_l:extension.value,F:result.value,vector:value});
      }catch(e){fail(e.code||e.message,e.message,{relation_id:link.id,law_id:link.law,path:e.path});}
    }
    for(const link of flat.links.filter(l=>l.law==='P005')){
      try{
        if(!link.id||relationIds.has(link.id))throw Object.assign(new Error('Duplicate or missing relation id'),{code:'RELATION_ID'});relationIds.add(link.id);
        const of=link.of||{},body=state.instances[of.mass];
        if(!body)throw Object.assign(new Error('Missing mass participant'),{code:'MISSING_PARTICIPANT'});
        const mass=param(body,'mass');if(!(Number.isFinite(mass.value)&&mass.value>0))throw Object.assign(new Error('Mass must be positive'),{code:'INVALID_MASS'});
        if(!gravity)throw Object.assign(new Error('Missing environment gravity'),{code:'INVALID_GRAVITY'});
        const fieldId=link.id+':gravity';
        const fieldA=occurrence(body.id,'Q006','gravity_acceleration',gravity,{source:'environment',environment_id:frameId},fieldId);
        const weightResult=execute('P005',fieldId,path=>path==='P005/O2'?mass:path==='P005/O3'?fieldA:null);
        const weight=occurrence(body.id,'Q004','gravity_force',weightResult.value,{source:'law',law_id:'P005',relation_id:fieldId},fieldId);
        weight.application_point=G.reference(body.geometry,'center');weightResult.dependency.output=weight.key;
        state.interactions[fieldId]={kind:'field',construction_id:flat.id,event_id:state.event_id,frame_id:frameId,participants:[frameId,body.id],loci:[{element_id:body.id,reference:'center',point:weight.application_point}],force_key:weight.key};
        let requested=of.springs || (of.spring?[of.spring]:[]);if(!Array.isArray(requested))requested=[requested];
        if(new Set(requested).size!==requested.length)throw Object.assign(new Error('Duplicate spring in aggregation'),{code:'AMBIGUOUS_FORCE'});
        const elastic=requested.map(sid=>{
          const matches=Object.values(state.interactions).filter(i=>i.kind==='attachment'&&i.participants[1]===sid&&i.participants[2]===body.id);
          if(matches.length!==1)throw Object.assign(new Error('No unique force applied to '+body.id+' by '+sid),{code:'MISSING_INTERACTION'});
          return state.occurrences[matches[0].force_key];
        });
        const netValue=elastic.reduce((v,f)=>v.map((x,i)=>x+f.value[i]),weight.value.slice());
        const net=occurrence(body.id,'Q004','force',netValue,{source:'aggregation',inputs:[weight.key,...elastic.map(f=>f.key)],relation_id:link.id});
        state.dependencies.push({relation_id:link.id,operation:'vector_sum',inputs:[weight.key,...elastic.map(f=>f.key)],output:net.key});
        const accelerationResult=execute('P005',link.id,path=>path==='P005/O2'?mass:null,{target:'O3',output:net});
        const acceleration=occurrence(body.id,'Q006','acceleration',accelerationResult.value,{source:'law',law_id:'P005',relation_id:link.id});
        write(body,'force',net);write(body,'acceleration',acceleration);accelerationResult.dependency.output=acceleration.key;
        state.derived.push({link:link.id,law:'P005',from:body.id,to:body.id,m:mass.value,F:net.magnitude,vector:net.value,a:acceleration.value});
      }catch(e){fail(e.code||e.message,e.message,{relation_id:link.id,law_id:link.law,path:e.path});}
    }
    for(const link of flat.links.filter(l=>!['P014','P005'].includes(l.law)))fail('UNSUPPORTED_INTERACTION','No interaction binder for this law yet',{relation_id:link.id,law_id:link.law});
    state.construction={...flat,elements:Object.values(state.instances).map(i=>({id:i.id,component:i.component,params:clone(i.params)}))};
    state.ok=state.diagnostics.length===0;return state;
  }
  function recompute(state,change){
    const c=clone(state.input_construction),opts={...state.change_options,event_id:change.event_id || state.event_id};
    const key=change.occurrence_key || state.slot_addresses[change.slotId],o=key&&state.occurrences[key];
    if(!o)throw new Error('UNKNOWN_OCCURRENCE');
    const membership=o.indexes.find(i=>i.kind==='membership');
    if(o.provenance.source!=='parameter')throw new Error('DERIVED_VALUE_IS_NOT_INPUT');
    const el=c.elements.find(e=>e.id===membership.element_id);if(!el)throw new Error('UNKNOWN_INSTANCE');
    const p=el.params.find(p=>p.role===o.role);p.value=clone(change.value);
    // Resolved parameter rows are authoritative; no stale overrides or geometry from the previous projection.
    return compute(c,state.pack,opts);
  }
  global.PhysicalState={compute,recompute};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.PhysicalState;
})(typeof window!=='undefined'?window:globalThis);
