export const DTE_LIMITS=Object.freeze({MWh:1,MWhrp:10});
export const significant=(difference,unit)=>Math.abs(Math.round(difference*1e6)/1e6)>DTE_LIMITS[unit];
const key=r=>[r.society,r.nemo,r.unit].join('|');
const flat=p=>p.billingRows?Object.values(p.billingRows).flat():p.rows;
function groups(rows){const out=new Map();for(const r of rows){const k=key(r);if(!out.has(k))out.set(k,[]);out.get(k).push(r);}return out;}
export function significantKeys(first,second){const a=groups(flat(first)),b=groups(flat(second)),keys=new Set([...a.keys(),...b.keys()]);return new Set([...keys].filter(k=>significant((b.get(k)||[]).reduce((n,r)=>n+r.q,0)-(a.get(k)||[]).reduce((n,r)=>n+r.q,0),(b.get(k)||a.get(k))[0].unit)));}
export function effectiveDteRows(first,second){const a=groups(flat(first)),b=groups(flat(second)),selected=significantKeys(first,second);return [...new Set([...a.keys(),...b.keys()])].flatMap(k=>(selected.has(k)?b.get(k)||[]:a.get(k)||[]).map(r=>({...r})));}
export function adjustmentRows(first,second){
 const selected=significantKeys(first,second),items=new Map();
 for(const [p,sign]of [[first,-1],[second,1]])for(const r of flat(p)){if(!selected.has(key(r)))continue;const k=[key(r),r.supplier||'',r.ps||'',r.price].join('|'),old=items.get(k)||{...r,q:0};old.q+=sign*r.q;items.set(k,old);}
 const result={OESC:[],OECC:[],AET:[]};for(const r of items.values()){r.q=Math.round(r.q*1e6)/1e6;if(!r.q)continue;result[r.society].push({...r,notes:[r.notes,'Ajuste DTE II − I; cantidad positiva: débito, negativa: crédito.'].filter(Boolean).join(' ')});}return result;
}
