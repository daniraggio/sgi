import test from 'node:test';import assert from 'node:assert/strict';import {validateContract,schedule} from '../server/model.mjs';
const base={society:'OESC',kind:'energy',client:'Cliente prueba',nemo:'TEST',supplier:'GSSR',start:'2027-04',end:'2027-05',volume:120,summerPrice:50,winterPrice:65};
test('plazo incluido y precios de temporada',()=>{const rs=schedule(validateContract(base));assert.equal(rs.length,2);assert.deepEqual(rs.map(x=>[x.month,x.q,x.price,x.income]),[['2027-04',120,50,6000],['2027-05',120,65,7800]])});
test('excepciones mensuales y contrato archivado',()=>{const c=validateContract({...base,monthlyVolumes:{'2027-05':80},monthlyPrices:{'2027-05':70}});assert.equal(schedule(c)[1].income,5600);assert.deepEqual(schedule({...c,active:false}),[])});
test('rechaza cantidades, precios y plazos inválidos',()=>{for(const delta of [{volume:-1},{winterPrice:NaN},{start:'2027-13'},{end:'2027-01'},{monthlyVolumes:{'2028-01':120}}])assert.throws(()=>validateContract({...base,...delta}))});

test('prioridad de venta explícita y valores no válidos',()=>{assert.equal(validateContract({...base,priority:2}).priority,2);assert.equal(validateContract(base).priority,null);for(const priority of [0,-1,1.5,100,'1'])assert.throws(()=>validateContract({...base,priority}));});
