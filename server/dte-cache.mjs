import {addMonthlyPower,historicalPowerBuyers,downloadMonthlyPower} from './dte-xlsx.mjs';
import {fneeRate} from './billing.mjs';
import {discoverDte,downloadDte,extractDte,completeDte,validatePeriod} from './dte.mjs';
const cachePath=(month,edition)=>'data/dte/'+month+'-'+edition+'.json';
const cacheMatch=(p,m,e)=>p.month===m&&p.edition===e;
export function createDteService({read,write,sharepoint,base,fetcher,extractor=extractDte}){
 async function index(){const f=await read('data/dte-billing.json');return {...f,data:JSON.parse(f.content)};}
 async function period(data,month,edition){const p=data.periods?.find(p=>cacheMatch(p,month,edition));if(!p)throw {status:404,error:'No está incorporado el DTE '+edition+' de '+month+'.'};return p.cachePath?JSON.parse((await read(p.cachePath)).content):p;}
 async function actuals(){const {data}=await index();return {periods:await Promise.all(Object.entries(data.applied||{}).map(async([month,edition])=>(await period(data,month,edition)).dashboard))};}
 async function prepare(month,edition,force=false){
  validatePeriod(month,edition);const first=await index(),entry=first.data.periods?.find(p=>cacheMatch(p,month,edition));
  if(entry&&!force&&(entry.cachePath||base.actualEditions?.[month]===edition)){const cached=await period(first.data,month,edition);return {cached:true,applied:false,processedAt:cached.processedAt,month,edition};}
  const available=await discoverDte(sharepoint,month),source=available.find(p=>p.edition===edition);if(!source)throw {status:404,error:'No se encontró DTE '+edition+' de '+month+' en SharePoint. Se conserva el tablero.'};
  let bytes=await downloadDte(sharepoint,source,fetcher),raw=extractor(bytes,month,edition);bytes=null;
  if(raw.powerRequired){if(!source.complement)throw {status:422,error:'Se encontró el Access DTE '+edition+' de '+month+', pero falta localizar su complemento MATP mensual. Se conserva el tablero.'};raw=addMonthlyPower(raw,await downloadMonthlyPower(sharepoint,source.complement,fetcher),historicalPowerBuyers(base,month));}
  const state=JSON.parse((await read('data/state.json')).content),built=completeDte(raw,state,first.data,base);built.source=source;if(built.rows.some(r=>r.unit==='MWh'))fneeRate(JSON.parse((await read('data/fnee-rates.json')).content),month);
  if(edition==='II'&&!first.data.periods?.some(p=>cacheMatch(p,month,'I')))await prepare(month,'I',false);
  // Re-read before persisting so a concurrent request cannot silently replace another edition.
  const current=await index(),existing=current.data.periods?.find(p=>cacheMatch(p,month,edition));if(existing?.cachePath&&!force)return {cached:true,applied:false,month,edition};
  // Versioned immutable file first; only the following index write activates its data.
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(built)))),hash=Array.from(digest.slice(0,8),b=>b.toString(16).padStart(2,'0')).join(''),path=cachePath(month,edition).replace('.json','-'+hash+'.json');
  await write(path,JSON.stringify(built),null);
  current.data.periods=(current.data.periods||[]).filter(p=>!cacheMatch(p,month,edition));current.data.periods.push({month,edition,cachePath:path,processedAt:built.processedAt,source});
  current.data.applied??={};const retainedII=current.data.applied[month]==='II'&&edition==='I';if(!retainedII)current.data.applied[month]=edition;
  await write('data/dte-billing.json',JSON.stringify(current.data),current.sha);
  return {cached:false,applied:!retainedII,retainedII,month,edition,processedAt:built.processedAt};
 }
 async function billing(month,edition,state){validatePeriod(month,edition);const {data}=await index(),p=await period(data,month,edition);const first=edition==='II'?await period(data,month,'I'):null;return {period:p,first};}
 return {index,period,actuals,prepare,billing,discover:month=>discoverDte(sharepoint,month)};
}
