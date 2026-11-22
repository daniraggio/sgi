// Contracts in the summary: closed DTE quantities or open-month hourly estimates.
const avContractCache=new Map(),avContractCacheAt=new Map();let avContractModel;
window.avInvalidateContracts=key=>avContractCache.delete(key.replace('_','-'));
async function avContractPeriod(key){
 const month=key.replace('_','-');if(Date.now()-(avContractCacheAt.get(month)||0)>15*60*1000)avContractCache.delete(month);
 if(!avContractCache.has(month)){avContractCacheAt.set(month,Date.now());avContractCache.set(month,(async()=>{const [model,response]=await Promise.all([import('/alto-valle/contracts-model.mjs'),fetch('/api/alto-valle/contracts?month='+month,{cache:'no-store'})]);const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudieron consultar los contratos.');if(data.month!==month)throw Error('Los contratos no corresponden al mes cerrado.');avContractModel=model;return data;})());}
 try{return await avContractCache.get(month)}catch(e){avContractCache.delete(month);throw e;}
}
function avResolvedContracts(period){
 if(period.closed||period.rows)return period;
 const observed=avContractModel.observedPowerHours({month:period.month,powerByMachine:MKEYS.map(m=>getRows(POTKEYS[m])),ppadRows:getRows('PRECIOS-PPAD')}),estimated=avContractModel.accumulatedContractRows({plan:period.plan,generationMWh:getComputedTotals().eMWh.TOTAL,month:period.month,...observed});
 return {...period,...estimated};
}
function avContractCalculation(period){
 period=avResolvedContracts(period);
 const tc=getTC(),generationMWh=getComputedTotals().eMWh.TOTAL,energyUSD=calcRemEnergia().TOTAL/tc,powerUSD=calcRemPotencia().TOTAL,otherUSD=calcPotMes()*CFG.CONF+calcRPF()/tc,baseRevenueUSD=energyUSD+powerUSD+otherUSD,gas=calcCostoGas(),canon=generationMWh*CFG.CANON_AGUA/tc,transport=CFG.TRANSPORTE/tc,enre=CFG.ENRE/tc;
 const costsUSD=(gas.TOTAL+gas.TOTAL_GA)/tc+canon+transport+enre+.0004*baseRevenueUSD+.006*(baseRevenueUSD-enre)+.006*(canon+transport);
 return avContractModel.closedContractAdjustment({month:period.month,rows:period.rows,generationMWh,powerMWhrp:calcPotHRP(),energyUSD,powerUSD,otherUSD,costsUSD});
}
// Hide the two analysis blocks in all months and currencies, including fallback views.
const avOriginalSummaryTable=mkResumenTable;
function avSummaryRows(rows){let suppress=false;return rows.filter(r=>{if(r?.sep)suppress=['Control FRC','Análisis'].includes(r.label);return !suppress;});}
let avSummaryPeriod=null;
mkResumenTable=function(rows){
 rows=avSummaryRows(rows);
 if(!avSummaryPeriod||avSummaryPeriod.month!==MONTH.replace('_','-')||!rows.some(r=>r?.label==='Rem. Energía'))return avOriginalSummaryTable(rows);
 const resolved=avResolvedContracts(avSummaryPeriod),tag=resolved.closed?'DTE '+resolved.edition:'estimada',quantityNote=resolved.closed?'asignación definitiva DTE':'estimación acumulada · último dato informado',a=avContractCalculation(resolved),usd=rows.find(r=>r?.label==='Rem. Energía').val.startsWith('USD '),currency=usd?'USD':'ARS',money=v=>currency+' '+fmtFull(v*(usd?1:getTC())),n=v=>fmtN(v,0),out=[];
 for(const original of rows){if(!original)continue;const r={...original};if(!usd&&r.val?.startsWith('$ '))r.val='ARS '+r.val.slice(2);switch(r.label){
 case 'Energía generada':out.push(r,{label:'Energía a contratos · '+tag,val:n(a.energyContractMWh),unit:'MWh · '+quantityNote},{label:'Energía al spot',val:n(a.energySpotMWh),unit:'MWh · generación menos contratos'});continue;
 case 'Rem. Energía':r.label='Energía spot · CAMMESA';r.val=money(a.energySpotUSD);r.unit=n(a.energySpotMWh)+' MWh · remuneración reducida proporcionalmente';out.push(r,{label:'Energía contratada · '+tag,val:money(a.energySalesUSD),unit:n(a.energyContractMWh)+' MWh × precios comerciales'});continue;
 case 'Rem. Potencia':r.label='Potencia spot · CAMMESA';r.val=money(a.powerSpotUSD);r.unit=n(a.powerSpotMWhrp)+' MWhrp · remuneración reducida proporcionalmente';out.push(r,{label:'Potencia contratada · '+tag,val:money(a.powerSalesUSD),unit:n(a.powerContractMWhrp)+' MWhrp × precios comerciales'});continue;
 case 'Potencia remunerada':r.label='Potencia disponible total en HRP';break;
 case 'Total Remuneraciones':r.label='Ingresos totales · spot + contratos';r.val=money(a.revenueUSD);r.unit='Energía + potencia + confiabilidad + RPF';break;
 case 'CAMMESA':case 'Imp. Déb/Cred':r.unit='Costo de referencia conservado para esta validación';break;
 case 'Total Costos':r.unit='Costos operativos completos, sin descontar contratos';break;
 case 'Rem. − Costos':r.label='Resultado con contratos';r.val=money(a.netUSD);r.unit='Ingresos ajustados − costos sin cambios';r.color=a.netUSD>=0?'var(--success)':'var(--danger)';break;
 }out.push(r);}
 return avOriginalSummaryTable(out);
};
// Keep the original summary layout. Contract detail lives in Contratos.
function avContractDetail(target,period,error){
 document.getElementById(target+'-contracts')?.remove();
 if(!error&&(!period||period.closed&&period.available!==false))return;
 const node=document.createElement('div');node.id=target+'-contracts';node.className='av-contract-pilot'+(error?' is-error':'');node.setAttribute('role','status');if(error)node.textContent='No se aplicó la integración de contratos: '+error.message+' Se muestra la referencia operativa sin contratos.';else if(period.available===false)node.textContent=period.message;else{const r=avResolvedContracts(period);node.textContent='Estimación acumulada · corte operativo: '+(r.lastDate||'sin datos horarios')+'. Respaldo de potencia: '+(r.coverage==null?'sin horas de punta informadas':fmtN(r.coverage*100,1)+'% sobre '+r.knownHours+' horas de punta completas')+'.'+(r.missingHours?' Hay '+r.missingHours+' horas de punta con datos incompletos; no se asumen respaldadas.':'')+' No incluye días posteriores al corte ni estima el cierre mensual.';}document.getElementById(target).before(node);
}
let avSummaryBuildId=0;
function avWrapSummary(original,target){return async function(){
 const key=MONTH,sequence=++avSummaryBuildId,section=document.getElementById(target).closest('.sec');section?.classList.add('av-summary-pending');
 try{let period=null,error=null;try{period=await avContractPeriod(key)}catch(e){error=e;}if(MONTH!==key||sequence!==avSummaryBuildId)return;avSummaryPeriod=period?.available===false?null:period;try{if(avSummaryPeriod)avContractCalculation(avSummaryPeriod)}catch(e){error=e;period=null;avSummaryPeriod=null;}await original();if(MONTH===key&&sequence===avSummaryBuildId)avContractDetail(target,period,error);
 }finally{if(sequence===avSummaryBuildId)section?.classList.remove('av-summary-pending');}
};}
buildResumen=avWrapSummary(buildResumen,'tbl-resumen-kpi');
buildResumenUSD=avWrapSummary(buildResumenUSD,'tbl-resumenUSD-kpi');
