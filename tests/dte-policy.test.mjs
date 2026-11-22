import test from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';
import {effectiveDteRows,adjustmentRows} from '../server/dte-policy.mjs';
import {billingXlsx} from '../server/billing.mjs';
import {archivedRows,billingPackage,savedAdjustments} from '../server/billing-downloads.mjs';
const r=(nemo,unit,q,price=58)=>({society:'OESC',nemo,unit,q,price,ps:'2362',supplier:'GSSR',client:'Cliente'});
const period=(edition,rows)=>({month:'2026-10',edition,rows,billingRows:{OESC:rows,OECC:[],AET:[]}});
const funds={rates:{'2026-10':{arsPerMWh:2508}}};
test('umbrales por NEMO y producto: estrictos, simétricos y sin alterar originales',()=>{
 const a=period('I',[r('A','MWh',100),r('B','MWh',100),r('C','MWhrp',100),r('D','MWhrp',100)]),b=period('II',[r('A','MWh',101),r('B','MWh',98.999),r('C','MWhrp',110),r('D','MWhrp',89.999)]),before=structuredClone([a,b]);
 assert.deepEqual(effectiveDteRows(a,b).map(r=>r.q),[100,98.999,100,89.999]);assert.deepEqual(adjustmentRows(a,b).OESC.map(r=>r.q),[-1.001,-10.001]);assert.deepEqual([a,b],before);
});
test('bajas, altas y cambio de precio: crédito original y débito nuevo',()=>{
 const a=period('I',[r('A','MWh',100,58),r('B','MWh',20)]),b=period('II',[r('A','MWh',105,64),r('C','MWh',2)]),rows=adjustmentRows(a,b).OESC;
 assert.equal(rows.find(r=>r.nemo==='B').q,-20);assert.equal(rows.find(r=>r.nemo==='C').q,2);assert.equal(rows.filter(r=>r.nemo==='A').reduce((s,r)=>s+r.q*r.price,0),105*64-100*58);
});
test('exports públicos se leen sin duplicar FNEE y se descargan como ajustes',async()=>{
 const a=period('I',[r('A','MWh',100),r('B','MWhrp',100)]),b=period('II',[r('A','MWh',102),r('B','MWhrp',110)]),first=billingXlsx(a.billingRows,a.month,null,{},funds),second=billingXlsx(b.billingRows,b.month,null,{},funds);
 assert.equal(archivedRows(first).OESC.length,2);
 const fetcher=async url=>url.endsWith('billing-exports.json')?Response.json({periods:['I','II'].map(edition=>({month:a.month,edition,path:'exports/billing/Facturacion_'+a.month+'_DTE_'+edition+'.xlsx'}))}):url.endsWith('fnee-rates.json')?Response.json(funds):new Response(url.endsWith('_II.xlsx')?second:first);
 const file=await savedAdjustments(a.month,fetcher),rows=archivedRows(file.bytes);assert.match(file.filename,/Ajustes/);assert.equal(rows.OESC.length,1);assert.equal(rows.OESC[0].q,2);const xml=strFromU8(unzipSync(file.bytes)['xl/worksheets/sheet1.xml']);assert.equal((xml.match(/>FNEE</g)||[]).length,1);assert.match(xml,/ajustes DTE II/);
});
test('paquete DTE I incluye exactamente las tres planillas aprobadas del mes',async()=>{
 const month='2026-10',bot=billingXlsx(period('I',[r('A','MWh',100)]).billingRows,month,null,{},funds),fetcher=async url=>url.endsWith('billing-exports.json')?Response.json({periods:[{month,edition:'I',path:'exports/billing/Facturacion_'+month+'_DTE_I.xlsx'}]}):url.endsWith('billing-models.json')?Response.json({periods:[{month,...Object.fromEntries(['OESC','OECC'].map(s=>[s,'exports/billing/modelos/Facturacion_'+s+'_'+month+'_DTE_I.xlsx']))}]}):new Response(bot);
 const result=await billingPackage(month,fetcher);assert.equal(Object.keys(unzipSync(result.bytes)).length,3);assert.match(result.filename,/2026-10_DTE_I.zip/);
});
