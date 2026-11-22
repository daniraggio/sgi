import {adjustmentRows} from './dte-policy.mjs';
import {billingChanges} from './billing-differences.mjs';
import {billingCatalog,billingRows,billingXlsx,billingComparison} from './billing.mjs';
import http from 'node:http';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {validateContract,validateGeneration} from './model.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),file=process.env.SGI_STATE_PATH||resolve(root,'data/state.json');
const repo=process.env.GITHUB_REPOSITORY||'daniraggio/sgi',branch=process.env.GITHUB_BRANCH||'main',remote=Boolean(process.env.GITHUB_TOKEN);
let queue=Promise.resolve();
async function github(method,body){const r=await fetch(`https://api.github.com/repos/${repo}/contents/data/state.json${method==='GET'?'?ref='+encodeURIComponent(branch):''}`,{method,headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const e=new Error(r.status===409?'Otra persona guardó cambios. Recargá antes de guardar.':'No se pudo guardar o leer el repositorio');e.status=r.status===409?409:502;throw e}return r.json()}
async function load(){if(remote){const r=await github('GET');return {state:JSON.parse(Buffer.from(r.content,'base64').toString('utf8')),sha:r.sha}}return {state:JSON.parse(await readFile(file,'utf8'))}}
async function persist(state,sha){const content=JSON.stringify(state,null,2)+'\n';if(remote){await github('PUT',{message:'SGI: actualizar contrato comercial',content:Buffer.from(content).toString('base64'),sha,branch});return}await mkdir(dirname(file),{recursive:true});await writeFile(file+'.tmp',content);await rename(file+'.tmp',file)}
function reply(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body))}
export const server=http.createServer(async(req,res)=>{try{
 const secret=process.env.SGI_PASSWORD;
 if(!secret){reply(res,503,{error:'Configurá SGI_PASSWORD en el servidor para habilitar el acceso protegido.'});return}
 const expected=Buffer.from('Basic '+Buffer.from('sgi:'+secret).toString('base64')),supplied=Buffer.from(req.headers.authorization||'');
 if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="SGI", charset="UTF-8"','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Se requiere autenticación para consultar o modificar contratos.'}));return}
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/billing'||url.pathname==='/api/billing/catalog'){
  if(req.method!=='GET'){reply(res,405,{error:'Método no permitido'});return}
  const data=JSON.parse(await readFile(resolve(root,'data/dte-billing.json'),'utf8'));
  if(url.pathname.endsWith('/catalog')){reply(res,200,{periods:billingCatalog(data)});return}
  const month=url.searchParams.get('month')||'',edition=url.searchParams.get('edition')||'',{state}=await load(),rows=billingRows(state,data,month,edition);
  const periods=data.periods.map(p=>p.month===month?{...p,billingRows:p.billingRows||billingRows(state,data,month,p.edition)}:p),first=periods.find(p=>p.month===month&&p.edition==='I'),second=periods.find(p=>p.month===month&&p.edition==='II');
  const bytes=billingXlsx(edition==='II'?adjustmentRows(first,second):rows,month,edition==='II'?billingChanges(billingComparison(state,{periods},month)):null,{AET:state.societies?.AET?.businessUnit},JSON.parse(await readFile(resolve(root,'data/fnee-rates.json'),'utf8')),edition==='II');
  res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Facturacion_'+month+'_DTE_'+edition+'.xlsx"','Cache-Control':'no-store'});res.end(bytes);return;
 }
 if(url.pathname==='/api/state'&&req.method==='GET'){const {state}=await load();reply(res,200,{...state,storage:remote?'github':'repository',repository:repo});return}
 if((/^\/api\/contracts(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PUT','DELETE'].includes(req.method))||(url.pathname==='/api/generation'&&req.method==='PUT')){
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){reply(res,403,{error:'Origen no autorizado'});return}
  if(req.headers['content-type']!=='application/json'){reply(res,415,{error:'Se requiere JSON'});return}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>1000000){reply(res,413,{error:'Solicitud demasiado grande'});return}}
  const input=JSON.parse(body);const action=async()=>{const {state,sha}=await load();if(input.revision!==state.revision){reply(res,409,{error:'Hay cambios más recientes. Recargá el listado antes de guardar.'});return}
   if(url.pathname==='/api/generation'){const edit=validateGeneration(input,state.generation||[]),plan=state.generation.find(p=>p.id===edit.planId);plan.monthlyGeneration[edit.month]=edit.generation;state.revision++;state.audit.push({at:new Date().toISOString(),action:'GENERATION',...edit,revision:state.revision});await persist(state,sha);reply(res,200,{revision:state.revision});return}
   const id=url.pathname.split('/')[3];const index=state.contracts.findIndex(c=>c.id===id);let saved;
   if(req.method==='POST'){saved={...validateContract(input.contract),id:randomUUID(),source:'Alta manual',imported:false};state.contracts.push(saved)}
   else{if(index<0){reply(res,404,{error:'Contrato no encontrado'});return}if(req.method==='DELETE'){if(input.confirmDelete!==true)throw Error('Confirmá la eliminación del contrato.');saved=state.contracts.splice(index,1)[0]}else{saved={...validateContract(input.contract),id,psContract:input.contract.psContract===undefined?(state.contracts[index].psContract||''):validateContract(input.contract).psContract,priority:input.contract.priority===undefined?(state.contracts[index].priority??null):validateContract(input.contract).priority,...{source:state.contracts[index].source,imported:state.contracts[index].imported,linkedDemand:state.contracts[index].linkedDemand===true}};state.contracts[index]=saved}}
   state.revision++;state.audit.push({at:new Date().toISOString(),action:req.method,contractId:saved.id,revision:state.revision});await persist(state,sha);reply(res,200,{contract:saved,revision:state.revision,storage:remote?'github':'repository'});
  };const next=queue.then(action);queue=next.catch(()=>{});await next;return;
 }
 if(req.method!=='GET'){reply(res,405,{error:'Método no permitido'});return}
 const paths={'/docs/INTEGRACION.md':'docs/INTEGRACION.md','/':'dist/index.html','/index.html':'dist/index.html','/contracts.js':'contracts.js','/contracts.css':'contracts.css','/model.mjs':'server/model.mjs'};
 const target=paths[url.pathname];if(!target){reply(res,404,{error:'No encontrado'});return}
 const data=await readFile(resolve(root,target));res.writeHead(200,{'Content-Type':target.endsWith('.html')?'text/html; charset=utf-8':target.endsWith('.css')?'text/css; charset=utf-8':target.endsWith('.md')?'text/markdown; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);
 }catch(e){reply(res,e.status||400,{error:e.status?(e.error||e.message):'No se pudo completar la operación. Revisá los datos ingresados.'})}});
if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(+process.env.PORT||4173,process.env.HOST||'127.0.0.1',()=>console.log('SGI listo en puerto '+(+process.env.PORT||4173)));
