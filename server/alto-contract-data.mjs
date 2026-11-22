import {pilotMonths} from '../alto-valle/contracts-model.mjs';
import {billingTerms} from './model.mjs';
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
export async function loadAltoContracts(month,fetcher=fetch){
 if(!pilotMonths.includes(month))throw {status:400,error:'Validación disponible solo para septiembre y octubre de 2026.'};
 const read=async path=>{const r=await fetcher(root+path,{cache:'no-store'});if(!r.ok)throw {status:502,error:'No se pudo leer '+path+' para integrar contratos.'};return r.json();};
 const [facts,state]=await Promise.all([read('data/dte-billing.json'),read('data/state.json')]),entry=facts.periods?.filter(p=>p.month===month&&['I','II'].includes(p.edition)).sort((a,b)=>b.edition.localeCompare(a.edition))[0];if(!entry)throw Error('Falta incorporar un DTE del mes cerrado. No se reemplaza por proyecciones.');
 let period=entry;if(entry.cachePath){if(!new RegExp('^data/dte/'+month+'-'+entry.edition+'(?:-[a-f0-9]{16})?\\.json$').test(entry.cachePath))throw Error('Ruta de DTE inválida.');period=await read(entry.cachePath);}
 if(period.month!==month||period.edition!==entry.edition)throw Error('El DTE no corresponde al período seleccionado.');
 return {month,edition:period.edition,rows:approvedContractRows(period,state),stateRevision:state.revision,quantitiesSource:'DTE '+period.edition+' · MATE_MATER.ENERGIA_TOTAL (MWh) y MATP.POTENCIA_CONTRATADA (MWhrp), suma por unidades y comercializador',pricesSource:'Contratos e histórico comercial de la planilla; no se utilizan precios declarados ante CAMMESA',closed:true};
}
