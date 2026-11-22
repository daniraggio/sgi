// Closed-month pilot: keep physical calculations and all baseline costs intact.
const avContractCache=new Map();let avContractModel;
window.avInvalidateContracts=key=>avContractCache.delete(key.replace('_','-'));
async function avContractPeriod(key){
 const month=key.replace('_','-');if(!['2026-09','2026-10'].includes(month))return null;
 if(!avContractCache.has(month))avContractCache.set(month,(async()=>{const [model,response]=await Promise.all([import('/alto-valle/contracts-model.mjs'),fetch('/api/alto-valle/contracts?month='+month,{cache:'no-store'})]);const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudieron consultar los contratos.');if(data.month!==month||!data.closed)throw Error('Los contratos no corresponden al mes cerrado.');avContractModel=model;return data;})());
 try{return await avContractCache.get(month)}catch(e){avContractCache.delete(month);throw e;}
}
function avContractCalculation(period){
 const tc=getTC(),generationMWh=getComputedTotals().eMWh.TOTAL,energyUSD=calcRemEnergia().TOTAL/tc,powerUSD=calcRemPotencia().TOTAL,otherUSD=calcPotMes()*CFG.CONF+calcRPF()/tc,baseRevenueUSD=energyUSD+powerUSD+otherUSD,gas=calcCostoGas(),canon=generationMWh*CFG.CANON_AGUA/tc,transport=CFG.TRANSPORTE/tc,enre=CFG.ENRE/tc;
 const costsUSD=(gas.TOTAL+gas.TOTAL_GA)/tc+canon+transport+enre+.0004*baseRevenueUSD+.006*(baseRevenueUSD-enre)+.006*(canon+transport);
 return avContractModel.closedContractAdjustment({month:period.month,rows:period.rows,generationMWh,powerMWhrp:calcPotHRP(),energyUSD,powerUSD,otherUSD,costsUSD});
}
const avOriginalSummaryTable=mkResumenTable;let avSummaryPeriod=null;
mkResumenTable=function(rows){
 if(!avSummaryPeriod||avSummaryPeriod.month!==MONTH.replace('_','-')||!rows.some(r=>r?.label==='Rem. Energía'))return avOriginalSummaryTable(rows);
 const a=avContractCalculation(avSummaryPeriod),usd=rows.find(r=>r?.label==='Rem. Energía').val.startsWith('USD '),currency=usd?'USD':'ARS',money=v=>currency+' '+fmtFull(v*(usd?1:getTC())),n=v=>fmtN(v,0),out=[];
 for(const original of rows){if(!original)continue;const r={...original};if(!usd&&r.val?.startsWith('$ '))r.val='ARS '+r.val.slice(2);switch(r.label){
 case 'Energía generada':out.push(r,{label:'Energía a contratos · DTE '+avSummaryPeriod.edition,val:n(a.energyContractMWh),unit:'MWh · asignación definitiva DTE'},{label:'Energía al spot',val:n(a.energySpotMWh),unit:'MWh · generación menos contratos'});continue;
 case 'Rem. Energía':r.label='Energía spot · CAMMESA';r.val=money(a.energySpotUSD);r.unit=n(a.energySpotMWh)+' MWh · remuneración reducida proporcionalmente';out.push(r,{label:'Energía contratada · DTE',val:money(a.energySalesUSD),unit:n(a.energyContractMWh)+' MWh × precios comerciales'});continue;
 case 'Rem. Potencia':r.label='Potencia spot · CAMMESA';r.val=money(a.powerSpotUSD);r.unit=n(a.powerSpotMWhrp)+' MWhrp · remuneración reducida proporcionalmente';out.push(r,{label:'Potencia contratada · DTE',val:money(a.powerSalesUSD),unit:n(a.powerContractMWhrp)+' MWhrp × precios comerciales'});continue;
 case 'Potencia remunerada':r.label='Potencia disponible total en HRP';break;
 case 'Total Remuneraciones':r.label='Ingresos totales · spot + contratos';r.val=money(a.revenueUSD);r.unit='Energía + potencia + confiabilidad + RPF';break;
 case 'CAMMESA':case 'Imp. Déb/Cred':r.unit='Costo de referencia conservado para esta validación';break;
 case 'Total Costos':r.unit='Mismos costos que el Resumen sin contratos';break;
 case 'Rem. − Costos':r.label='Resultado con contratos';r.val=money(a.netUSD);r.unit='Ingresos ajustados − costos sin cambios';r.color=a.netUSD>=0?'var(--success)':'var(--danger)';out.push(r,{label:'Resultado de referencia · sin contratos',val:money(a.baseNetUSD),unit:'Modelo operativo previo'},{label:'Efecto de los contratos',val:money(a.deltaUSD),unit:'Venta contractual − remuneración CAMMESA sustituida',b:true,result:true,color:a.deltaUSD>=0?'var(--success)':'var(--danger)'});continue;
 case 'Control FRC':r.label='Control FRC · referencia operativa sin contratos';break;
 case 'Análisis':r.label='Análisis · referencia operativa sin contratos';break;
 case 'Renta Marginal':r.label='Renta marginal · referencia sin contratos';break;
 }out.push(r);}
 return avOriginalSummaryTable(out);
};
const avContractEsc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function avContractDetail(target,period,error){
 document.getElementById(target+'-contracts')?.remove();const node=document.createElement('div');node.id=target+'-contracts';node.className='av-contract-pilot';node.setAttribute('role','status');document.getElementById(target).before(node);
 if(error){node.classList.add('is-error');node.textContent='No se aplicó la integración de contratos: '+error.message+' Se muestra la referencia operativa sin contratos.';return;}
 if(!period){node.textContent='Referencia operativa sin contratos. La integración está en validación solo para septiembre y octubre de 2026.';return;}
 const a=avContractCalculation(period),esc=avContractEsc,n=v=>fmtN(v,0),money=v=>'USD '+fmtFull(v);
 node.innerHTML='<strong>Validación · '+esc(MONTH_META[MONTH].label)+' · DTE '+esc(period.edition)+'</strong><p>Cantidades definitivas del DTE y precios comerciales de Contratos. Costos sin cambios: el gas se paga tanto para ventas al spot como para contratos. Confiabilidad y RPF se conservan. Los gráficos muestran la generación operativa total.</p><div class="av-contract-scroll"><table><thead><tr><th>Ingresos · USD</th><th>CAMMESA sustituido</th><th>Venta a contratos</th><th>Efecto en resultado</th></tr></thead><tbody>'+[['Energía',a.energyRemovedUSD,a.energySalesUSD],['Potencia',a.powerRemovedUSD,a.powerSalesUSD],['Total',a.removedUSD,a.salesUSD]].map(([label,removed,sales])=>'<tr><th>'+label+'</th><td>'+money(removed)+'</td><td>'+money(sales)+'</td><td>'+money(sales-removed)+'</td></tr>').join('')+'</tbody></table></div><details><summary>Ver cantidades y precios por comercializador</summary><p>'+esc(period.quantitiesSource)+'. '+esc(period.pricesSource)+'.</p><div class="av-contract-scroll"><table><thead><tr><th>Comercializador / NEMO</th><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Ingreso · USD</th></tr></thead><tbody>'+period.rows.filter(r=>r.q>0).sort((x,y)=>x.unit.localeCompare(y.unit)||x.nemo.localeCompare(y.nemo)).map(r=>'<tr><td>'+esc(r.client)+'<br><small>'+esc(r.nemo)+'</small></td><td>'+(r.unit==='MWh'?'Energía':'Potencia')+'</td><td>'+n(r.q)+' '+esc(r.unit)+'</td><td>USD '+fmtN(r.price,2)+'/'+esc(r.unit)+'</td><td>'+money(r.q*r.price)+'</td></tr>').join('')+'</tbody></table></div></details>';
}
function avWrapSummary(original,target){return async function(){const key=MONTH;let period=null,error=null;try{period=await avContractPeriod(key)}catch(e){error=e;}if(MONTH!==key)return;avSummaryPeriod=period;try{if(period)avContractCalculation(period)}catch(e){error=e;period=null;avSummaryPeriod=null;}await original();if(MONTH===key)avContractDetail(target,period,error);};}
buildResumen=avWrapSummary(buildResumen,'tbl-resumen-kpi');
buildResumenUSD=avWrapSummary(buildResumenUSD,'tbl-resumenUSD-kpi');
