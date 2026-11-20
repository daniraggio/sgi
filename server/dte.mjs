import MDBReader from 'mdb-reader';
import {Buffer} from 'buffer';
import {unzipSync} from 'fflate';
import {billingRows} from './billing.mjs';
import {billingTerms} from './model.mjs';
export const SHAREPOINT='connector_1e4f6a44acf14e3ca1d96672f8c945bc';
export const DTE_ROOT='Comercial y Regulatorio/Energía Eléctrica/01 - Transacciones Economicas/04 - DTE';
const clean=v=>String(v??'').trim(),round=v=>Math.round(v*1e6)/1e6;
export function validatePeriod(month,edition='I'){if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month<'2026-02'||!['I','II'].includes(edition))throw Error('Mes o versión de DTE inválidos.');}
export function extractDte(bytes,month,edition){
 validatePeriod(month,edition);if(bytes.byteLength>60*1024*1024)throw Error('El DTE supera el límite de lectura de 60 MB.');
 const reader=new MDBReader(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength)),names=reader.getTableNames(),groups=new Map();let scoped=0;const legacy=!names.includes('MATE_MATER'),powerRequired=!names.includes('MATP');
 function add(society,nemo,supplier,unit,q){if(!nemo||!Number.isFinite(q)||q<0)throw Error('Cantidad o NEMO inválidos en el DTE.');scoped++;if(!q)return;const key=[society,nemo,supplier,unit].join('|'),r=groups.get(key)||{society,nemo,supplier,unit,q:0};r.q+=q;groups.set(key,r);}
 function consume(table,columns,fn){if(!names.includes(table))throw Error('El DTE no contiene la tabla '+table+'. No se reemplazaron datos.');const t=reader.getTable(table);for(const r of t.getData({columns}))fn(r);}
 if(legacy){
  consume('MATRenov',['AGENTE_GEN','AGENTE_COM','AGENTE_DEM','ENERGIA_CONT'],r=>{if(clean(r.AGENTE_COM)!=='DUKECOMO')return;const gen=clean(r.AGENTE_GEN),supplier={'PFSOLAAG':'GSSR','PFCHEPEG':'LEDLAR'}[gen];if(!supplier)throw Error('Generador renovable OESC desconocido: '+gen);add('OESC',clean(r.AGENTE_DEM),supplier,'MWh',Number(r.ENERGIA_CONT));});
  consume('ANEXO_MAT_CONTRATOS',['AGENTE_G','COMERCIA','AGENTE','TOTAL_MWH'],r=>{if(clean(r.AGENTE_G)!=='CTALVALG')return;const com=clean(r.COMERCIA),nemo=clean(r.AGENTE),q=Number(r.TOTAL_MWH);if(com==='DUKECOMO')add('OESC',nemo,'OECC · Alto Valle','MWh',q);/* Julio se factura por NEMO demandante; conserva el precio histórico de cada punto. */add('OECC',month<='2026-07'&&com==='ENINSACO'?nemo:com||nemo,'OECC · Alto Valle','MWh',q);});
 }else{
 consume('MATE_MATER',['AGENTE_G','COMERCIA','AGENTE_D','ENERGIA_TOTAL'],r=>{const gen=clean(r.AGENTE_G),com=clean(r.COMERCIA),nemo=clean(r.AGENTE_D),q=Number(r.ENERGIA_TOTAL);if(com==='DUKECOMO'){const supplier=gen==='PFSOLAAG'?'GSSR':gen==='PFCHEPEG'?'LEDLAR':gen==='CTALVALG'?'OECC · Alto Valle':null;if(!supplier)throw Error('Generador OESC sin equivalencia: '+gen);add('OESC',nemo,supplier,'MWh',q)}if(gen==='CTALVALG')add('OECC',com||nemo,'OECC · Alto Valle','MWh',q);if(com==='ACONENEO'&&month>='2026-11'){if(gen!=='CTALVALG')throw Error('Proveedor AET sin equivalencia: '+gen);add('AET',nemo,'OECC · Alto Valle','MWh',q);}});
 }
 if(!powerRequired)consume('MATP',['AGENTE_G','COMERCIA','AGENTE_D','POTENCIA_CONTRATADA'],r=>{const gen=clean(r.AGENTE_G),com=clean(r.COMERCIA),nemo=clean(r.AGENTE_D),q=Number(r.POTENCIA_CONTRATADA);if(com==='DUKECOMO'){if(gen!=='CTALVALG')throw Error('Proveedor de potencia OESC sin equivalencia: '+gen);add('OESC',nemo,'OECC · Alto Valle','MWhrp',q);}if(gen==='CTALVALG')add('OECC',com||nemo,'OECC · Alto Valle','MWhrp',q);if(com==='ACONENEO'&&month>='2026-11')add('AET',nemo,'OECC · Alto Valle','MWhrp',q);});
 const generation={'GSSR':0,'LEDLAR':0,'OECC · Alto Valle':0};
 consume('GenR400',['AGENTE','GENERACION_TOTAL'],r=>{const g={'PFSOLAAG':'GSSR','PFCHEPEG':'LEDLAR','CTALVALG':'OECC · Alto Valle'}[clean(r.AGENTE)];if(g)generation[g]+=Number(r.GENERACION_TOTAL)||0;});
 if(!scoped)throw Error('No se encontraron registros de OESC u OECC. No se aplicó un mes vacío.');
 return {month,edition,powerRequired,rows:[...groups.values()].map(r=>({...r,q:round(r.q)})),generation:Object.fromEntries(Object.entries(generation).map(([g,q])=>[g,round(q)])),method:(legacy?'MATRenov.ENERGIA_CONT y ANEXO_MAT_CONTRATOS.TOTAL_MWH (MWh)':'MATE_MATER.ENERGIA_TOTAL (MWh)')+(!powerRequired?'; MATP.POTENCIA_CONTRATADA (MWhrp, suma por unidades)':'')+'; GenR400.GENERACION_TOTAL (MWh)'};
}
const dateOf=o=>o.date|| (typeof o.month==='string'?o.month:'2026-'+String(o.month).padStart(2,'0'));
export function completeDte(raw,state,prior,base){
 const month=raw.month,legacy=prior.periods?.find(p=>p.month===month&&p.edition===raw.edition),all=[...(base.billingHistory||[]).filter(r=>r.month===month),...(legacy?.rows||[]),...base.ops.filter(o=>dateOf(o)===month).map(o=>({...o,society:'OESC',unit:'MWh',ps:o.psContract})),...base.oescPower.filter(o=>o.date===month).map(o=>({...o,society:'OESC',unit:'MWhrp',ps:o.psContract})),...(base.aet||[]).filter(o=>o.month===month).map(o=>({...o,society:'AET',unit:o.kind==='energy'?'MWh':'MWhrp',ps:o.psContract})),...base.oecc.filter(o=>o.month===month).map(o=>({...o,society:'OECC',supplier:o.supplier||'OECC · Alto Valle',unit:o.kind==='energy'?'MWh':'MWhrp',ps:o.psContract||o.contract}))];
 const transfer=base.oescPower.filter(o=>o.date===month&&Number.isFinite(o.buyprice)),transferPrices=[...new Set(transfer.map(o=>o.buyprice))];if(transferPrices.length===1&&!all.some(o=>o.society==='OECC'&&o.nemo==='DUKECOMO'&&o.unit==='MWhrp'))all.push({society:'OECC',nemo:'DUKECOMO',supplier:'OECC · Alto Valle',unit:'MWhrp',client:'OESC',price:transferPrices[0],ps:null});
 const period={...raw,rows:raw.rows.map(r=>{const candidates=all.filter(o=>o.society===r.society&&o.nemo===r.nemo&&o.unit===r.unit),exact=candidates.find(o=>o.supplier===r.supplier),uniquePrice=new Set(candidates.filter(o=>Number.isFinite(o.price)).map(o=>o.price)),old=exact||(uniquePrice.size===1?candidates.find(o=>Number.isFinite(o.price)):null),kind=r.unit==='MWh'?'energy':'power',c=state.contracts.find(c=>c.society===r.society&&c.kind===kind&&c.start<=month&&c.end>=month&&c.nemo.split(' / ').includes(r.nemo)&&c.supplier===r.supplier);return {...r,client:c?.client||old?.client||r.nemo,price:old?.price??null,ps:old?.ps??null,notes:''};})};
 const ambiguous=raw.rows.filter(r=>new Set(all.filter(o=>o.society===r.society&&o.nemo===r.nemo&&o.unit===r.unit&&o.supplier===r.supplier).map(o=>o.price)).size>1);if(ambiguous.length)throw {status:422,error:'El DTE fue encontrado, pero hay más de un precio histórico para '+ambiguous.map(r=>r.nemo).join(', ')+'. Debe definirse el reparto por precio antes de facturar.'};
 const billed=billingRows(state,{periods:[period]},month,raw.edition),rows=[...billed.OESC,...billed.OECC,...billed.AET],missing=rows.filter(r=>!Number.isFinite(r.price));if(missing.length)throw {status:422,error:'Falta completar el precio en Clientes y contratos para: '+missing.map(r=>r.society+' · '+r.nemo+' · '+r.unit).join(', ')};
 return buildStoredDashboard(period,rows,billed,state,base);
}
export function restoreStoredDte(period,state,base){
 validatePeriod(period.month,period.edition);
 if(period.dashboard)return period;
 const rows=period.rows?.map(r=>({...r}));if(!Array.isArray(rows)||!period.generation||!['GSSR','LEDLAR','OECC · Alto Valle'].every(k=>Number.isFinite(period.generation[k])&&period.generation[k]>=0)||rows.some(r=>!['OESC','OECC','AET'].includes(r.society)||!['MWh','MWhrp'].includes(r.unit)||!Number.isFinite(r.q)||r.q<0||!Number.isFinite(r.price)))throw Error('El DTE guardado no contiene todos los datos necesarios para activar los reales.');
 const billed={OESC:[],OECC:[],AET:[]};for(const r of rows)billed[r.society].push(r);
 return buildStoredDashboard(period,rows,billed,state,base);
}
function buildStoredDashboard(period,rows,billed,state,base){
 const raw=period,month=period.month;
 const ops=rows.filter(r=>r.society==='OESC'&&r.unit==='MWh').map(r=>({...r,kind:'energy',date:month,month:+month.slice(5),income:r.q*r.price,commission:r.q*billingTerms(state,{society:'OESC',nemo:r.nemo}).energyCommission}));
 const gssr=ops.filter(r=>r.supplier==='GSSR'),spot=Math.max(0,raw.generation.GSSR-gssr.reduce((n,r)=>n+r.q,0)),net=gssr.reduce((n,r)=>n+r.income-r.commission,0)+spot*40.8,avg=raw.generation.GSSR?net/raw.generation.GSSR:0;
 const known=base.ops.find(o=>dateOf(o)===month&&o.supplier==='GSSR')?.buyprice;
 const solarBuy=known??Math.max(0,Math.min(avg-2.5,avg*.95));
 for(const r of ops){r.buyprice=r.supplier==='LEDLAR'?54:r.supplier==='GSSR'?solarBuy:(+month.slice(5)>=5&&+month.slice(5)<=9?60:40);r.cost=r.q*r.buyprice;r.netIncome=r.income-r.commission;}
 const power=rows.filter(r=>r.society==='OESC'&&r.unit==='MWhrp').map(r=>({...r,date:month,kind:'power',buyprice:13,income:r.q*r.price,cost:r.q*13,commission:0}));
 const oecc=rows.filter(r=>r.society==='OECC').map(r=>({...r,month,kind:r.unit==='MWh'?'energy':'power',revenue:r.q*r.price,interco:['DUKECOMO','DUKECOME','ACONENEO'].includes(r.nemo),intercoTarget:['DUKECOMO','DUKECOME'].includes(r.nemo)?'OESC':r.nemo==='ACONENEO'?'AET':null}));
 const aet=rows.filter(r=>r.society==='AET').map(r=>{if(r.unit!=='MWh')throw Error('Falta definir el precio de compra de potencia de AET antes de incorporar ese producto.');const terms=state.contracts.find(c=>c.society==='OECC'&&c.nemo==='ACONENEO'&&c.start<=month&&c.end>=month),buyprice=terms?.monthlyPrices?.[month]??(5<=+month.slice(5)&&+month.slice(5)<=9?terms?.winterPrice:terms?.summerPrice)??null;return {...r,month,kind:r.unit==='MWh'?'energy':'power',buyprice,cost:buyprice==null?null:r.q*buyprice,revenue:r.q*r.price,margin:buyprice==null?null:r.q*(r.price-buyprice)};});
 const source='DTE '+raw.edition+' · '+month+' · '+raw.method;for(const r of [...ops,...power,...oecc,...aet])Object.assign(r,{source,status:'Real'});
 const sum=(rs,k)=>rs.reduce((n,r)=>n+(r[k]||0),0),summary={date:month,month:+month.slice(5),fx:base.months.find(o=>dateOf(o)===month)?.fx??null,q:sum(ops,'q'),buyq:sum(ops,'q')+spot,revenue:sum(ops,'income')+spot*40.8,cost:sum(ops,'cost')+spot*solarBuy,commission:sum(ops,'commission')};summary.margin=summary.revenue-summary.cost-summary.commission;
 return {...period,rows,billingRows:billed,dashboard:{month,edition:raw.edition,oescEnergy:ops,oescPower:power,oecc,aet,oescSummary:summary,generation:raw.generation,oeccCommercial:raw.generation['OECC · Alto Valle']*(state.generation?.find(p=>p.society==='OECC')?.monthlyShares?.[month]??0),spot:{q:spot,price:40.8,income:spot*40.8,cost:spot*solarBuy,buyprice:solarBuy}},processedAt:period.processedAt||new Date().toISOString()};
}
export async function discoverDte(invoke,month){
 validatePeriod(month);const year=month.slice(0,4),number=month.slice(5),stem='DTE'+year.slice(2)+number,args={hostname:'aconcaguaenergia.sharepoint.com',site_path:'/sites/aconcaguaenergia',top:200};
 const list=async path=>{const r=await invoke('list_folder_items',{...args,folder_path:path});if(r.next_link)throw Error('La carpeta tiene más archivos que el límite de lectura.');return r.value||[];};
 const ys=await list(DTE_ROOT+'/'+year),folder=ys.find(f=>f.folder&&new RegExp('^'+number+'(?:\\s|-|$)').test(f.name));if(!folder)return [];
 const path=DTE_ROOT+'/'+year+'/'+folder.name,children=await list(path);
 const result=await Promise.all(['I','II'].map(async edition=>{const sub=children.find(f=>f.folder&&f.name.trim().replace(/\s+/g,' ').toUpperCase()==='DTE '+edition);if(!sub)return null;const editionPath=path+'/'+sub.name,docs=await list(editionPath),names=new RegExp('^'+stem+'(?:[ _-]+'+edition+')?\\.(mdb|zip)$','i');let found=docs.filter(f=>!f.folder&&names.test(f.name));
  for(const nested of docs.filter(f=>f.folder&&new RegExp('^'+stem+'(?:[ _-]+'+edition+')?$','i').test(f.name)))found.push(...(await list(editionPath+'/'+nested.name)).filter(f=>!f.folder&&names.test(f.name)));
  // Prefer Access to an archive copy; never guess between two Access revisions.
  const mdb=found.filter(f=>/\.mdb$/i.test(f.name));if(mdb.length)found=mdb;if(found.length>1)throw Error('Hay varios archivos DTE '+edition+' de '+month+'. Revisá cuál es el vigente.');const file=found[0];if(!file)return null;
  let complement=null;const direct=docs.filter(f=>!f.folder&&new RegExp('^(?:MATP?|Contratos).*'+year+'[-_]'+number+'.*\\.xlsx$','i').test(f.name));if(direct.length>1)throw Error('Hay varios complementos MATP para DTE '+edition+'.');if(direct[0])complement={name:direct[0].name,url:direct[0].web_url};for(const folder of docs.filter(f=>f.folder&&/complemento.*r400/i.test(f.name))){const matches=(await list(editionPath+'/'+folder.name)).filter(f=>!f.folder&&new RegExp('^(?:MATP?|Contratos).*'+year+'[-_]'+number+'.*\\.xlsx$','i').test(f.name));if(matches.length>1)throw Error('Hay varios complementos MATP para DTE '+edition+'.');if(matches[0])complement={name:matches[0].name,url:matches[0].web_url};}
  return {month,edition,name:file.name,url:file.web_url,modified:file.last_modified_date_time,size:file.size,hash:file.file?.hashes?.quickXorHash||null,...(complement?{complement}:{})};
 }));
 return result.filter(Boolean);
}
export async function openDteDownload(invoke,source,fetcher=fetch){
 const f=await invoke('fetch',{url:source.url,download_raw_file:true}),info=f.file_uri||f.structuredContent?.file_uri,url=info?.download_url;
 if(!url)throw Error('SharePoint no devolvió el archivo Access para su lectura.');
 const u=new URL(url);if(u.protocol!=='https:'||!/(^|\.)oaiusercontent\.com$|(^|\.)blob\.core\.windows\.net$/.test(u.hostname))throw Error('Referencia de descarga no admitida.');
 // Workers supports manual/follow only. Never follow a redirect outside the validated download host.
 const r=await fetcher(url,{redirect:'manual'});if(r.status>=300&&r.status<400)throw Error('La descarga del DTE devolvió una redirección. Volvé a consultar SharePoint para renovar el enlace.');if(!r.ok)throw Error('No se pudo descargar el DTE desde SharePoint.');
 return r;
}
export async function downloadDte(invoke,source,fetcher=fetch){
 const r=await openDteDownload(invoke,source,fetcher);
 const limit=(/\.xlsx$/i.test(source.name||'')?96:60)*1024*1024,len=Number(r.headers.get('content-length'));if(len>limit)throw Error('El archivo DTE supera el límite de lectura.');const buffer=new Uint8Array(await r.arrayBuffer());if(buffer.byteLength>limit)throw Error('El archivo DTE supera el límite de lectura.');
 if(/\.zip$/i.test(source.name||'')){const stem='DTE'+source.month.slice(2,4)+source.month.slice(5),pattern=new RegExp('(?:^|/)'+stem+'(?:[ _-]+'+source.edition+')?\\.mdb$','i'),files=unzipSync(buffer,{filter:f=>{if(!pattern.test(f.name))return false;if(f.originalSize>60*1024*1024)throw Error('El Access comprimido supera 60 MB.');return true;}}),items=Object.values(files);if(items.length!==1)throw Error('El ZIP debe contener un único Access DTE del mes y edición seleccionados.');return items[0];}return buffer;
}
