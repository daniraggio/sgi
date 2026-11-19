import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceLines,billingXlsx} from '../server/billing.mjs';
test('OECC factura Energia; OESC y AET conservan renovables; potencia y FNEE conservan sus líneas',()=>{
 const funds={rates:{'2026-09':{arsPerMWh:2508}}};
 for(const society of ['OECC','OESC','AET']){const [energy,fnee,power]=invoiceLines([{society,ps:'1',nemo:'A',q:10,price:64,unit:'MWh'},{society,ps:'2',nemo:'B',q:20,price:13.4,unit:'MWhrp'}],'2026-09',funds);assert.equal(energy.line,society==='OECC'?'Energia':'Energías renovables');assert.equal(fnee.line,'FNEE');assert.equal(fnee.q,10);assert.equal(fnee.price,2508);assert.equal(power.line,'Potencia');}
 // The worksheet's society also determines the label when caller metadata is absent.
 const xml=new TextDecoder().decode(billingXlsx({OESC:[],OECC:[{ps:'1',client:'Cliente',nemo:'A',q:10,price:64,unit:'MWh'}],AET:[]},'2026-09',null,{},funds));assert.match(xml,/>Energia</);assert.doesNotMatch(xml,/>Energías renovables</);
});
