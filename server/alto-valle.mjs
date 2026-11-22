// CTAVAL keeps ownership of operating data and its existing Actions/email flow.
export const ALTO_REPO='daniraggio/CTAVAL';
const raw='https://raw.githubusercontent.com/'+ALTO_REPO+'/main/data/';
const machines=['TG23','TG22','TV11','TV12'];
export const validateMonth=m=>{if(typeof m!=='string'||!/^20\d{2}_(0[1-9]|1[0-2])$/.test(m))throw {status:400,error:'Período de Alto Valle inválido.'};return m;};
export function normalizeAltoCatalog(data){
 if(data?.schemaVersion!==1||data.repository!==ALTO_REPO||!Array.isArray(data.periods)||!data.periods.length||data.periods.length>1200)throw Error('Catálogo de Alto Valle inválido.');
 const months=new Set(),periods=data.periods.map(p=>{const month=validateMonth(p.month);if(p.filename!=='AVAL_'+month+'.xls'||!Number.isFinite(p.size)||p.size<=0||months.has(month))throw Error('Período de Alto Valle inválido en el catálogo.');months.add(month);return {month,filename:p.filename,size:p.size};}).sort((a,b)=>a.month.localeCompare(b.month));
 return {repository:ALTO_REPO,periods};
}
export async function altoCatalog(fetcher=fetch,now=new Date()){
 const r=await fetcher('https://raw.githubusercontent.com/daniraggio/sgi/main/data/alto-valle-catalog.json',{cache:'no-store'});
 if(!r.ok)throw {status:502,error:'No se pudo consultar el índice de meses de Alto Valle. Volvé a intentar.'};
 const catalog=normalizeAltoCatalog(await r.json());
 // Discover new monthly files directly, without GitHub's directory API.
 // Stored metadata is never used as a substitute for the operating XLS itself.
 const latest=catalog.periods.at(-1).month,parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit'}).formatToParts(now),year=+parts.find(p=>p.type==='year').value,month=+parts.find(p=>p.type==='month').value,end=year*12+month-1;
 const [y,m]=latest.split('_').map(Number),start=y*12+m,candidates=[];
 if(end-start>=36)throw {status:502,error:'El índice de Alto Valle necesita una actualización del histórico.'};
 for(let n=start;n<=end;n++)candidates.push(Math.floor(n/12)+'_'+String(n%12+1).padStart(2,'0'));
 const probes=await Promise.all(candidates.map(async month=>{try{const r=await fetcher(raw+'AVAL_'+month+'.xls',{method:'HEAD'});return r.ok?{month,filename:'AVAL_'+month+'.xls',size:Number(r.headers.get('content-length'))||null}:null;}catch{return null;}}));
 catalog.periods.push(...probes.filter(Boolean));return catalog;
}
export async function configRevision(content){const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)));return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function readAltoConfig(fetcher=fetch){
 const r=await fetcher(raw+'config.json',{cache:'no-store'});if(!r.ok)throw {status:502,error:'No se pudo leer la configuración de Alto Valle.'};const content=await r.text(),config=JSON.parse(content);if(!config.CFG||!config.MONTH_CFG)throw Error('Configuración de Alto Valle inválida.');return {config,revision:await configRevision(content),repository:ALTO_REPO};
}
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
const numeric=(v,max=1e12)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max;
export function validateAltoConfig(input,current){
 if(!record(input)||!record(input.CFG)||!record(input.MONTH_CFG)||Object.keys(input.MONTH_CFG).length>240)throw Error('Configuración de Alto Valle inválida.');
 const next=structuredClone(current),globals=new Set(['FRA','RMIN_LO','RMIN_HI','RMIN_THR','CONF','CANON_AGUA','TRANSPORTE','ENRE']);
 for(const [k,v]of Object.entries(input.CFG)){if(!globals.has(k)||!numeric(v,k==='FRA'?1:1e12))throw Error('Parámetro global inválido: '+k);next.CFG[k]=v;}
 for(const [month,fields]of Object.entries(input.MONTH_CFG)){
  validateMonth(month);if(!record(fields))throw Error('Parámetros mensuales inválidos.');const target=next.MONTH_CFG[month]??={};
  for(const [k,v]of Object.entries(fields)){
   if(['TC','KP'].includes(k)){if(!numeric(v)||v===0)throw Error('Tipo de cambio o Kp inválido.');}
   else if(['TCFallback','Q1combProp','Q2combProp'].includes(k)){if(typeof v!=='boolean')throw Error('Indicador inválido.');}
   else if(['TCDate','Q1d','Q1h','Q2d','Q2h'].includes(k)){if(typeof v!=='string'||(v!==''&&(!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))))throw Error('Fecha inválida.');}
   else if(['Q1Comb','Q2Comb','Q1Oym','Q2Oym'].includes(k)){if(!record(v)||Object.entries(v).some(([m,n])=>!machines.includes(m)||!numeric(n)))throw Error('CVP por máquina inválido.');}
   else throw Error('Parámetro mensual desconocido: '+k);
   target[k]=record(v)?{...target[k],...v}:v;
  }
  for(const q of ['Q1','Q2'])if(target[q+'d']&&target[q+'h']&&target[q+'d']>target[q+'h'])throw Error('La quincena termina antes de comenzar.');
 }
 return next;
}
export async function saveAltoConfig(input,invoke){
 if(typeof input?.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision))throw Error('Falta la revisión de configuración. Actualizá antes de guardar.');
 const file=await invoke('fetch_file',{repository_full_name:ALTO_REPO,path:'data/config.json',ref:'main'});
 if(typeof file.content!=='string'||!file.sha)throw Error('No se pudo leer la versión vigente de Alto Valle.');
 if(await configRevision(file.content)!==input.revision)throw {status:409,error:'La configuración de Alto Valle cambió. Actualizá y revisá tus cambios antes de guardar.'};
 const config=validateAltoConfig(input.config,JSON.parse(file.content)),content=JSON.stringify(config,null,2)+'\n';
 await invoke('update_file',{repository_full_name:ALTO_REPO,branch:'main',path:'data/config.json',sha:file.sha,content,message:'SGI: actualizar configuración de Alto Valle'});
 return {config,revision:await configRevision(content),repository:ALTO_REPO};
}
