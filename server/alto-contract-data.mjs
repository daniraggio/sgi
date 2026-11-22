import {billingTerms,energySchedule,projectPower} from './model.mjs';
import {archivedRows} from './billing-downloads.mjs';
const root='https://raw.githubusercontent.com/daniraggio/sgi/main/';
export function approvedContractRows(period,state){
 const actual=period.rows?.filter(r=>r.society==='OECC');if(!actual?.length)throw Error('Faltan cantidades DTE de OECC para validar el período.');
 const billed=period.billingRows?.OECC||actual,groups=rows=>{const out=new Map();for(const r of rows){if(!['MWh','MWhrp'].includes(r.unit)||!Number.isFinite(r.q)||r.q<0)throw Error('Cantidad DTE inválida.');const k=r.nemo+'|'+r.unit;out.set(k,(out.get(k)||0)+r.q);}return out;},qa=groups(actual),qb=groups(billed);
 if(qa.size!==qb.size||[...qa].some(([k,q])=>Math.abs(q-(qb.get(k)??NaN))>1e-6||!qb.has(k)))throw Error('Los volúmenes del histórico comercial no coinciden con el DTE de esta edición.');
 return billed.map(r=>{const kind=r.unit==='MWh'?'energy':'power',terms=billingTerms(state,{society:'OECC',nemo:r.nemo}),contracts=state.contracts.filter(c=>c.society==='OECC'&&c.kind===kind&&c.start<=period.month&&c.end>=period.month&&c.nemo.split(/\s*\/\s*/).includes(r.nemo)),prices=[...new Set(contracts.map(c=>c.monthlyPrices?.[period.month]??((+period.month.slice(5)>=5&&+period.month.slice(5)<=9)?c.winterPrice:c.summerPrice)))],override=kind==='power'?terms.powerPrice:terms.energyInvoicePrice;
 const price=Number.isFinite(override)?override:prices.length===1?prices[0]:r.price;if(!Number.isFinite(price)||price<0)throw Error('Falta el precio comercial de '+r.nemo+'. No se usa el precio declarado en CAMMESA.');
 return {nemo:r.nemo,client:r.client||contracts[0]?.client||r.nemo,unit:r.unit,q:r.q,price,ps:r.ps||contracts.find(c=>c.psContract)?.psContract||null,priceSource:Number.isFinite(override)||prices.length===1?'Contratos · precio comercial guardado':'Histórico comercial validado de la planilla'};
 });
}
const validMonth=month=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
export function openContractPlan(state,month){
 const energy=state.contracts.filter(c=>c.active&&c.society==='OECC'&&c.kind==='energy').flatMap(c=>{const s=energySchedule(c,state.contracts).find(s=>s.month===month);return s?[{nemo:c.nemo,client:c.client,capMWh:s.q,price:billingTerms(state,c).energyInvoicePrice??s.price}]:[];});
 // MATP caps are MW; the stored forecast uses MW × 220. Contract cell edits use the same reversible conversion.
 const power=projectPower(state).oecc.filter(r=>r.month===month).map(r=>({nemo:r.nemo,client:r.client,capMW:r.q/220,price:billingTerms(state,{society:'OECC',nemo:r.nemo}).powerPrice??r.price}));
 for(const r of [...energy,...power])if(!Number.isFinite(r.price)||r.price<0||!Number.isFinite(r.capMWh??r.capMW)||(r.capMWh??r.capMW)<0)throw Error('Tope o precio comercial inválido.');
 const share=month<='2027-03'?.2:state.generation?.find(g=>g.society==='OECC')?.monthlyShares?.[month];
 return {energy,power,share};
}
export async function loadAltoContracts(month,fetcher=fetch,now=new Date()){
 if(!validMonth(month))throw {status:400,error:'Elegí un mes válido.'};
 const read=async path=>{const r=await fetcher(root+path,{cache:'no-store'});if(!r.ok)throw {status:502,error:'No se pudo leer '+path+' para integrar contratos.'};return r.json();};
 const current=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit'}).format(now),state=await read('data/state.json');
 if(month>=current)return {month,closed:false,available:true,plan:openContractPlan(state,month),stateRevision:state.revision,pricesSource:'Precios comerciales de Contratos',quantitiesSource:'Estimación acumulada hasta el último dato operativo informado'};
 const [facts,catalog]=await Promise.all([read('data/dte-billing.json'),read('data/billing-exports.json')]),latest=rows=>rows?.filter(p=>p.month===month&&['I','II'].includes(p.edition)).sort((a,b)=>b.edition.localeCompare(a.edition))[0],entry=latest(facts.periods),exported=latest(catalog.periods);
 if(!entry&&!exported)return {month,closed:true,available:false,message:'Sin DTE guardado de este mes: se muestra la referencia operativa sin contratos.'};
 let period=entry;
 if(exported&&(!entry||exported.edition>entry.edition)){
  const expected='exports/billing/Facturacion_'+month+'_DTE_'+exported.edition+'.xlsx';if(exported.path!==expected)throw Error('Ruta de facturación inválida.');
  const r=await fetcher(root+expected,{cache:'no-store'});if(!r.ok)throw Error('No se pudo leer la facturación DTE guardada.');const billed=archivedRows(new Uint8Array(await r.arrayBuffer()));
  period={month,edition:exported.edition,rows:billed.OECC,billingRows:{OECC:billed.OECC}};
 }else if(entry.cachePath){if(!new RegExp('^data/dte/'+month+'-'+entry.edition+'(?:-[a-f0-9]{16})?\\.json$').test(entry.cachePath))throw Error('Ruta de DTE inválida.');period=await read(entry.cachePath);}
 if(period.month!==month)throw Error('El DTE no corresponde al período seleccionado.');
 const rows=approvedContractRows(period,state);
 return {month,edition:period.edition,rows,stateRevision:state.revision,quantitiesSource:'DTE '+period.edition+' · MATE_MATER.ENERGIA_TOTAL (MWh) y MATP.POTENCIA_CONTRATADA (MWhrp), suma por unidades y comercializador',pricesSource:'Contratos e histórico comercial de la planilla; no se utilizan precios declarados ante CAMMESA',closed:true,available:true};
}
