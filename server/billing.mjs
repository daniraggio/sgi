import {billingTerms} from './model.mjs';
export function billingCatalog(data){return (data.periods||[]).map(({month,edition})=>({month,edition})).sort((a,b)=>a.month.localeCompare(b.month)||a.edition.localeCompare(b.edition));}
export function billingRows(state,data,month,edition){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!['I','II'].includes(edition))throw Error('Elegí mes y versión de DTE válidos.');
 const period=data.periods?.find(p=>p.month===month&&p.edition===edition);if(!period)throw {status:404,error:'No está incorporado el DTE '+edition+' de '+month+'. No se utilizarán proyecciones ni otra versión.'};
 const result={OESC:[],OECC:[]};
 for(const source of period.rows){
  const r={...source},kind=r.unit==='MWh'?'energy':'power';
  const candidates=state.contracts.filter(c=>c.society===r.society&&c.kind===kind&&c.start<=month&&c.end>=month&&c.nemo.split(' / ').includes(r.nemo)&&(!r.supplier||c.supplier===r.supplier));
  const prices=[...new Set(candidates.map(c=>c.monthlyPrices?.[month]??((+month.slice(5)>=5&&+month.slice(5)<=9)?c.winterPrice:c.summerPrice)))];
  const terms=billingTerms(state,{society:r.society,nemo:r.nemo});
  r.ps=terms.psContract||candidates.find(c=>c.psContract)?.psContract||r.ps||null;
  if(kind==='power'&&terms.powerPrice!=null)r.price=terms.powerPrice;else if(prices.length===1)r.price=prices[0];else if(prices.length>1){r.price=null;r.notes='Hay más de un precio para este NEMO; revisar antes de facturar.';}
  if(!Number.isFinite(r.q)||r.q<0)throw Error('Cantidad DTE inválida para '+r.nemo);
  if(!r.ps&&!r.notes)r.notes='Completar Contrato PS.';
  result[r.society].push(r);
 }
 return result;
}
// Small, uncompressed OOXML ZIP: typed cells, no styles or external dependencies.
const enc=new TextEncoder();
const xml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function concat(parts){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function zip(files){const local=[],central=[];let offset=0;for(const [path,text]of Object.entries(files)){const name=enc.encode(path),body=enc.encode(text),crc=crc32(body),head=new Uint8Array(30),h=new DataView(head.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,body.length,true);h.setUint32(22,body.length,true);h.setUint16(26,name.length,true);const c=new Uint8Array(46),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,body.length,true);v.setUint32(24,body.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);local.push(head,name,body);central.push(c,name);offset+=head.length+name.length+body.length;}const directory=concat(central),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,Object.keys(files).length,true);v.setUint16(10,Object.keys(files).length,true);v.setUint32(12,directory.length,true);v.setUint32(16,offset,true);return concat([...local,directory,end]);}
function sheetXml(rows){return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((value,j)=>{if(value==null||value==='')return '';const ref=String.fromCharCode(65+j)+(i+1);return typeof value==='number'?'<c r="'+ref+'"><v>'+value+'</v></c>':'<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';}).join('')+'</row>').join('')+'</sheetData></worksheet>';}
export function billingComparison(state,data,month){
 const first=billingRows(state,data,month,'I'),second=billingRows(state,data,month,'II'),items=new Map();
 for(const [version,rows]of [[0,first],[1,second]])for(const society of ['OESC','OECC'])for(const row of rows[society]){
  const key=[society,row.nemo,row.unit].join('|'),item=items.get(key)||{society,client:row.client,nemo:row.nemo,unit:row.unit,qI:0,qII:0,presentI:false,presentII:false};
  item[version?'qII':'qI']+=row.q;item[version?'presentII':'presentI']=true;items.set(key,item);
 }
 return [...items.values()].sort((a,b)=>a.society.localeCompare(b.society)||a.nemo.localeCompare(b.nemo)||a.unit.localeCompare(b.unit)).map(r=>({...r,qI:Math.round(r.qI*1e6)/1e6,qII:Math.round(r.qII*1e6)/1e6,difference:Math.round((r.qII-r.qI)*1e6)/1e6,status:!r.presentI?'Solo en DTE II':!r.presentII?'Solo en DTE I':Math.abs(r.qII-r.qI)<1e-9?'Sin cambio':'Modificado'}));
}
export function billingXlsx(rows,month,comparison=null){
 const sheets=['OESC','OECC'].map(soc=>({name:soc,rows:[['Unidad de negocio',soc==='OESC'?'BIDEI':'BIHCC'],['Año suministro',Number(month.slice(0,4))],['Mes suministro',Number(month.slice(5))],['Tipo de facturación','Provisorio'],[],['Contrato PS','Cliente','NEMO','Línea de facturación','Cantidad','Unidad','Precio (USD/unidad)','Observación'],...rows[soc].map(r=>[r.ps,r.client,r.nemo,r.unit==='MWh'?'Energías renovables':'Potencia',r.q,r.unit,r.price,r.notes])]}));
 if(comparison!==null)sheets.push({name:'Comparación DTE I vs II',rows:[['Año suministro',Number(month.slice(0,4))],['Mes suministro',Number(month.slice(5))],['Criterio','Diferencia = cantidad DTE II menos cantidad DTE I. Se suman entregas por sociedad, NEMO y producto; no se mezclan MWh y MWhrp.'],[],['Sociedad','Cliente','NEMO','Producto','Unidad','Cantidad DTE I','Cantidad DTE II','Diferencia II - I','Estado'],...comparison.map(r=>[r.society,r.client,r.nemo,r.unit==='MWh'?'Energía':'Potencia',r.unit,r.qI,r.qII,r.difference,r.status])]});
 const files={'[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map((s,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
 '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>'<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((s,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'</Relationships>'};
 sheets.forEach((s,i)=>files['xl/worksheets/sheet'+(i+1)+'.xml']=sheetXml(s.rows));return zip(files);
}
