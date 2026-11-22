import {unzipSync,strFromU8,zipSync} from 'fflate';
import {billingComparison,billingXlsx} from './billing.mjs';
import {adjustmentRows} from './dte-policy.mjs';
import {billingChanges} from './billing-differences.mjs';
import {savedBilling,validateBillingSelection} from './published-billing.mjs';
const root='https://raw.githubusercontent.com/daniraggio/sgi/main/';
const decode=s=>s.replace(/&(?:amp|lt|gt|quot|apos);/g,s=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[s]));
// Our archived bot exports use inline strings and numeric cells. Read the original
// sale lines only: FNEE must be regenerated once, including negative credits.
export function archivedRows(bytes){
 const files=unzipSync(bytes),book=strFromU8(files['xl/workbook.xml']),result={OESC:[],OECC:[],AET:[]};
 const sheets=[...book.matchAll(/<sheet name="([^"]+)"[^>]*r:id="rId(\d+)"/g)];
 for(const [,soc,id]of sheets){if(!Object.hasOwn(result,soc))continue;
  const sheet=strFromU8(files['xl/worksheets/sheet'+id+'.xml']);
  for(const row of sheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
   if(+row[1]<7)continue;const c={};
   for(const cell of row[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)){
    const value=cell[3].match(/<v>([^<]*)<\/v>/)?.[1];
    c[cell[1]]=cell[2].includes('inlineStr')?decode([...cell[3].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join('')):value===undefined?null:Number(value);
   }
   if(c.H!=='USD')continue;
   if(!c.C||!['MWh','MWhrp'].includes(c.F)||!Number.isFinite(c.E)||!Number.isFinite(c.G))throw Error('La planilla archivada contiene una línea de venta incompleta.');
   result[soc].push({society:soc,ps:c.A,client:c.B,nemo:c.C,unit:c.F,q:c.E,price:c.G,notes:c.I||''});
  }
 }
 if(!Object.values(result).flat().length)throw Error('La planilla archivada no contiene ventas DTE.');return result;
}
export async function savedAdjustments(month,fetcher=fetch){
 validateBillingSelection(month,'II');
 const [a,b,f]=await Promise.all([savedBilling(month,'I',fetcher),savedBilling(month,'II',fetcher),fetcher(root+'data/fnee-rates.json',{cache:'no-store'})]);
 if(!f.ok)throw Error('No se pudo leer el FNEE del mes.');
 const first={month,edition:'I',billingRows:archivedRows(a.bytes)},second={month,edition:'II',billingRows:archivedRows(b.bytes)};
 const comparison=billingChanges(billingComparison({}, {periods:[first,second]},month));
 return {filename:'Ajustes_'+month+'_DTE_II_vs_I.xlsx',bytes:billingXlsx(adjustmentRows(first,second),month,comparison,{},await f.json(),true)};
}
export async function billingPackage(month,fetcher=fetch){
 validateBillingSelection(month,'I');const bot=await savedBilling(month,'I',fetcher);
 const r=await fetcher(root+'data/billing-models.json',{cache:'no-store'});if(!r.ok)throw Error('No se pudo leer el catálogo de planillas detalladas.');
 const entry=(await r.json()).periods?.find(p=>p.month===month);
 if(!entry) return bot; // Never substitute the October model for another month.
 const files={[bot.filename]:bot.bytes};
 for(const society of ['OESC','OECC']){
  const path=entry[society],expected='exports/billing/modelos/Facturacion_'+society+'_'+month+'_DTE_I.xlsx';
  if(path!==expected)throw Error('Ruta de planilla detallada inválida.');
  const response=await fetcher(root+path,{cache:'no-store'});if(!response.ok)throw Error('Falta la planilla detallada de '+society+'.');
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]!==80||bytes[1]!==75)throw Error('Planilla detallada inválida.');files[path.split('/').pop()]=bytes;
 }
 return {filename:'Facturacion_'+month+'_DTE_I.zip',bytes:zipSync(files,{level:0})};
}
