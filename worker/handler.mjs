import {validateContract,validateGeneration} from '../server/model.mjs';
const CONNECTOR='connector_76869538009648d5b282a4bb21c3d157',REPOSITORY='daniraggio/sgi';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
async function invoke(binding,action,args){if(!binding)throw {status:503,error:'La conexión con GitHub no está disponible en esta solicitud.',connectorStatus:'binding_unavailable'};const result=await binding.invoke(CONNECTOR,action,args);if(result?.status!=='success')throw {status:result?.status==='reauthentication_required'?401:502,error:result?.message||'GitHub no confirmó la operación. Actualizá el listado antes de reintentar.',connectorStatus:result?.status,connectorResult:result,...(result?.status==='reauthentication_required'?{chatGPTSignInPath:'/signin-with-chatgpt?return_to=%2F'}:{})};const payload=result.result;if(payload?.structuredContent!==undefined)return payload.structuredContent;const text=payload?.content?.find(x=>x.type==='text')?.text;if(!text)throw {status:502,error:'GitHub devolvió una respuesta sin datos.'};try{return JSON.parse(text)}catch{throw {status:502,error:'GitHub devolvió un formato inesperado.'}}}
async function stateFromGitHub(binding){const file=await invoke(binding,'fetch_file',{repository_full_name:REPOSITORY,path:'data/state.json',ref:'main'});if(!file.sha||typeof file.content!=='string')throw {status:502,error:'No se pudo leer la versión del archivo de contratos.'};const state=JSON.parse(file.content);return {state,sha:file.sha}}
export function createHandler(assets){return {async fetch(request,env,ctx){const url=new URL(request.url);try{
 if(url.pathname.startsWith('/api/')){
  if(!request.headers.get('oai-authenticated-user-id'))return json(401,{error:'Iniciá sesión para leer y guardar contratos.',chatGPTSignInPath:'/signin-with-chatgpt?return_to=%2F'});
  const binding=ctx.props?.CONNECTORS;
  if(url.pathname==='/api/state'&&request.method==='GET'){const {state}=await stateFromGitHub(binding);return json(200,{...state,storage:'github',repository:REPOSITORY})}
  if((/^\/api\/contracts(?:\/[^/]+)?$/.test(url.pathname)&&['POST','PUT','DELETE'].includes(request.method))||(url.pathname==='/api/generation'&&request.method==='PUT')){
   if(request.headers.get('origin')!==url.origin)return json(403,{error:'Origen no autorizado'});
   if(request.headers.get('content-type')!=='application/json')return json(415,{error:'Se requiere JSON'});
   const text=await request.text();if(text.length>1000000)return json(413,{error:'Solicitud demasiado grande'});const input=JSON.parse(text),{state,sha}=await stateFromGitHub(binding);
   if(input.revision!==state.revision)return json(409,{error:'Otra persona guardó cambios. Actualizá el listado antes de guardar.'});
   if(url.pathname==='/api/generation'){const edit=validateGeneration(input,state.generation||[]),plan=state.generation.find(p=>p.id===edit.planId);plan.monthlyGeneration[edit.month]=edit.generation;state.revision++;state.audit.push({at:new Date().toISOString(),action:'GENERATION',...edit,revision:state.revision});await invoke(binding,'update_file',{repository_full_name:REPOSITORY,branch:'main',path:'data/state.json',sha,message:'SGI: actualizar generación estimada',content:JSON.stringify(state,null,2)+'\n'});return json(200,{revision:state.revision})}
   const id=url.pathname.split('/')[3],index=state.contracts.findIndex(c=>c.id===id);let saved;
   if(request.method==='POST'){saved={...validateContract(input.contract),id:crypto.randomUUID(),source:'Alta manual',imported:false};state.contracts.push(saved)}
   else{if(index<0)return json(404,{error:'Contrato no encontrado'});if(request.method==='DELETE'){state.contracts[index].active=false;saved=state.contracts[index]}else{saved={...validateContract(input.contract),id,psContract:input.contract.psContract===undefined?(state.contracts[index].psContract||''):validateContract(input.contract).psContract,priority:input.contract.priority===undefined?(state.contracts[index].priority??null):validateContract(input.contract).priority,source:state.contracts[index].source,imported:state.contracts[index].imported,linkedDemand:state.contracts[index].linkedDemand===true};state.contracts[index]=saved}}
   state.revision++;state.audit.push({at:new Date().toISOString(),action:request.method,contractId:saved.id,revision:state.revision});
   await invoke(binding,'update_file',{repository_full_name:REPOSITORY,branch:'main',path:'data/state.json',sha,message:'SGI: actualizar contrato comercial',content:JSON.stringify(state,null,2)+'\n'});
   return json(200,{contract:saved,revision:state.revision,storage:'github'});
  }
  return json(404,{error:'Ruta no encontrada'});
 }
 if(request.method!=='GET')return json(405,{error:'Método no permitido'});
 const file=assets[url.pathname==='/'?'/index.html':url.pathname];if(!file)return json(404,{error:'No encontrado'});return new Response(file.content,{headers:{'Content-Type':file.type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){return json(e.status||400,{error:e.error||e.message||'No se pudo completar la operación.',...(e.connectorStatus?{connectorStatus:e.connectorStatus}:{}),...(e.connectorResult?{connectorResult:e.connectorResult}:{}),...(e.chatGPTSignInPath?{chatGPTSignInPath:e.chatGPTSignInPath}:{})})}}}}
