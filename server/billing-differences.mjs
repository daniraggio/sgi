import {significant} from './dte-policy.mjs';
export function billingChanges(rows){return rows.flatMap(r=>{
 const changedPs=String(r.psI??'')!==String(r.psII??''),changedPrice=String(r.priceI??'')!==String(r.priceII??''),both=r.presentI&&r.presentII;
 const quantity=significant(r.difference,r.unit);
 if(!quantity)return [];
 const changes=[];if(!r.presentI)changes.push('Sólo en DTE II');else if(!r.presentII)changes.push('Sólo en DTE I');else if(quantity)changes.push('Cantidad');if(both&&changedPs)changes.push('Contrato PS');if(both&&changedPrice)changes.push('Precio');
 return [{...r,changes}];
});}
export function comparisonDocument(month,rows){return {schemaVersion:1,month,edition:'II',againstEdition:'I',rows};}
