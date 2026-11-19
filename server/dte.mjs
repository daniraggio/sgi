import MDBReader from 'mdb-reader';
import {Buffer} from 'buffer';
import {billingRows} from './billing.mjs';
import {billingTerms} from './model.mjs';
export const SHAREPOINT='connector_1e4f6a44acf14e3ca1d96672f8c945bc';
export const DTE_ROOT='Comercial y Regulatorio/Energía Eléctrica/01 - Transacciones Economicas/04 - DTE';
const clean=v=>String(v??'').trim(),round=v=>Math.round(v*1e6)/1e6;
export function validatePeriod(month,edition='I'){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<'2026-02'||!['I','II'].includes(edition))throw Error('Mes o versión de DTE inválidos.');}
export function extractDte(bytes,month,edition){
 validatePeriod(month,edition);if(bytes.byteLength>60*1024*1024)throw Error('El DTE supera el límite de lectura de 60 MB.');
 const reader=new MDBReader(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)),names=reader.getTableNames(),groups=new Map();let scoped=0;
 function add(society,nemo,supplier,unit,q){if(!nemo||!Number.isFinite(q)||q<0)throw Error('Cantidad o NEMO inválidos en el DTE.');scoped++;if(!q)return;const key=[society,nemo,supplier,unit].join('|'),r=groups.get(key)||{society,nemo,supplier,unit,q:0};r.q+=q;groups.set(key,r);}
 function consume(table,columns,fn){if(!names.includes(table))throw Error('El DTE no contiene la tabla '+table+'. No se reemplazaron datos.');const t=reader.getTable(table);for(const r of t.getData({columns}))fn(r);}
 consume('MATE_MATER',['AGENTE_G','COMERCIA','AGENTE_D','ENERGIA_TOTAL'],r=>{const gen=clean(r.AGENTE_G),com=clean(r.COMERCIA),nemo=clean(r.AGENTE_D),q=Number(r.ENERGIA_TOTAL);if(com==='DUKECOMO'){const supplier=gen==='PFSOLAAG'?'GSSR':gen==='PFCHEPEG'?'LEDLAR':gen==='CTALVALG'?'OECC · Alto Valle':null;if(!supplier)throw Error('Generador OESC sin equivalencia: '+gen);add('OESC',nemo,supplier,'MWh',q)}if(gen==='CTALVALG')add('OECC',com||nemo,'OECC · Alto Valle','MWh',q);});
 consume('MATP',['AGENTE_G','COMERCIA','AGENTE_D','POTENCIA_CONTRATADA'],r=>{const gen=clean(r.AGENTE_G),com=clean(r.COMERCIA),nemo=clean(r.AGENTE_D),q=Number(r.POTENCIA_CONTRATADA);if(com==='DUKECOMO'){if(gen!=='CTALVALG')throw Error('Proveedor de potencia OESC sin equivalencia: '+gen);add('OESC',nemo,'OECC · Alto Valle','MWhrp',q);}if(gen==='CTALVALG')add('OECC',com||nemo,'OECC · Alto Valle','MWhrp',q);});
 const generation={'GSSR':0,'LEDLAR':0,'OECC · Alto Valle':0};
 consume('GenR400',['AGENTE','GENERACION_TOTAL'],r=>{const g={'PFSOLAAG':'GSSR','PFCHEPEG':'LEDLAR','CTALVALG':'OECC · Alto Valle'}[clean(r.AGENTE)];if(g)generation[g]+=Number(r.GENERACION_TOTAL)||0;});
 if(!scoped)throw Error('No se encontraron registros de OESC u OECC. No se aplicó un mes vacío.');
 return {month,edition,rows:[...groups.values()].map(r=>({...r,q:round(r.q)})),generation:Object.fromEntries(Object.entries(generation).map(([g,q])=>[g,round(q)])),method:'MATE_MATER.ENERGIA_TOTAL (MWh); MATP.POTENCIA_CONTRATADA (MWhrp, suma por unidades); GenR400.GENERACION_TOTAL (MWh)'};
}
const dateOf=o=>o.date|| (typeof o.month==='string'?o.month:'2026-'+String(o.month).padStart(2,'0'));
export function completeDte(raw,state,prior,base){
 const month=raw.month,legacy=prior.periods?.find(p=>p.month===month&&p.edition===raw.edition),all=[...(legacy?.rows||[]),...base.ops.filter(o=>dateOf(o)===month).map(o=>({...o,society:'OESC',unit:'MWh',ps:o.psContract})),...base.oescPower.filter(o=>o.date===month).map(o=>({...o,society:'OESC',unit:'MWhrp',ps:o.psContract})),...base.oecc.filter(o=>o.month===month).map(o=>({...o,society:'OECC',unit:o.kind==='energy'?'MWh':'MWhrp',ps:o.psContract}))];
 const period={...raw,rows:raw.rows.map(r=>{const old=all.find(o=>o.society===r.society&&o.nemo===r.nemo&&o.unit===r.unit&&o.supplier===r.supplier),kind=r.unit==='MWh'?'energy':'power',c=state.contracts.find(c=>c.society===r.society&&c.kind===kind&&c.start<=month&&c.end>=month&&c.nemo.split(' / ').includes(r.nemo)&&c.supplier===r.supplier);return {...r,client:c?.client||old?.client||r.nemo,price:old?.price??null,ps:old?.ps??null,notes:''};})};
 const billed=billingRows(state,{periods:[period]},month,raw.edition),rows=[...billed.OESC,...billed.OECC],missing=rows.filter(r=>!Number.isFinite(r.price));if(missing.length)throw {status:422,error:'Falta completar el precio en Clientes y contratos para: '+missing.map(r=>r.society+' · '+r.nemo+' · '+r.unit).join(', ')};
 const ops=rows.filter(r=>r.society==='OESC'&&r.unit==='MWh').map(r=>({...r,kind:'energy',date:month,month:+month.slice(5),income:r.q*r.price,commission:r.q*billingTerms(state,{society:'OESC',nemo:r.nemo}).energyCommission}));
 const gssr=ops.filter(r=>r.supplier==='GSSR'),spot=Math.max(0,raw.generation.GSSR-gssr.reduce((n,r)=>n+r.q,0)),net=gssr.reduce((n,r)=>n+r.income-r.commission,0)+spot*40.8,avg=raw.generation.GSSR?net/raw.generation.GSSR:0;
 const known=base.ops.find(o=>dateOf(o)===month&&o.supplier==='GSSR')?.buyprice;
 const solarBuy=known??Math.max(0,Math.min(avg-2.5,avg*.95));
 for(const r of ops){r.buyprice=r.supplier==='LEDLAR'?54:r.supplier==='GSSR'?solarBuy:(+month.slice(5)>=5&&+month.slice(5)<=9?60:40);r.cost=r.q*r.buyprice;r.netIncome=r.income-r.commission;}
 const power=rows.filter(r=>r.society==='OESC'&&r.unit==='MWhrp').map(r=>({...r,date:month,kind:'power',buyprice:13,income:r.q*r.price,cost:r.q*13,commission:0}));
 const oecc=rows.filter(r=>r.society==='OECC').map(r=>({...r,month,kind:r.unit==='MWh'?'energy':'power',revenue:r.q*r.price,interco:['DUKECOMO','DUKECOME','ACONENEO'].includes(r.nemo),intercoTarget:['DUKECOMO','DUKECOME'].includes(r.nemo)?'OESC':r.nemo==='ACONENEO'?'Trading':null}));
 const source='DTE '+raw.edition+' · '+month+' · '+raw.method;for(const r of [...ops,...power,...oecc])Object.assign(r,{source,status:'Real'});
 const sum=(rs,k)=>rs.reduce((n,r)=>n+(r[k]||0),0),summary={date:month,month:+month.slice(5),fx:base.months.find(o=>dateOf(o)===month)?.fx??null,q:sum(ops,'q'),buyq:sum(ops,'q')+spot,revenue:sum(ops,'income')+spot*40.8,cost:sum(ops,'cost')+spot*solarBuy,commission:sum(ops,'commission')};summary.margin=summary.revenue-summary.cost-summary.commission;
 return {...period,rows,billingRows:billed,dashboard:{month,edition:raw.edition,oescEnergy:ops,oescPower:power,oecc,oescSummary:summary,generation:raw.generation,oeccCommercial:raw.generation['OECC · Alto Valle']*(state.generation?.find(p=>p.society==='OECC')?.monthlyShares?.[month]??0),spot:{q:spot,price:40.8,income:spot*40.8,cost:spot*solarBuy,buyprice:solarBuy}},processedAt:new Date().toISOString()};
}
export async function discoverDte(invoke,month){
 validatePeriod(month);const year=month.slice(0,4),number=month.slice(5),args={hostname:'aconcaguaenergia.sharepoint.com',site_path:'/sites/aconcaguaenergia',top:200};
 const list=async path=>{const r=await invoke('list_folder_items',{...args,folder_path:path});if(r.next_link)throw Error('La carpeta tiene más archivos que el límite de lectura.');return r.value||[];};
 const ys=await list(DTE_ROOT+'/'+year),folder=ys.find(f=>f.folder&&new RegExp('^'+number+'(?:\\s|-|$)').test(f.name));if(!folder)return [];
 const path=DTE_ROOT+'/'+year+'/'+folder.name,children=await list(path),result=[];
 for(const edition of ['I','II']){const sub=children.find(f=>f.folder&&f.name.trim().toUpperCase()==='DTE '+edition);if(!sub)continue;const docs=await list(path+'/'+sub.name),file=docs.find(f=>new RegExp('^DTE'+year.slice(2)+number+'\\.mdb$','i').test(f.name));if(file)result.push({month,edition,name:file.name,url:file.web_url,modified:file.last_modified_date_time,size:file.size,hash:file.file?.hashes?.quickXorHash||null});}
 return result;
}
export async function downloadDte(invoke,source,fetcher=fetch){
 const f=await invoke('fetch',{url:source.url,download_raw_file:true}),info=f.file_uri||f.structuredContent?.file_uri,url=info?.download_url;
 if(!url)throw Error('SharePoint no devolvió el archivo Access para su lectura.');
 const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)oaiusercontent\.com$|(^|\.)blob\.core\.windows\.net$/.test(u.hostname))throw Error('Referencia de descarga no admitida.');
 const r=await fetcher(url,{redirect:'error'});if(!r.ok)throw Error('No se pudo descargar el DTE desde SharePoint.');
 const len=Number(r.headers.get('content-length'));if(len>60*1024*1024)throw Error('El DTE supera 60 MB.');const buffer=new Uint8Array(await r.arrayBuffer());if(buffer.byteLength>60*1024*1024)throw Error('El DTE supera 60 MB.');return buffer;
}
