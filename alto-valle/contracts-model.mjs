// Pilot: closed periods use DTE quantities and approved commercial prices.
export const pilotMonths=Object.freeze(['2026-09','2026-10']);
const amount=(v,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('Valor inválido: '+name);return v;};
const sum=(rows,key)=>rows.reduce((s,r)=>s+r[key],0);
export function allocateOpenEnergy(contracts,generationMWh,month){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||month>'2027-03')throw Error('Falta definir el límite comercializable posterior a marzo de 2027.');
 const available=amount(generationMWh,'generación')*.2,total=contracts.reduce((s,c)=>s+amount(c.capMWh,'tope mensual'),0),assigned=Math.min(available,total);
 return {availableMWh:available,assignedMWh:assigned,rows:contracts.map(c=>({...c,q:total?assigned*c.capMWh/total:0})),remainingMWh:generationMWh-assigned};
}
export function allocateHourlyPower(contracts,hours){
 const totalMW=contracts.reduce((s,c)=>s+amount(c.capMW,'potencia contratada'),0),rows=contracts.map(c=>({...c,q:0}));
 const hourly=hours.map(h=>{const availableMW=amount(h.availableMW,'potencia disponible'),coveredMW=h.hrp?Math.min(totalMW,availableMW):0;if(h.hrp)for(let i=0;i<rows.length;i++)rows[i].q+=totalMW?coveredMW*contracts[i].capMW/totalMW:0;return {...h,coveredMW,unbackedMW:h.hrp?totalMW-coveredMW:0};});
 return {rows,hourly,coveredMWhrp:sum(rows,'q'),unbackedMWhrp:sum(hourly,'unbackedMW')};
}
export function closedContractAdjustment({month,rows,generationMWh,powerMWhrp,energyUSD,powerUSD,otherUSD,costsUSD}){
 if(!pilotMonths.includes(month))throw Error('La integración en validación está habilitada solo para septiembre y octubre de 2026.');
 for(const [k,v]of Object.entries({generationMWh,powerMWhrp,energyUSD,powerUSD,otherUSD,costsUSD}))amount(v,k);
 for(const r of rows){if(!['MWh','MWhrp'].includes(r.unit))throw Error('Unidad de contrato inválida.');amount(r.q,'cantidad DTE');amount(r.price,'precio comercial');}
 const energy=rows.filter(r=>r.unit==='MWh'),power=rows.filter(r=>r.unit==='MWhrp'),eq=sum(energy,'q'),pq=sum(power,'q');
 if(eq>generationMWh+1e-6||pq>powerMWhrp+1e-6)throw Error('La cantidad DTE supera la base operativa disponible. Revisá las fuentes antes de combinar ingresos.');
 const ef=generationMWh?eq/generationMWh:0,pf=powerMWhrp?pq/powerMWhrp:0,energyRemovedUSD=energyUSD*ef,powerRemovedUSD=powerUSD*pf,energySalesUSD=energy.reduce((s,r)=>s+r.q*r.price,0),powerSalesUSD=power.reduce((s,r)=>s+r.q*r.price,0),baseRevenueUSD=energyUSD+powerUSD+otherUSD,removedUSD=energyRemovedUSD+powerRemovedUSD,salesUSD=energySalesUSD+powerSalesUSD,deltaUSD=salesUSD-removedUSD;
 return {month,energyContractMWh:eq,powerContractMWhrp:pq,energySpotMWh:generationMWh-eq,powerSpotMWhrp:powerMWhrp-pq,energyLimitMWh:generationMWh*.2,energyFraction:ef,powerFraction:pf,energyRemovedUSD,powerRemovedUSD,energySalesUSD,powerSalesUSD,energySpotUSD:energyUSD-energyRemovedUSD,powerSpotUSD:powerUSD-powerRemovedUSD,energyPrice:eq?energySalesUSD/eq:null,powerPrice:pq?powerSalesUSD/pq:null,baseRevenueUSD,removedUSD,salesUSD,deltaUSD,revenueUSD:baseRevenueUSD+deltaUSD,costsUSD,baseNetUSD:baseRevenueUSD-costsUSD,netUSD:baseRevenueUSD+deltaUSD-costsUSD};
}
