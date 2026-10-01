/** Address-bound execution of existing P laws and AST aliases. */
(function(global){
  'use strict';
  function error(code, path, message=code){ const e=new Error(message); e.code=code;e.path=path;throw e; }
  function execute(lawId, options){
    const FU=global.FisUnits, laws=FU.getLawsList(options.formulas);
    const dimensions=Object.create(null);
    (function walk(v){if(!v||typeof v!=='object')return;if(v.id&&v.dimension!=null)dimensions[v.id]=FU.parseDimension(v.dimension);Object.values(v).forEach(walk);})(options.physiQuant);
    const trace=[], stack=[];
    const finite = (v,path) => {if(Array.isArray(v)?!v.length||!v.every(Number.isFinite):!Number.isFinite(v))error('NONFINITE',path);return v;};
    const same=(a,b)=>JSON.stringify(Object.entries(a).filter(x=>x[1]).sort())===JSON.stringify(Object.entries(b).filter(x=>x[1]).sort());
    const dim=(a,b,sign)=>{const d={...a};for(const k of Object.keys(b))d[k]=(d[k]||0)+sign*b[k];return d;};
    const scale=(v,n)=>Array.isArray(v)?v.map(x=>x*n):v*n;
    const add=(a,b,sign,path)=>{
      if(Array.isArray(a)!==Array.isArray(b) || Array.isArray(a)&&a.length!==b.length)error('VALUE_SHAPE',path);
      return Array.isArray(a)?a.map((v,i)=>v+sign*b[i]):a+sign*b;
    };
    function apply(op, args, path){
      let out;
      if(op==='add'||op==='sub'){
        if(!args.length||op==='sub'&&args.length!==2)error('ARITY',path);
        if(args.some(x=>!same(x.dimension,args[0].dimension)))error('DIMENSION_MISMATCH',path);
        out={value:args.slice(1).reduce((v,x)=>add(v,x.value,op==='sub'?-1:1,path),args[0].value),dimension:args[0].dimension};
      }else if(op==='mul'){
        out={value:1,dimension:{}};
        for(const a of args){if(Array.isArray(out.value)&&Array.isArray(a.value))error('VECTOR_PRODUCT_UNSUPPORTED',path);out={value:Array.isArray(a.value)?scale(a.value,out.value):scale(out.value,a.value),dimension:dim(out.dimension,a.dimension,1)};}
      }else if(op==='div'){
        if(args.length!==2 || Array.isArray(args[1].value))error('VALUE_SHAPE',path);
        if(args[1].value===0)error('DIVISION_BY_ZERO',path);
        out={value:scale(args[0].value,1/args[1].value),dimension:dim(args[0].dimension,args[1].dimension,-1)};
      }else if(op==='neg'){
        out={value:scale(args[0].value,-1),dimension:args[0].dimension};
      }else error('UNSUPPORTED_OPERATION',path,op);
      finite(out.value,path);return out;
    }
    function run(id,prefix){
      if(stack.includes(id))error('LAW_CYCLE',prefix);
      const law=laws.find(l=>(l.law_id||l.id)===id);if(!law)error('UNKNOWN_LAW',prefix);
      if(law.kind==='equation')error('UNSUPPORTED_SOLVE',prefix);
      const structure=FU.resolveLawStructure(law,options.structures);
      if(!structure||!structure.ast)error('UNKNOWN_AST',prefix);
      stack.push(id);
      const ast=structure.ast, bindings=FU.bindingsWithDefines?FU.bindingsWithDefines(law,options.formulas):law.bindings||{};
      function read(operand){
        const path=prefix+'/'+operand,b=bindings[operand];
        if(!b)error('MISSING_BINDING',path);
        if(typeof b.num==='number')return {value:finite(b.num,path),dimension:{}};
        if(b.law||b.law_id||b.formula)return run(b.law||b.law_id||b.formula,path+'/'+(b.law||b.law_id||b.formula));
        const v=options.resolve(path,b);
        if(!v)error('MISSING_OCCURRENCE',path);
        if(v.quantity_id && String(v.quantity_id)!==String(b.quantity))error('QUANTITY_MISMATCH',path);
        const expected=dimensions[b.quantity],d=v.dimension || expected;if(!d)error('MISSING_DIMENSION',path);
        if(expected&&!same(d,expected))error('DIMENSION_MISMATCH',path);
        trace.push({path,quantity_id:b.quantity,role:b.role,occurrence_key:v.key||null});
        return {value:finite(v.value,path),dimension:d};
      }
      function evalNode(node){
        if(node.operand_id)return read(node.operand_id);
        if(typeof node.num==='number')return {value:node.num,dimension:{}};
        if(node.op==='delta'){
          const arg=node.arg || node.args[0], path=prefix+'/'+arg.operand_id;
          const pair=options.deltas && options.deltas[path];
          if(!pair)error('DELTA_REQUIRES_PAIR',path);
          const current=read(arg.operand_id), ref=pair.reference;
          if(!same(current.dimension,ref.dimension))error('DIMENSION_MISMATCH',path);
          trace.push({path:path+'/reference',occurrence_key:ref.key||null});
          return apply('sub',[current,ref],path);
        }
        return apply(node.op,(node.args || (node.arg?[node.arg]:[])).map(evalNode),prefix);
      }
      const rhs=ast.op==='eq'?ast.rhs:ast;
      let result;
      if(prefix===lawId && options.target && options.target!=='O1'){
        // Limited isolation of a single direct operand; nested-law inverses are explicit blockers.
        const target=options.target;
        const contains=n=>n && (n.operand_id===target || (n.args||[]).some(contains) || contains(n.arg));
        function isolate(n,wanted){
          if(n.operand_id===target)return wanted;
          const args=n.args||(n.arg?[n.arg]:[]),positions=args.map((a,i)=>contains(a)?i:-1).filter(i=>i>=0);
          if(positions.length!==1)error('UNSUPPORTED_SOLVE',prefix+'/'+target);
          const i=positions[0];let next;
          if(n.op==='mul'){const known=apply('mul',args.filter((_,j)=>j!==i).map(evalNode),prefix);next=apply('div',[wanted,known],prefix);}
          else if(n.op==='div'&&args.length===2){next=i===0?apply('mul',[wanted,evalNode(args[1])],prefix):apply('div',[evalNode(args[0]),wanted],prefix);}
          else if(n.op==='add'){next=apply('sub',[wanted,apply('add',args.filter((_,j)=>j!==i).map(evalNode),prefix)],prefix);}
          else if(n.op==='neg')next=apply('neg',[wanted],prefix);
          else error('UNSUPPORTED_SOLVE',prefix+'/'+target);
          return isolate(args[i],next);
        }
        if(!options.output)error('MISSING_OUTPUT',prefix);
        finite(options.output.value,prefix+'/O1');
        result=isolate(rhs,options.output);
        const binding=bindings[target];if(!binding||!same(result.dimension,dimensions[binding.quantity]||{}))error('DIMENSION_MISMATCH',prefix+'/'+target);
      }else{
        result=evalNode(rhs);
        const den=Object.entries(options.formulas.denotations||{}).find(([,items])=>items.some(x=>x.law_id===id));
        if(den && dimensions[den[0]] && !same(result.dimension,dimensions[den[0]]))error('DIMENSION_MISMATCH',prefix+'/O1');
      }
      stack.pop();return result;
    }
    const result=run(lawId,lawId);
    return {...result,law_id:lawId,target:options.target||'O1',inputs:trace};
  }
  global.LawExecutor={execute};
  if(typeof module!=='undefined'&&module.exports)module.exports=global.LawExecutor;
})(typeof window!=='undefined'?window:globalThis);
