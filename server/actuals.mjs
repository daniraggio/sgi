export const recordMonth=o=>o.date||(typeof o.month==='string'?o.month:'2026-'+String(o.month).padStart(2,'0'));
export function applyActualPeriods(data,periods){
 for(const p of periods){if(!p||!/^20\d{2}-\d{2}$/.test(p.month))throw Error('Período real inválido');const date=p.month;
  data.ops=data.ops.filter(o=>recordMonth(o)!==date).concat(p.oescEnergy);
  data.months=data.months.filter(o=>recordMonth(o)!==date).concat(p.oescSummary).sort((a,b)=>recordMonth(a).localeCompare(recordMonth(b)));
  data.oescPower=data.oescPower.filter(o=>recordMonth(o)!==date).concat(p.oescPower);
  data.oecc=data.oecc.filter(o=>recordMonth(o)!==date).concat(p.oecc);
  if(date>='2026-11'){data.aet=(data.aet||[]).filter(o=>recordMonth(o)!==date).concat(p.aet||[]);data.aetActualMonths=[...new Set([...(data.aetActualMonths||[]),date])].sort();}
  data.forecast=data.forecast.filter(o=>o.date!==date);data.actualGeneration??={};data.actualGeneration[date]=p.generation;
  data.actualSpots??={};data.actualSpots[date]=p.spot;
  data.purchases=data.purchases.filter(o=>recordMonth(o)!==date);
  for(const supplier of ['GSSR','LEDLAR','OECC · Alto Valle']){const rows=p.oescEnergy.filter(o=>o.supplier===supplier),q=rows.reduce((n,o)=>n+o.q,0),cost=rows.reduce((n,o)=>n+o.cost,0);if(q)data.purchases.push({date,month:+date.slice(5),supplier,q,price:cost/q,net:cost,gross:cost,source:'DTE '+p.edition+' · '+date});}
  const prior=data.oeccCapacity.find(o=>o.month===date);data.oeccCapacity=data.oeccCapacity.filter(o=>o.month!==date).concat({month:date,generation:p.generation['OECC · Alto Valle'],commercial:p.oeccCommercial??p.oecc.filter(o=>o.kind==='energy').reduce((n,o)=>n+o.q,0),contracted:prior?.contracted??0,delivered:p.oecc.filter(o=>o.kind==='energy').reduce((n,o)=>n+o.q,0),source:'DTE '+p.edition+' · '+date});
  data.actualEditions??={};data.actualEditions[date]=p.edition;
 }
 data.actualMonths=[...new Set(data.months.map(recordMonth))].sort();data.actualThrough=data.actualMonths.at(-1);return data;
}
