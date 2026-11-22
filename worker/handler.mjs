import {loadAltoContracts} from '../server/alto-contract-data.mjs';
import {altoCatalog,readAltoConfig,saveAltoConfig} from '../server/alto-valle.mjs';
import {billingPackage,savedAdjustments} from '../server/billing-downloads.mjs';
import {adjustmentRows} from '../server/dte-policy.mjs';
import {billingChanges} from '../server/billing-differences.mjs';
import {publishedCatalog,savedBilling,savedComparison,publishBilling} from '../server/published-billing.mjs';
import {createDteService} from '../server/dte-cache.mjs';
import {SHAREPOINT} from '../server/dte.mjs';
import {billingCatalog,billingRows,billingXlsx,billingComparison} from '../server/billing.mjs';
import {validateContract,validateGeneration} from '../server/model.mjs';
const CONNECTOR='connector_76869538009648d5b282a4bb21c3d157',REPOSITORY='daniraggio/sgi';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function invoke(binding,action,args,connector=CONNECTOR){if(!binding)throw {status:503,error:'La conexión requerida no está disponible en esta solicitud.',connectorStatus:'binding_unavailable'};const result=await binding.invoke(connector,action,args);if(result?.status!=='success')throw {status:result?.status==='reauthentication_required'?401:502,error:result?.message||'La conexión no confirmó la operación. Actualizá antes de reintentar.',connectorStatus:result?.status,connectorResult:result,...(result?.status==='reauthentication_required'?{chatGPTSignInPath:'/signin-with-chatgpt?return_to=%2F'}:{})};const payload=result.result;if(payload?.structuredContent!==undefined)return payload.structuredContent;const text=payload?.content?.find(x=>x.type==='text')?.text;if(!text)throw {status:502,error:'GitHub devolvió una respuesta sin datos.'};try{return JSON.parse(text)}catch{throw {status:502,error:'GitHub devolvió un formato inesperado.'}}}
async function stateFromGitHub(binding){const file=await invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path:'data/state.json',ref:'main'});if(!file.sha||typeof file.content!=='string')throw {status:502,error:'No se pudo leer la versión del archivo de contratos.'};const state=JSON.parse(file.content);return {state,sha:file.sha}}
export function createHandler(assets,base={},options={}){return {async fetch(request,env,ctx){const url=new URL(request.url);try{
 if(url.pathname.startsWith('/api/')){
  if(!request.headers.get('oai-authenticated-user-id'))return json(401,{error:'Iniciá sesión para leer y guardar contratos.',chatGPTSignInPath:'/signin-with-chatgpt?return_to=%2F'});
  if(url.pathname==='/api/billing/published'&&request.method==='GET')return json(200,await publishedCatalog(options.publishedFetcher||fetch));
  if(url.pathname==='/api/billing/saved'&&request.method==='GET'){const month=url.searchParams.get('month')||'',edition=url.searchParams.get('edition')||'',{bytes,filename}=await (edition==='II'?savedAdjustments(month,options.publishedFetcher||fetch):savedBilling(month,edition,options.publishedFetcher||fetch));return new Response(bytes,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'private, no-store'}});}
  if(url.pathname==='/api/billing/package'&&request.method==='GET'){const {bytes,filename}=await billingPackage(url.searchParams.get('month')||'',options.publishedFetcher||fetch);return new Response(bytes,{headers:{'Content-Type':filename.endsWith('.zip')?'application/zip':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'private, no-store'}});}
  if(url.pathname==='/api/billing/comparison'&&request.method==='GET')return json(200,await savedComparison(url.searchParams.get('month')||'',options.publishedFetcher||fetch));
  const binding=ctx.props?.CONNECTORS;
  if(url.pathname==='/api/alto-valle/contracts'&&request.method==='GET')return json(200,await loadAltoContracts(url.searchParams.get('month')||'',options.altoFetcher||fetch));
  if(url.pathname==='/api/alto-valle/catalog'&&request.method==='GET')return json(200,await altoCatalog(options.altoFetcher||fetch));
  if(url.pathname==='/api/alto-valle/config'){
   if(request.method==='GET')return json(200,await readAltoConfig(options.altoFetcher||fetch));
   if(request.method!=='PUT')return json(405,{error:'Método no permitido'});
   if(request.headers.get('origin')!==url.origin)return json(403,{error:'Origen no autorizado'});
   if(request.headers.get('content-type')!=='application/json')return json(415,{error:'Se requiere JSON'});
   const text=await request.text();if(text.length>100000)return json(413,{error:'Configuración demasiado grande'});
   return json(200,await saveAltoConfig(JSON.parse(text),(action,args)=>invoke(binding,action,args)));
  }
  const service=createDteService({base,fetcher:options.fetcher,history:async()=>JSON.parse((await invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path:'data/billing-history.json',ref:'main'})).content).records,read:path=>invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path,ref:'main'}),write:(path,content,sha)=>invoke(binding,sha?'update_file':'create_file',{repository_full_name:REPOSITORY,branch:'main',path,content,message:'SGI: incorporar DTE y valores reales',...(sha?{sha}:{})}),sharepoint:(action,args)=>invoke(binding,action,args,SHAREPOINT)});
  if(url.pathname==='/api/actuals'&&request.method==='GET')return json(200,await service.actuals());
  if(['/api/dte/discover','/api/dte/prepare','/api/dte/publish'].includes(url.pathname)){
   if(request.method!=='POST')return json(405,{error:'Método no permitido'});
   if(request.headers.get('origin')!==url.origin)return json(403,{error:'Origen no autorizado'});
   if(request.headers.get('content-type')!=='application/json')return json(415,{error:'Se requiere JSON'});
   const text=await request.text();if(text.length>10000)return json(413,{error:'Solicitud demasiado grande'});const input=JSON.parse(text);
   if(url.pathname.endsWith('/discover'))return json(200,{periods:await service.discover(input.month)});
   if(input.force!==undefined&&typeof input.force!=='boolean')return json(400,{error:'Forzar actualización debe ser verdadero o falso.'});
   if(input.step){if(!url.pathname.endsWith('/prepare'))throw Error('Etapa no válida para esta operación.');return json(200,await service.prepare(input.month,input.edition,input.force===true,input.step));}
   const prepared=url.pathname.endsWith('/publish')?{}:await service.prepare(input.month,input.edition,input.force===true);try{const {state}=await stateFromGitHub(binding),{period,first}=await service.billing(input.month,input.edition,state),rows=period.billingRows||billingRows(state,{periods:[period]},input.month,input.edition),comparison=input.edition==='II'?billingComparison(state,{periods:[first,period]},input.month):null,funds=JSON.parse((await invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path:'data/fnee-rates.json',ref:'main'})).content),bytes=billingXlsx(rows,input.month,comparison,{AET:state.societies?.AET?.businessUnit},funds);prepared.published=await publishBilling({month:input.month,edition:input.edition,bytes,comparison,stateRevision:state.revision,force:input.force===true,invoke:(action,args)=>invoke(binding,action,args)});}catch(e){prepared.publicationError=e.error||e.message||'No se pudo guardar el XLSX para descarga compartida.';}return json(200,prepared);
  }
  if(url.pathname==='/api/billing'||url.pathname==='/api/billing/catalog'){
   if(request.method!=='GET')return json(405,{error:'Método no permitido'});
   if(url.pathname.endsWith('/catalog')){const {data}=await service.index();return json(200,{periods:(data.periods||[]).map(p=>({month:p.month,edition:p.edition,processed:!!(p.cachePath||(p.processedAt&&p.rows&&p.generation)||base.actualEditions?.[p.month]===p.edition),processedAt:p.processedAt}))});}
   const month=url.searchParams.get('month')||'',edition=url.searchParams.get('edition')||'',{state}=await stateFromGitHub(binding),{period,first}=await service.billing(month,edition,state),rows=period.billingRows||billingRows(state,{periods:[period]},month,edition);
   const comparison=edition==='II'?billingComparison(state,{periods:[{...first,rows:first.rows},{...period,rows:period.rows}]},month):null;
   const hasEnergy=Object.values(rows).flat().some(r=>r.unit==='MWh'),fundRates=hasEnergy?JSON.parse((await invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path:'data/fnee-rates.json',ref:'main'})).content):{};
   return new Response(billingXlsx(edition==='II'?adjustmentRows({...first,billingRows:first.billingRows||billingRows(state,{periods:[first]},month,'I')},{...period,billingRows:rows}):rows,month,edition==='II'?billingChanges(comparison):comparison,{AET:state.societies?.AET?.businessUnit},fundRates,edition==='II'),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="Facturacion_'+month+'_DTE_'+edition+'.xlsx"','Cache-Control':'private, no-store'}});
  }
  if(url.pathname==='/api/state'&&request.method==='GET'){const {state}=await stateFromGitHub(binding);return json(200,{...state,storage:'github',repository:REPOSITORY})}
  if((/^\/api\/contracts(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PUT','DELETE'].includes(request.method))||(url.pathname==='/api/generation'&&request.method==='PUT')){
   if(request.headers.get('origin')!==url.origin)return json(403,{error:'Origen no autorizado'});
   if(request.headers.get('content-type')!=='application/json')return json(415,{error:'Se requiere JSON'});
   const text=await request.text();if(text.length>1000000)return json(413,{error:'Solicitud demasiado grande'});const input=JSON.parse(text),{state,sha}=await stateFromGitHub(binding);
   if(input.revision!==state.revision)return json(409,{error:'Otra persona guardó cambios. Actualizá el listado antes de guardar.'});
   if(url.pathname==='/api/generation'){const edit=validateGeneration(input,state.generation||[]),plan=state.generation.find(p=>p.id===edit.planId);plan.monthlyGeneration[edit.month]=edit.generation;state.revision++;state.audit.push({at:new Date().toISOString(),action:'GENERATION',...edit,revision:state.revision});await invoke(binding,'update_file',{repository_full_name:REPOSITORY,branch:'main',path:'data/state.json',sha,message:'SGI: actualizar generación estimada',content:JSON.stringify(state)+'\n'});return json(200,{revision:state.revision})}
   const id=url.pathname.split('/')[3],index=state.contracts.findIndex(c=>c.id===id);let saved;
   if(request.method==='POST'){saved={...validateContract(input.contract),id:crypto.randomUUID(),source:'Alta manual',imported:false};state.contracts.push(saved)}
   else{if(index<0)return json(404,{error:'Contrato no encontrado'});if(request.method==='DELETE'){if(input.confirmDelete!==true)throw Error('Confirmá la eliminación del contrato.');saved=state.contracts.splice(index,1)[0]}else{saved={...validateContract(input.contract),id,psContract:input.contract.psContract===undefined?(state.contracts[index].psContract||''):validateContract(input.contract).psContract,priority:input.contract.priority===undefined?(state.contracts[index].priority??null):validateContract(input.contract).priority,source:state.contracts[index].source,imported:state.contracts[index].imported,linkedDemand:state.contracts[index].linkedDemand===true};state.contracts[index]=saved}}
   state.revision++;state.audit.push({at:new Date().toISOString(),action:request.method,contractId:saved.id,revision:state.revision});
   await invoke(binding,'update_file',{repository_full_name:REPOSITORY,branch:'main',path:'data/state.json',sha,message:'SGI: actualizar contrato comercial',content:JSON.stringify(state)+'\n'});
   return json(200,{contract:saved,revision:state.revision,storage:'github'});
  }
  return json(404,{error:'Ruta no encontrada'});
 }
 if(request.method!=='GET')return json(405,{error:'Método no permitido'});
 const aliases={'/':'/app-shell.html','/index.html':'/app-shell.html','/contratos':'/index.html','/contratos/':'/index.html','/alto-valle':'/alto-valle/index.html','/alto-valle/':'/alto-valle/index.html'};const file=assets[aliases[url.pathname]||url.pathname];if(!file)return json(404,{error:'No encontrado'});return new Response(file.content,{headers:{'Content-Type':file.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return json(e.status||400,{error:e.error||e.message||'No se pudo completar la operación.',...(e.connectorStatus?{connectorStatus:e.connectorStatus}:{}),...(e.connectorResult?{connectorResult:e.connectorResult}:{}),...(e.chatGPTSignInPath?{chatGPTSignInPath:e.chatGPTSignInPath}:{})})}}}}
