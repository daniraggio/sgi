export function validateContract(input){
 const text=(k,max=160)=>{if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>max)throw new Error('Completá '+k);return input[k].trim()};
 const number=k=>{const v=input[k];if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error('Valor inválido: '+k);return v};
 const month=k=>{const v=text(k,7);if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(v))throw new Error('Mes inválido');return v};
 const society=text('society'),kind=text('kind');if(!['OESC','OECC','AET'].includes(society)||!['energy','power'].includes(kind))throw new Error('Sociedad o producto inválido');
 const psContract=input.psContract==null?'':String(input.psContract).trim();
 if(psContract&&!/^\d{1,30}$/.test(psContract))throw Error('Contrato PS inválido: usá solo números.');
 const priority=input.priority??null;
 if(priority!==null&&(!Number.isInteger(priority)||priority<1||priority>99))throw new Error("La prioridad debe ser un entero entre 1 y 99");
 const c={society,kind,priority,psContract,client:text('client'),nemo:text('nemo'),supplier:text('supplier'),start:month('start'),end:month('end'),volume:number('volume'),summerPrice:number('summerPrice'),winterPrice:number('winterPrice'),active:input.active!==false};
 if(c.start>c.end||months(c.start,c.end).length>120)throw new Error('El plazo debe ser de 1 a 120 meses');
 for(const key of ['monthlyVolumes','monthlyPrices']){c[key]={};if(input[key]&&typeof input[key]==='object'&&!Array.isArray(input[key]))for(const [m,v] of Object.entries(input[key])){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(m)||m<c.start||m>c.end||typeof v!=='number'||!Number.isFinite(v)||v<0)throw new Error('Detalle mensual inválido');c[key][m]=v;}}
 return c;
}
export function months(start,end){const a=[];for(let y=+start.slice(0,4),m=+start.slice(5);a.length<121;){const s=y+'-'+String(m).padStart(2,'0');if(s>end)break;a.push(s);if(++m===13){m=1;y++}}return a}
export function schedule(c){return c.active?months(c.start,c.end).map(month=>{const q=c.monthlyVolumes[month]??c.volume,price=c.monthlyPrices[month]??((+month.slice(5)>=5&&+month.slice(5)<=9)?c.winterPrice:c.summerPrice);return {month,q,price,income:q*price}}):[]}

// Same capped pro-rata as MATE-OESC 45:57 and MATE-OECC 30:38.
export function allocatePriority(items,available){
 const allocations=Object.fromEntries(items.map(x=>[x.id,available==null?null:0]));
 if(available==null)return {allocations,remaining:null,delivered:null};
 if(!Number.isFinite(available)||available<0)throw Error('Generación inválida');
 let remaining=available;
 for(const p of [...new Set(items.map(x=>x.priority).filter(p=>Number.isInteger(p)&&p>0))].sort((a,b)=>a-b)){
  const group=items.filter(x=>x.priority===p),cap=group.reduce((n,x)=>n+x.cap,0),ratio=cap?Math.min(1,remaining/cap):0;
  for(const item of group)allocations[item.id]=item.cap*ratio;
  remaining=Math.max(0,remaining-Math.min(remaining,cap));
 }
 return {allocations,remaining,delivered:available-remaining};
}
export function energySchedule(c,contracts){
 const entries=schedule(c);
 if(!c.linkedDemand)return entries;
 const demand=contracts.filter(x=>x.active&&x.society==='OESC'&&x.kind==='energy'&&x.supplier==='OECC · Alto Valle').flatMap(schedule);
 return entries.map(x=>{const q=demand.filter(d=>d.month===x.month).reduce((n,d)=>n+d.q,0);return {...x,q,income:q*x.price}});
}
export function validateGeneration(input,plans){
 const plan=plans.find(x=>x.id===input.planId);
 if(!plan||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.month)||input.month<'2026-10')throw Error('Generador o mes inválido');
 if(typeof input.generation!=='number'||!Number.isFinite(input.generation)||input.generation<0||input.generation>100000000)throw Error('Generación inválida: usá MWh positivos o cero');
 if(!Object.hasOwn(plan.monthlyShares,input.month))throw Error('El mes no tiene definido un porcentaje comercializable');
 return {planId:plan.id,month:input.month,generation:input.generation};
}
export function simulateEnergy(state){
 const contracts=state.contracts.filter(c=>c.active&&c.kind==='energy'),schedules=new Map(contracts.map(c=>[c.id,new Map(energySchedule(c,contracts).map(x=>[x.month,x]))]));
 const plans=state.generation||[],periods=[...new Set([...contracts.flatMap(c=>months(c.start,c.end)),...plans.flatMap(p=>Object.keys(p.monthlyGeneration))])].filter(m=>m>='2026-10').sort();
 const groups=[],operations=[];
 for(const month of periods){
  const buckets=[...new Set([...contracts.map(c=>c.society+'|'+c.supplier),...plans.map(p=>p.society+'|'+p.supplier)])].sort((a,b)=>(a.startsWith('OECC')?-1:1)-(b.startsWith('OECC')?-1:1)||a.localeCompare(b));
  for(const key of buckets){
   const [society,supplier]=key.split('|'),plan=plans.find(p=>p.society===society&&p.supplier===supplier),rows=contracts.filter(c=>c.society===society&&c.supplier===supplier&&schedules.get(c.id).has(month)),items=rows.map(c=>({id:c.id,priority:c.priority,cap:schedules.get(c.id).get(month).q}));
   let generation=plan?.monthlyGeneration[month]??null,share=plan?.monthlyShares[month]??null,available=generation!=null&&share!=null?generation*share:null;
   const interco=['OESC','AET'].includes(society)&&supplier==='OECC · Alto Valle';
   if(interco){const upstream=groups.find(g=>g.month===month&&g.society==='OECC'&&g.supplier===supplier);generation=null;share=null;available=upstream?.available==null?null:operations.filter(x=>x.month===month&&x.society==='OECC'&&x.supplier===supplier&&(society==='AET'?x.nemo==='ACONENEO':x.client==='OESC')).reduce((n,x)=>n+(x.q??0),0);}
   if(!rows.length&&available==null)continue;
   const result=allocatePriority(items,available);
   groups.push({month,society,supplier,generation,share,available,interco,contracted:items.reduce((n,x)=>n+x.cap,0),...result});
   for(const c of rows){const entry=schedules.get(c.id).get(month),q=result.allocations[c.id];operations.push({contractId:c.id,month,society,supplier,client:c.client,nemo:c.nemo,priority:c.priority,cap:entry.q,q,price:entry.price,revenue:q==null?null:q*entry.price,interco:c.society==='OECC'&&['OESC','Aconcagua Energia Trading'].includes(c.client),intercoTarget:c.client==='OESC'?'OESC':c.client==='Aconcagua Energia Trading'?'AET':null,source:'Simulación · '+c.source});}
  }
 }
 return {periods,groups,operations};
}

export function parseCellNumber(value){
 const text=String(value).trim();if(!/^\d+(?:[.,]\d+)?$/.test(text))throw Error('Ingresá un número positivo o cero, sin separador de miles.');
 const n=Number(text.replace(',','.'));if(!Number.isFinite(n))throw Error('Valor inválido');return n;
}
export function editContractMonth(contract,month,field,value){
 if(!['volume','price'].includes(field)||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<contract.start||month>contract.end||month<'2026-10')throw Error('Mes o campo fuera del contrato proyectado');
 if(!contract.active)throw Error('El contrato está archivado');
 if(field==='volume'&&contract.linkedDemand)throw Error('Este tope se calcula con los contratos de OESC abastecidos por Alto Valle. Editá esos contratos.');
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Valor inválido');
 const copy=structuredClone(contract),key=field==='volume'?'monthlyVolumes':'monthlyPrices';copy[key]??={};copy[key][month]=value;return {...copy,...validateContract(copy)};
}
export function projectPower(state){
 const rows=state.contracts.filter(c=>c.active&&c.kind==='power').flatMap(c=>schedule(c).filter(s=>s.month>='2026-10').map(s=>({contractId:c.id,society:c.society,supplier:c.supplier,client:c.client,nemo:c.nemo,month:s.month,kind:'power',q:s.q,price:s.price,revenue:s.income,interco:false,intercoTarget:null,status:'Proyección',source:'Contrato · '+c.source})));
 const oesc=rows.filter(o=>o.society==='OESC'),oecc=rows.filter(o=>o.society==='OECC');
 for(const month of [...new Set(oesc.map(o=>o.month))]){const q=oesc.filter(o=>o.month===month&&o.supplier==='OECC · Alto Valle').reduce((n,o)=>n+o.q,0);if(q)oecc.push({society:'OECC',supplier:'OECC · Alto Valle',client:'OESC',nemo:'DUKECOMO',month,kind:'power',q,price:13,revenue:q*13,interco:true,intercoTarget:'OESC',status:'Proyección',source:'OECC → OESC · contratos de potencia a 13 USD/MW-hrp'});}
 return {oesc,oecc};
}

export function billingTerms(state,contract){
 const nemos=contract.nemo.split(' / '),profile=(state.billingProfiles||[]).find(p=>p.society===contract.society&&nemos.every(n=>p.nemos.includes(n)));
 return {psContract:contract.psContract||profile?.psContract||'',powerPrice:profile?.powerPrice??null,energyInvoicePrice:profile?.energyInvoicePrice??null,energyCommission:profile?.energyCommission??0};
}

export function projectAet(state,simulation=simulateEnergy(state)){
 return simulation.operations.filter(o=>o.society==='AET').map(o=>{const upstream=simulation.operations.filter(x=>x.month===o.month&&x.society==='OECC'&&x.nemo==='ACONENEO'),q=upstream.reduce((n,x)=>n+(x.q||0),0),scheduled=state.contracts.find(c=>c.society==='OECC'&&c.nemo==='ACONENEO'),buyprice=q?upstream.reduce((n,x)=>n+(x.revenue||0),0)/q:scheduled?.monthlyPrices?.[o.month]??(5<=+o.month.slice(5)&&+o.month.slice(5)<=9?scheduled?.winterPrice:scheduled?.summerPrice)??null;return {...o,status:'Proyección',kind:'energy',buyprice,cost:o.q==null||buyprice==null?null:o.q*buyprice,margin:o.revenue==null||buyprice==null?null:o.revenue-o.q*buyprice};});
}
